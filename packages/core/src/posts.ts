import { z } from "zod";
import { sourceSchema } from "./jobs.ts";

// The shape every source adapter returns.
export const normalizedPostSchema = z.object({
  source: sourceSchema,
  external_id: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1),
  author: z.string().nullable(),
  posted_at: z.iso.datetime(),
  score: z.number().int(),
  comments: z.number().int(),
  // Source-native labels used by the pre-filter, e.g. "show_hn" or lobste.rs tags.
  tags: z.array(z.string()),
});
export type NormalizedPost = z.infer<typeof normalizedPostSchema>;

export const POST_STATUSES = ["pending", "published", "queued", "rejected", "dropped"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
