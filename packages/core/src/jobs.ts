import { z } from "zod";

export const SOURCES = ["hn", "lobsters", "reddit", "github", "producthunt"] as const;
export const sourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof sourceSchema>;

// Message body on the fetch queue: one job per source. The daily cron sends
// mode "daily"; ops.yml sends "manual" (trigger one source) or "backfill".
export const fetchJobSchema = z.object({
  kind: z.literal("fetch"),
  source: sourceSchema,
  mode: z.enum(["daily", "manual", "backfill"]),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});
export type FetchJob = z.infer<typeof fetchJobSchema>;
