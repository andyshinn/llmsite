import { z } from "zod";
import { type Classification, classificationJsonSchema, classificationSchema } from "@radar/core";
import type { RunModel } from "./deps.ts";

export interface PostInput {
  source: string;
  title: string;
  url: string;
}

export interface FewShotExample {
  post: PostInput;
  output: Record<string, unknown>;
}

export type ClassifyResult =
  | { ok: true; value: Classification; raw: string }
  | { ok: false; raw: string; error: string };

const CATEGORY_HINTS: Record<string, string> = {
  agent: "coding agents that plan and make changes on their own",
  ide: "AI IDEs and editor extensions",
  cli: "command-line tools",
  "mcp-server": "Model Context Protocol servers",
  other: "an in-scope tool that fits none of the other categories",
};

export function systemPrompt(categories: readonly string[]): string {
  const categoryLines = categories.map((c) => `  - ${c}${CATEGORY_HINTS[c] ? `: ${CATEGORY_HINTS[c]}` : ""}`).join("\n");
  return `You classify posts from developer communities for a public directory of AI coding tools.

In scope: developer tools that use AI to help write, run or manage code. That means coding agents, AI IDEs and editor extensions, CLIs, and MCP servers. Open-source and closed-source tools both count.

A tool is in scope only if BOTH are true:
1. AI (an LLM or other model) does the core work of the tool, and
2. the tool helps software developers write, review, test, debug, run or deploy code. Any MCP server also counts.

Out of scope (is_ai_dev_tool = false):
- apps that were built with AI ("vibe-coded") but do not use AI themselves
- developer tools without AI at their core: compilers, linkers, databases, terminals, CI tools, libraries
- AI products for anything other than coding: chat clients, writing, PDFs, analytics, search, companionship
- SDKs, frameworks and libraries for building LLM apps or agents
- models, papers, benchmarks, evaluations, datasets and general AI news or opinion

Fields:
- is_ai_dev_tool: true only if the post is mainly about one specific in-scope tool. When unsure, choose false.
- post_type: "launch" (a new tool is announced), "release" (a new version of an existing tool), "discussion" (experience, opinion or question about a tool), "roundup" (comparisons, lists, "awesome-X"), or "news".
- tool_name: the tool's name as its makers write it; "" if there is none.
- homepage_url: the tool's own website, or null. Not a GitHub, blog or news URL.
- github_repo: "owner/repo" if the tool has a GitHub repository, else null.
- version: the version number for releases, else null.
- category: one of:
${categoryLines}
- tags: up to 5 short lowercase tags (languages, editors, model providers, platforms).
- is_open_source: true if the source code is publicly available under an open license.
- description: one plain, factual line under 140 characters. No marketing language.
- confidence: from 0 to 1, how sure you are about is_ai_dev_tool, post_type and the tool's identity. Use 0.9 or more only when the content states plainly what the tool does and who it is for; 0.5 to 0.8 when you are inferring; below 0.5 when you are guessing.

Reply with the JSON object only.`;
}

export function userPrompt(post: PostInput, text: string): string {
  return `Source: ${post.source}\nTitle: ${post.title}\nURL: ${post.url}\n\nContent:\n${text || "(no content could be fetched)"}`;
}

/** Stage 3: one Workers AI call, validated with zod; an invalid response is retried once. */
export async function classifyPost(
  input: { model: string; categories: readonly string[]; post: PostInput; text: string; fewShot: FewShotExample[] },
  ai: RunModel,
): Promise<ClassifyResult> {
  const messages = [
    { role: "system", content: systemPrompt(input.categories) },
    ...input.fewShot.flatMap((ex) => [
      { role: "user", content: userPrompt(ex.post, "(omitted in example)") },
      { role: "assistant", content: JSON.stringify(ex.output) },
    ]),
    { role: "user", content: userPrompt(input.post, input.text) },
  ];
  const schema = classificationSchema(input.categories);
  const request = {
    messages,
    response_format: { type: "json_schema", json_schema: classificationJsonSchema(input.categories) },
    max_tokens: 600,
    temperature: 0,
  };

  let failure = { raw: "", error: "" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await ai(input.model, request);
    const response = (out as { response?: unknown } | null)?.response;
    const raw = typeof response === "string" ? response : JSON.stringify(response ?? null);
    let parsed: unknown;
    try {
      parsed = typeof response === "string" ? JSON.parse(response) : response;
    } catch {
      failure = { raw, error: "response is not valid JSON" };
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, value: result.data, raw };
    failure = { raw, error: z.prettifyError(result.error) };
  }
  return { ok: false, ...failure };
}
