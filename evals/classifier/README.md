# Classifier evaluation set

`labeled-2026-10.jsonl`: 150 posts sampled from production on 2026-10-07
(HN, lobste.rs and GitHub; queued and dropped), hand-labeled for whether the
post is mainly about one specific in-scope AI coding tool.

Labeling rules:

- In scope: AI tools that help write, run or manage code (coding agents, AI IDEs
  and editor extensions, CLIs, MCP servers), and tools built for AI coding-agent
  workflows even when they do not call a model themselves (agent monitors,
  orchestrators, plugins/skills/hooks for coding work).
- Out of scope: news, essays and benchmarks; models; SDKs/frameworks for building
  LLM apps or general agents; AI products for non-coding work; agent skills for
  non-coding work (video, marketing).
- `mcp_only`: in scope only because any MCP server counts. Scores are reported
  both ways while that rule is an open question.

Run `pnpm --filter @radar/ingest eval:classifier -- --model <id> [--reasoning low]`
(see `apps/ingest/scripts/eval-classifier.ts`). It needs a Cloudflare credential
with Workers AI access and fetches each post's text once into `.cache/`.
