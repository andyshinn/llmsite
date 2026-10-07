import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { backfillEstimate, postCounts, reclassifyPreview, reclassifyQueued, runNow, sourceStatuses, startBackfill } from "../src/lib/ops.ts";

const db = env.DB;
function fakeQueue() {
  const sent: unknown[] = [];
  const queue = { sendBatch: async (msgs: Iterable<{ body: unknown }>) => void [...msgs].forEach((m) => sent.push(m.body)) } as unknown as Queue;
  return { queue, sent };
}

beforeEach(async () => {
  await db.batch(["review_decisions", "tool_aliases", "posts", "tools", "source_runs"].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

describe("run now and backfill", () => {
  it("enqueues one manual job per enabled source, or one for a single source", async () => {
    const q = fakeQueue();
    await runNow(q.queue, "all");
    expect(q.sent).toEqual([
      { kind: "fetch", source: "hn", mode: "manual" },
      { kind: "fetch", source: "lobsters", mode: "manual" },
      { kind: "fetch", source: "github", mode: "manual" },
    ]);
    const one = fakeQueue();
    await runNow(one.queue, "github");
    expect(one.sent).toHaveLength(1);
    await expect(runNow(one.queue, "producthunt")).rejects.toThrow("Unknown source");
  });

  it("enqueues backfill jobs covering the last N days", async () => {
    const q = fakeQueue();
    const now = Date.parse("2026-10-07T00:00:00Z");
    await startBackfill(q.queue, "hn", 7, now);
    expect(q.sent).toEqual([{ kind: "fetch", source: "hn", mode: "backfill", since: "2026-09-30T00:00:00.000Z", until: "2026-10-07T00:00:00.000Z" }]);
    await expect(startBackfill(q.queue, "hn", 0)).rejects.toThrow("Days must be");
    await expect(startBackfill(q.queue, "hn", 9999)).rejects.toThrow("Days must be");
  });

  it("estimates backfill size and cost", () => {
    const e = backfillEstimate("all", 90);
    expect(e.posts).toBeGreaterThan(20_000);
    expect(e.costUsd).toBeGreaterThan(5);
    expect(backfillEstimate("lobsters", 10).posts).toBe(70);
  });
});

describe("reclassify", () => {
  it("resets unreviewed queued posts, keeps reviewed ones and enqueues the pending posts", async () => {
    await db.batch([
      db.prepare("INSERT INTO tools (id, slug, name, status) VALUES (1, 'junk', 'Junk', 'queued'), (2, 'pub', 'Pub', 'published')"),
      db.prepare("INSERT INTO tool_aliases (tool_id, kind, value) VALUES (1, 'name', 'junk')"),
      db.prepare(
        `INSERT INTO posts (id, source, external_id, url, canonical_url, title, posted_at, status, tool_id, classification) VALUES
         (10, 'hn', '10', 'u', 'u', 'a', '2026-10-01T00:00:00Z', 'queued', 1, '{}'),
         (11, 'hn', '11', 'u', 'u', 'b', '2026-10-01T00:00:00Z', 'queued', 2, '{}'),
         (12, 'hn', '12', 'u', 'u', 'c', '2026-10-01T00:00:00Z', 'queued', 2, '{}'),
         (13, 'hn', '13', 'u', 'u', 'd', '2026-10-01T00:00:00Z', 'dropped', NULL, '{}')`,
      ),
      db.prepare("INSERT INTO review_decisions (post_id, decision) VALUES (12, 'reassign')"),
    ]);
    expect(await reclassifyPreview(db)).toEqual({ posts: 2, kept: 1 });

    const q = fakeQueue();
    expect(await reclassifyQueued(db, q.queue)).toBe(2);
    expect(q.sent).toEqual([{ kind: "classify", post_id: 10, force: true }, { kind: "classify", post_id: 11, force: true }]);
    expect(await postCounts(db)).toEqual({ pending: 2, queued: 1, dropped: 1 });
    const tools = await db.prepare("SELECT id FROM tools ORDER BY id").all<{ id: number }>();
    expect(tools.results.map((t) => t.id)).toEqual([2]); // the junk tool and its alias are gone
    expect(await db.prepare("SELECT count(*) AS n FROM tool_aliases").first()).toEqual({ n: 0 });
  });
});

describe("sourceStatuses", () => {
  const run = (source: string, startedAt: string, items: number | null, error: string | null = null, mode = "daily", finished = true) =>
    db
      .prepare("INSERT INTO source_runs (source, mode, started_at, finished_at, items_fetched, error) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(source, mode, startedAt, finished ? startedAt : null, items, error);

  it("reports the last run, the 7-day average and a drop warning", async () => {
    await db.batch([
      run("hn", "2026-10-03T06:00:00.000Z", 1000),
      run("hn", "2026-10-04T06:00:00.000Z", 1100),
      run("hn", "2026-10-05T06:00:00.000Z", 50),
      run("lobsters", "2026-10-05T06:00:00.000Z", 30),
      run("github", "2026-10-05T06:00:00.000Z", 0, "GitHub search -> 403"),
    ]);
    const s = Object.fromEntries((await sourceStatuses(db)).map((x) => [x.source, x]));
    expect(s.hn).toMatchObject({ weekAverage: 1050, dropWarning: true });
    expect(s.hn!.last!.items_fetched).toBe(50);
    expect(s.lobsters).toMatchObject({ weekAverage: null, dropWarning: false });
    expect(s.github!.last!.error).toContain("403");
    expect(s.github!.dropWarning).toBe(false); // an error is shown instead
  });

  it("leaves backfill runs out of the comparison", async () => {
    await db.batch([
      run("lobsters", "2026-10-03T06:00:00.000Z", 30),
      run("lobsters", "2026-10-04T12:00:00.000Z", 2400, null, "backfill"),
      run("lobsters", "2026-10-05T06:00:00.000Z", 28),
    ]);
    const lobsters = (await sourceStatuses(db)).find((x) => x.source === "lobsters")!;
    expect(lobsters).toMatchObject({ weekAverage: 30, dropWarning: false });
  });

  it("shows a run in progress without treating it as a drop", async () => {
    await db.batch([
      run("hn", "2026-10-04T06:00:00.000Z", 1100),
      run("hn", "2026-10-05T06:00:00.000Z", 1000),
      run("hn", "2026-10-06T06:00:00.000Z", null, null, "daily", false),
    ]);
    const hn = (await sourceStatuses(db)).find((x) => x.source === "hn")!;
    expect(hn.last).toMatchObject({ finished_at: null, items_fetched: null });
    expect(hn).toMatchObject({ weekAverage: 1100, dropWarning: false });
  });
});
