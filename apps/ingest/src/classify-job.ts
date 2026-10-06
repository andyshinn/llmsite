import { type Classification, type ClassifyJob, classificationSchema, getSetting } from "@radar/core";
import { type FewShotExample, classifyPost } from "./classifier.ts";
import { getArticleText } from "./content.ts";
import type { Deps } from "./deps.ts";
import { resolveTool } from "./resolver.ts";

interface PostRow {
  id: number;
  source: string;
  url: string;
  canonical_url: string;
  title: string;
  posted_at: string;
  status: string;
  classification: string | null;
}

export async function runClassifyJob(job: ClassifyJob, deps: Deps): Promise<void> {
  const { db } = deps;
  const post = await db
    .prepare("SELECT id, source, url, canonical_url, title, posted_at, status, classification FROM posts WHERE id = ?")
    .bind(job.post_id)
    .first<PostRow>();
  // Already routed (e.g. a redelivered message): nothing to do.
  if (!post || post.status !== "pending") return;

  const [threshold, categories, model, maxFewShot] = await Promise.all([
    getSetting(db, "review_threshold"),
    getSetting(db, "categories"),
    getSetting(db, "model_id"),
    getSetting(db, "max_fewshot"),
  ]);
  const schema = classificationSchema(categories);
  const parseStored = (json: string | null) => {
    const result = json ? schema.safeParse(JSON.parse(json)) : null;
    return result?.success ? result.data : null;
  };

  // A retry after a failure further down reuses the stored result instead of calling the model again.
  let classification = parseStored(post.classification);
  let via = "stored";

  // Dedupe: another post with the same canonical URL was already classified.
  if (!classification) {
    const twin = await db
      .prepare("SELECT classification FROM posts WHERE canonical_url = ? AND id != ? AND classification IS NOT NULL ORDER BY id LIMIT 1")
      .bind(post.canonical_url, post.id)
      .first<{ classification: string }>();
    classification = parseStored(twin?.classification ?? null);
    via = "duplicate_url";
  }

  if (!classification) {
    const text = await getArticleText(post, deps);
    const fewShot = await loadFewShot(db, maxFewShot);
    const result = await classifyPost({ model, categories, post, text, fewShot }, deps.ai);
    if (!result.ok) {
      await db
        .prepare("UPDATE posts SET status = 'queued', raw_output = ? WHERE id = ?")
        .bind(JSON.stringify({ raw: result.raw, error: result.error }), post.id)
        .run();
      console.warn(JSON.stringify({ event: "classify_invalid", post_id: post.id, error: result.error }));
      return;
    }
    classification = result.value;
    via = "model";
    await db
      .prepare("UPDATE posts SET classification = ?, confidence = ?, post_type = ?, version = ? WHERE id = ?")
      .bind(JSON.stringify(classification), classification.confidence, classification.post_type, classification.version, post.id)
      .run();
  }

  const outcome = await route(db, post, classification, threshold);
  console.log(JSON.stringify({ event: "classified", post_id: post.id, via, ...outcome }));
}

/** Routing rules from docs/DESIGN.md "Routing after classification". */
async function route(db: D1Database, post: PostRow, c: Classification, threshold: number) {
  const fields = [JSON.stringify(c), c.confidence, c.post_type, c.version] as const;

  if (!c.is_ai_dev_tool || c.post_type === "roundup") {
    const reason = c.is_ai_dev_tool ? "roundup" : "not_ai_dev_tool";
    await db
      .prepare("UPDATE posts SET classification = ?, confidence = ?, post_type = ?, version = ?, status = 'dropped', drop_reason = ? WHERE id = ?")
      .bind(...fields, reason, post.id)
      .run();
    return { status: "dropped", reason };
  }

  const toolId = await resolveTool(db, c, post);
  // A threshold of 1 means everything is reviewed, even confidence 1.0.
  const publish = threshold < 1 && c.confidence >= threshold && c.category !== "other";
  const status = publish ? "published" : "queued";
  await db.batch([
    db
      .prepare("UPDATE posts SET classification = ?, confidence = ?, post_type = ?, version = ?, status = ?, tool_id = ? WHERE id = ?")
      .bind(...fields, status, toolId, post.id),
    db
      .prepare(
        `UPDATE tools SET
           last_post_at = max(coalesce(last_post_at, ''), ?1),
           first_seen_at = min(first_seen_at, ?1),
           is_active = 1,
           status = CASE WHEN ?2 AND status = 'queued' THEN 'published' ELSE status END
         WHERE id = ?3`,
      )
      .bind(post.posted_at, publish ? 1 : 0, toolId),
  ]);
  return { status, tool_id: toolId, confidence: c.confidence };
}

/** Review decisions marked "use in prompt", newest first, up to max_fewshot. */
async function loadFewShot(db: D1Database, limit: number): Promise<FewShotExample[]> {
  if (limit <= 0) return [];
  const { results } = await db
    .prepare(
      `SELECT p.source, p.title, p.url, p.classification, d.corrected_fields
       FROM review_decisions d JOIN posts p ON p.id = d.post_id
       WHERE d.use_in_prompt = 1 AND p.classification IS NOT NULL
       ORDER BY d.decided_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ source: string; title: string; url: string; classification: string; corrected_fields: string | null }>();
  return results.map((r) => ({
    post: { source: r.source, title: r.title, url: r.url },
    output: { ...JSON.parse(r.classification), ...(r.corrected_fields ? JSON.parse(r.corrected_fields) : {}) },
  }));
}
