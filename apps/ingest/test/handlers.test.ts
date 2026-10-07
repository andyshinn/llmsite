import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { depsFromEnv } from "../src/deps.ts";
import worker from "../src/index.ts";
import { fakeQueue, resetDb } from "./helpers.ts";

beforeEach(resetDb);

it("enqueues one daily fetch job per source and re-queues stale pending posts", async () => {
  const insert = (id: string, createdAt: string) =>
    env.DB.prepare(
      "INSERT INTO posts (source, external_id, url, canonical_url, title, posted_at, created_at) VALUES ('hn', ?, 'https://x.dev', 'https://x.dev', 't', ?, ?) RETURNING id",
    )
      .bind(id, createdAt, createdAt)
      .first<{ id: number }>();
  const stale = await insert("stale", "2026-01-01T00:00:00.000Z");
  await insert("fresh", new Date().toISOString());

  const fetchQ = fakeQueue();
  const classifyQ = fakeQueue();
  const ctx = createExecutionContext();
  const scheduledTime = Date.parse("2026-10-06T06:00:00Z");
  await worker.scheduled(
    createScheduledController({ cron: "0 6 * * *", scheduledTime }),
    { ...env, FETCH_QUEUE: fetchQ.queue, CLASSIFY_QUEUE: classifyQ.queue },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(fetchQ.sent).toEqual([
    { kind: "fetch", source: "hn", mode: "daily", until: "2026-10-06T06:00:00.000Z" },
    { kind: "fetch", source: "lobsters", mode: "daily", until: "2026-10-06T06:00:00.000Z" },
    { kind: "fetch", source: "github", mode: "daily", until: "2026-10-06T06:00:00.000Z" },
  ]);
  expect(classifyQ.sent).toEqual([{ kind: "classify", post_id: stale!.id }]);
});

it("sends every Workers AI call through the AI Gateway", async () => {
  const calls: unknown[][] = [];
  const ai = { run: async (...args: unknown[]) => (calls.push(args), { response: "{}" }) } as unknown as Ai;
  await depsFromEnv({ ...env, AI: ai }).ai("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: [] });
  expect(calls[0]![2]).toEqual({ gateway: { id: "radar", skipCache: true } });
});

it("acks malformed messages and jobs with nothing to do", async () => {
  const batch = createMessageBatch("radar-fetch", [
    { id: "bad", timestamp: new Date(), attempts: 1, body: { kind: "fetch", source: "digg" } },
    { id: "noop", timestamp: new Date(), attempts: 1, body: { kind: "fetch", source: "producthunt", mode: "manual" } },
  ]);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  const result = await getQueueResult(batch, ctx);
  expect(result.explicitAcks).toEqual(["bad", "noop"]);
});

it("retries a message whose job throws", async () => {
  const batch = createMessageBatch("radar-classify", [
    { id: "boom", timestamp: new Date(), attempts: 2, body: { kind: "classify", post_id: 1 } },
  ]);
  const brokenDb = {
    prepare() {
      throw new Error("D1 unavailable");
    },
  } as unknown as D1Database;
  const ctx = createExecutionContext();
  await worker.queue(batch, { ...env, DB: brokenDb }, ctx);
  const result = await getQueueResult(batch, ctx);
  expect(result.retryMessages.map((m: { msgId: string }) => m.msgId)).toEqual(["boom"]);
});

it("ENABLED_SOURCES in core matches the ingest adapters", async () => {
  const { ENABLED_SOURCES } = await import("@radar/core");
  const { ADAPTERS } = await import("../src/sources/index.ts");
  expect([...ENABLED_SOURCES].sort()).toEqual(Object.keys(ADAPTERS).sort());
});
