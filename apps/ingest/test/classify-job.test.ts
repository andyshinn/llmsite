import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { runClassifyJob } from "../src/classify-job.ts";
import { articleKey } from "../src/content.ts";
import { fakeAi, makeDeps, resetDb } from "./helpers.ts";

beforeEach(resetDb);

const tool = (over: Record<string, unknown> = {}) => ({
  is_ai_dev_tool: true,
  post_type: "launch",
  tool_name: "Patchwork",
  homepage_url: "https://patchwork.dev",
  github_repo: "patchwork-labs/patchwork",
  version: null,
  category: "agent",
  tags: ["review"],
  is_open_source: true,
  description: "Open-source agent that reviews pull requests.",
  confidence: 0.92,
  ...over,
});

let externalId = 0;
async function insertPost(over: { url?: string; title?: string; posted_at?: string } = {}): Promise<number> {
  const url = over.url ?? `https://example.com/post-${++externalId}`;
  const row = await env.DB.prepare(
    "INSERT INTO posts (source, external_id, url, canonical_url, title, posted_at) VALUES ('hn', ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(String(++externalId), url, url, over.title ?? "Show HN: Patchwork", over.posted_at ?? "2026-10-05T12:00:00.000Z")
    .first<{ id: number }>();
  // Pre-cache text so no network is needed.
  await env.ARTICLES.put(articleKey(row!.id), "Patchwork reviews pull requests with an AI agent.");
  return row!.id;
}

const post = (id: number) =>
  env.DB.prepare("SELECT status, tool_id, confidence, post_type, drop_reason, raw_output, classification FROM posts WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();

const setThreshold = (value: number) =>
  env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'review_threshold'").bind(String(value)).run();

describe("runClassifyJob", () => {
  it("queues for review at threshold 1 and creates a queued tool with aliases", async () => {
    const id = await insertPost();
    const ai = fakeAi(tool({ confidence: 1 }));
    await runClassifyJob({ kind: "classify", post_id: id }, makeDeps({ ai }));

    const p = await post(id);
    expect(p).toMatchObject({ status: "queued", confidence: 1, post_type: "launch" });
    const t = await env.DB.prepare("SELECT * FROM tools WHERE id = ?").bind(p!.tool_id).first<Record<string, unknown>>();
    expect(t).toMatchObject({
      slug: "patchwork", name: "Patchwork", status: "queued", category: "agent", github_repo: "patchwork-labs/patchwork",
      first_seen_at: "2026-10-05T12:00:00.000Z", last_post_at: "2026-10-05T12:00:00.000Z",
    });
    const { results: aliases } = await env.DB.prepare("SELECT kind, value FROM tool_aliases ORDER BY kind").all();
    expect(aliases).toEqual([
      { kind: "domain", value: "patchwork.dev" },
      { kind: "name", value: "patchwork" },
      { kind: "repo", value: "patchwork-labs/patchwork" },
    ]);

    // The prompt carries the post, the extracted text and the category enum.
    const request = ai.calls[0] as { messages: { content: string }[]; response_format: { json_schema: { properties: { category: { enum: string[] } } } } };
    expect(request.messages.at(-1)!.content).toContain("Patchwork reviews pull requests");
    expect(request.response_format.json_schema.properties.category.enum).toContain("mcp-server");
  });

  it("publishes at or above the threshold and publishes the tool", async () => {
    await setThreshold(0.8);
    const id = await insertPost();
    await runClassifyJob({ kind: "classify", post_id: id }, makeDeps({ ai: fakeAi(tool()) }));
    const p = await post(id);
    expect(p!.status).toBe("published");
    const t = await env.DB.prepare("SELECT status FROM tools WHERE id = ?").bind(p!.tool_id).first<{ status: string }>();
    expect(t!.status).toBe("published");
  });

  it("always queues category other, and below-threshold posts", async () => {
    await setThreshold(0.8);
    const other = await insertPost();
    await runClassifyJob({ kind: "classify", post_id: other }, makeDeps({ ai: fakeAi(tool({ category: "other" })) }));
    expect((await post(other))!.status).toBe("queued");

    const low = await insertPost();
    await runClassifyJob({ kind: "classify", post_id: low }, makeDeps({ ai: fakeAi(tool({ confidence: 0.5 })) }));
    expect((await post(low))!.status).toBe("queued");
  });

  it("drops non-tools and roundups with a reason", async () => {
    const news = await insertPost();
    await runClassifyJob({ kind: "classify", post_id: news }, makeDeps({ ai: fakeAi(tool({ is_ai_dev_tool: false, post_type: "news" })) }));
    expect(await post(news)).toMatchObject({ status: "dropped", drop_reason: "not_ai_dev_tool", tool_id: null });

    const roundup = await insertPost();
    await runClassifyJob({ kind: "classify", post_id: roundup }, makeDeps({ ai: fakeAi(tool({ post_type: "roundup" })) }));
    expect(await post(roundup)).toMatchObject({ status: "dropped", drop_reason: "roundup" });
  });

  it("retries an invalid response once, then queues it with the raw output", async () => {
    const id = await insertPost();
    const ai = fakeAi("not json", { ...tool(), category: "sdk" });
    await runClassifyJob({ kind: "classify", post_id: id }, makeDeps({ ai }));
    expect(ai.calls).toHaveLength(2);
    const p = await post(id);
    expect(p).toMatchObject({ status: "queued", tool_id: null, classification: null });
    expect(JSON.parse(p!.raw_output as string).error).toContain("category");
  });

  it("succeeds on the retry when the first response is invalid", async () => {
    const id = await insertPost();
    const ai = fakeAi("{", tool());
    await runClassifyJob({ kind: "classify", post_id: id }, makeDeps({ ai }));
    expect((await post(id))!.status).toBe("queued");
    expect((await post(id))!.tool_id).not.toBeNull();
  });

  it("resolves later posts to the same tool by repo, domain or fuzzy name", async () => {
    const first = await insertPost();
    await runClassifyJob({ kind: "classify", post_id: first }, makeDeps({ ai: fakeAi(tool()) }));
    const toolId = (await post(first))!.tool_id;

    const byRepo = await insertPost({ posted_at: "2026-10-06T12:00:00.000Z" });
    await runClassifyJob(
      { kind: "classify", post_id: byRepo },
      makeDeps({ ai: fakeAi(tool({ tool_name: "Something Else", homepage_url: null, post_type: "release", version: "1.1" })) }),
    );
    expect((await post(byRepo))!.tool_id).toBe(toolId);

    const byDomain = await insertPost();
    await runClassifyJob(
      { kind: "classify", post_id: byDomain },
      makeDeps({ ai: fakeAi(tool({ tool_name: "Other", github_repo: null, homepage_url: "https://www.patchwork.dev/docs" })) }),
    );
    expect((await post(byDomain))!.tool_id).toBe(toolId);

    const byName = await insertPost();
    await runClassifyJob(
      { kind: "classify", post_id: byName },
      makeDeps({ ai: fakeAi(tool({ tool_name: "Patchworks AI", github_repo: null, homepage_url: null })) }),
    );
    expect((await post(byName))!.tool_id).toBe(toolId);

    const t = await env.DB.prepare("SELECT last_post_at, (SELECT count(*) FROM tools) AS n FROM tools WHERE id = ?")
      .bind(toolId)
      .first<{ last_post_at: string; n: number }>();
    expect(t).toEqual({ last_post_at: "2026-10-06T12:00:00.000Z", n: 1 });
  });

  it("creates a separate tool with a unique slug when nothing matches", async () => {
    const a = await insertPost();
    await runClassifyJob({ kind: "classify", post_id: a }, makeDeps({ ai: fakeAi(tool()) }));
    const b = await insertPost();
    await runClassifyJob(
      { kind: "classify", post_id: b },
      makeDeps({ ai: fakeAi(tool({ tool_name: "Patchwork!", github_repo: "someone/else", homepage_url: "https://other.dev", description: "" })) }),
    );
    // "patchwork" normalizes the same, so this merges by name; a truly new name gets its own tool:
    const c = await insertPost();
    await runClassifyJob(
      { kind: "classify", post_id: c },
      makeDeps({ ai: fakeAi(tool({ tool_name: "Lintbot", github_repo: null, homepage_url: null })) }),
    );
    const { results } = await env.DB.prepare("SELECT slug FROM tools ORDER BY id").all<{ slug: string }>();
    expect(results.map((r) => r.slug)).toEqual(["patchwork", "lintbot"]);
  });

  it("reuses the classification of a post with the same canonical URL without calling the model", async () => {
    const url = "https://github.com/patchwork-labs/patchwork";
    const first = await insertPost({ url });
    await runClassifyJob({ kind: "classify", post_id: first }, makeDeps({ ai: fakeAi(tool()) }));
    const second = await insertPost({ url });
    await runClassifyJob({ kind: "classify", post_id: second }, makeDeps()); // makeDeps' default AI throws
    expect((await post(second))!.tool_id).toBe((await post(first))!.tool_id);
  });

  it("ignores posts that were already routed", async () => {
    const id = await insertPost();
    await runClassifyJob({ kind: "classify", post_id: id }, makeDeps({ ai: fakeAi(tool()) }));
    await runClassifyJob({ kind: "classify", post_id: id }, makeDeps());
    expect((await post(id))!.status).toBe("queued");
  });
});
