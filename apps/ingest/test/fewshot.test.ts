import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { loadFewShot } from "../src/classify-job.ts";
import { resetDb } from "./helpers.ts";

beforeEach(resetDb);
const CATEGORIES = ["agent", "ide", "cli", "mcp-dev", "mcp-general", "other"];
const model = {
  is_ai_dev_tool: true, post_type: "launch", tool_name: "Patchwork", homepage_url: null, github_repo: "acme/patchwork",
  version: null, category: "agent", tags: [], is_open_source: true, description: "Reviews PRs.", confidence: 0.9,
};

let n = 0;
async function decided(classification: object | null, corrected: object | null, useInPrompt = 1): Promise<void> {
  n++;
  const p = await env.DB.prepare(
    "INSERT INTO posts (source, external_id, url, canonical_url, title, posted_at, status, classification) VALUES ('hn', ?, ?, ?, ?, '2026-10-01T00:00:00Z', 'published', ?) RETURNING id",
  )
    .bind(String(n), `https://e.com/${n}`, `https://e.com/${n}`, `Post ${n}`, classification ? JSON.stringify(classification) : null)
    .first<{ id: number }>();
  await env.DB.prepare("INSERT INTO review_decisions (post_id, decision, corrected_fields, use_in_prompt, decided_at) VALUES (?, 'edit', ?, ?, ?)")
    .bind(p!.id, corrected ? JSON.stringify(corrected) : null, useInPrompt, `2026-10-0${n}T00:00:00Z`)
    .run();
}

it("applies corrections to the model output, newest first", async () => {
  await decided(model, { category: "cli" });
  await decided(model, { is_ai_dev_tool: false });
  const examples = await loadFewShot(env.DB, 20, CATEGORIES);
  expect(examples.map((e) => [e.post.title, e.output.is_ai_dev_tool, e.output.category])).toEqual([
    ["Post 2", false, "agent"],
    ["Post 1", true, "cli"],
  ]);
});

it("uses a full edit of a post whose model output was invalid, and skips an incomplete one", async () => {
  const { confidence: _, ...fields } = model;
  await decided(null, { ...fields, tool_name: "Rescued" });
  await decided(null, { is_ai_dev_tool: false }); // a reject of an invalid-output post: not a complete example
  const examples = await loadFewShot(env.DB, 20, CATEGORIES);
  expect(examples.map((e) => e.output.tool_name)).toEqual(["Rescued"]);
  expect(examples[0]!.output.confidence).toBe(1);
});

it("ignores decisions not marked for the prompt and respects the limit", async () => {
  await decided(model, null, 0);
  await decided(model, null);
  await decided(model, null);
  expect(await loadFewShot(env.DB, 1, CATEGORIES)).toHaveLength(1);
  expect(await loadFewShot(env.DB, 0, CATEGORIES)).toEqual([]);
});
