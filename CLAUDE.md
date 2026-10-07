# CLAUDE.md

Read `docs/DESIGN.md` before starting any task. It is the source of truth for scope, data model and behavior. If a task conflicts with it, stop and say so instead of guessing; if a design decision changes, update `docs/DESIGN.md` in the same PR.

## What this is

A public site that discovers new AI coding tools daily (HN, lobste.rs, GitHub; Product Hunt once API access is granted), classifies them with Workers AI, groups posts into tool pages, and ranks tools by a trending score.

## Stack

- TypeScript everywhere, strict mode.
- Two Workers:
  - `apps/ingest` — Cron Trigger, source adapters, Queues consumer, classifier, tool resolver, trending job.
  - `apps/site` — Astro with the Cloudflare adapter (public pages, `/api/*`, `/admin/*`). UI: Tailwind CSS v4, Heroicons, Tailwind Plus Elements only when a widget needs JS. No React.
- Shared code in `packages/core` (types, D1 queries, schema validation with zod).
- Cloudflare: D1 (all state), R2 (extracted article text), Queues, Workers AI, Cron Triggers.
- Config in `wrangler.jsonc` per app. Enable `observability` (Workers Logs) on both Workers.
- pnpm workspaces.

## Hard constraints

- **The owner works only from a phone.** Nothing may require a local machine. Every operational command (create resources, migrate, run SQL, set secrets, backfill, trigger a source) must exist as a GitHub Actions workflow with `workflow_dispatch`. See "Phone-only workflow" in the design doc.
- **Production only.** No staging environment. Safety comes from CI, the review queue, and `review_threshold` (set to 1 until launch).
- **Classifier uses Workers AI only.** Model ID comes from the `settings` table (`model_id`), never hard-coded.
- **Tunable values live in `settings`** (threshold, trending weights, categories, pre-filter keywords, model ID, few-shot cap). Never hard-code them; seed defaults in a migration.
- **Admin UI is mobile-first:** one queue item per screen, large tap targets, no keyboard-only actions. Protected by Cloudflare Access; do not write login code.
- **Public pages never show confidence** or whether an entry was auto-classified.

## Conventions

- D1 migrations in `migrations/`, numbered (`0001_init.sql`, ...). Never edit an applied migration; add a new one.
- Every source adapter returns the same normalized post shape and is tested with recorded fixtures (no live network in tests).
- Validate all LLM output with zod before use; on failure, retry once, then queue for review with the raw output.
- Tests with Vitest; run in CI on every PR.
- Secrets only via GitHub repo secrets and Worker secrets. Never commit tokens or resource IDs that are secret.

## How to work

- One launch-plan step per session. End with a PR small enough to review on a phone, with a short description of what changed and how to verify it.
- Anything I need to do by hand (create a token, add a secret, run a workflow) goes in a checklist at the top of the PR description.
- If something in the design doc is ambiguous, pick the simplest option, note it in the PR, and flag it as a question.
