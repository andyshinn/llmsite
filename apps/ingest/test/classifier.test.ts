import { describe, expect, it } from "vitest";
import { classifyPost, modelText } from "../src/classifier.ts";

const valid = {
  reason: "A CLI coding agent.", is_ai_dev_tool: true, post_type: "launch", tool_name: "Patchwork", homepage_url: null,
  github_repo: null, version: null, category: "cli", tags: [], is_open_source: true, description: "d", confidence: 0.9,
};
const input = { model: "@cf/x/y", categories: ["agent", "ide", "cli", "mcp-server", "other"], post: { source: "hn", title: "t", url: "u" }, text: "", fewShot: [] };

describe("modelText", () => {
  it("reads the classic and the OpenAI-style result shapes", () => {
    expect(modelText({ response: { a: 1 } })).toEqual({ a: 1 });
    expect(modelText({ response: '{"a":1}' })).toBe('{"a":1}');
    expect(modelText({ choices: [{ message: { content: '{"a":1}' } }] })).toBe('{"a":1}');
    expect(modelText(null)).toBeNull();
  });
});

describe("classifyPost", () => {
  it("parses an OpenAI-style response and keeps the model's reason", async () => {
    const r = await classifyPost(input, async () => ({ choices: [{ message: { content: JSON.stringify(valid) } }] }));
    expect(r.ok && r.value.reason).toBe("A CLI coding agent.");
  });

  it("sends reasoning_effort only when set", async () => {
    const seen: Record<string, unknown>[] = [];
    const ai = async (_m: string, req: Record<string, unknown>) => (seen.push(req), { response: valid });
    await classifyPost(input, ai);
    await classifyPost({ ...input, reasoningEffort: "low" }, ai);
    expect("reasoning_effort" in seen[0]!).toBe(false);
    expect(seen[1]!.reasoning_effort).toBe("low");
  });
});
