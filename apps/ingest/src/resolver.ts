import {
  type Classification,
  githubRepoFromUrl,
  hostOf,
  isGenericHost,
  normalizeToolName,
  similarity,
  slugify,
} from "@radar/core";

export const FUZZY_MERGE_THRESHOLD = 0.9;

type AliasKind = "repo" | "domain" | "name";
type Identifiers = Partial<Record<AliasKind, string>>;

interface PostRef {
  url: string;
  title: string;
  posted_at: string;
}

export function identifiers(c: Classification, post: PostRef): Identifiers {
  const ids: Identifiers = {};
  const repo = c.github_repo ?? githubRepoFromUrl(post.url);
  if (repo) ids.repo = repo;
  const host = c.homepage_url ? hostOf(c.homepage_url) : null;
  if (host && !isGenericHost(host)) ids.domain = host;
  const name = normalizeToolName(displayName(c, post));
  if (name) ids.name = name;
  return ids;
}

function displayName(c: Classification, post: PostRef): string {
  return c.tool_name || c.github_repo?.split("/")[1] || githubRepoFromUrl(post.url)?.split("/")[1] || post.title;
}

/**
 * Resolves a classified post to exactly one tool: GitHub repo, then homepage
 * domain, then exact or fuzzy (>= 0.9) normalized name; otherwise creates a tool.
 * Matched and new identifiers are stored as aliases.
 */
export async function resolveTool(db: D1Database, c: Classification, post: PostRef): Promise<number> {
  const ids = identifiers(c, post);
  // A concurrent consumer may create the same tool; its aliases then collide and we retry the lookup.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const match = await findTool(db, ids);
    if (match !== null) {
      await addAliases(db, match, ids);
      await fillBlanks(db, match, c, ids);
      return match;
    }
    try {
      return await createTool(db, c, post, ids);
    } catch (err) {
      if (!String(err).includes("UNIQUE constraint failed") || attempt === 3) throw err;
    }
  }
  throw new Error("unreachable");
}

async function findTool(db: D1Database, ids: Identifiers): Promise<number | null> {
  for (const kind of ["repo", "domain", "name"] as const) {
    const value = ids[kind];
    if (!value) continue;
    const row = await db
      .prepare("SELECT tool_id FROM tool_aliases WHERE kind = ? AND value = ?")
      .bind(kind, value)
      .first<{ tool_id: number }>();
    if (row) return row.tool_id;
  }
  if (!ids.name) return null;

  const len = ids.name.length;
  const { results } = await db
    .prepare("SELECT tool_id, value FROM tool_aliases WHERE kind = 'name' AND length(value) BETWEEN ? AND ?")
    .bind(Math.floor(len * FUZZY_MERGE_THRESHOLD), Math.ceil(len / FUZZY_MERGE_THRESHOLD))
    .all<{ tool_id: number; value: string }>();
  let best: { tool_id: number; score: number } | null = null;
  for (const row of results) {
    const score = similarity(ids.name, row.value);
    if (score >= FUZZY_MERGE_THRESHOLD && (!best || score > best.score)) best = { tool_id: row.tool_id, score };
  }
  return best?.tool_id ?? null;
}

async function addAliases(db: D1Database, toolId: number, ids: Identifiers): Promise<void> {
  const statements = Object.entries(ids).map(([kind, value]) =>
    db.prepare("INSERT OR IGNORE INTO tool_aliases (tool_id, kind, value) VALUES (?, ?, ?)").bind(toolId, kind, value),
  );
  if (statements.length) await db.batch(statements);
}

/** Fills empty tool fields from a new classification; never overwrites (admin edits win). */
async function fillBlanks(db: D1Database, toolId: number, c: Classification, ids: Identifiers): Promise<void> {
  await db
    .prepare(
      `UPDATE tools SET
         github_repo = coalesce(github_repo, ?),
         homepage_url = coalesce(homepage_url, ?),
         description = coalesce(description, ?),
         category = coalesce(category, ?),
         is_open_source = coalesce(is_open_source, ?)
       WHERE id = ?`,
    )
    .bind(ids.repo ?? null, c.homepage_url, c.description || null, c.category, c.is_open_source ? 1 : 0, toolId)
    .run();
}

async function createTool(db: D1Database, c: Classification, post: PostRef, ids: Identifiers): Promise<number> {
  const name = displayName(c, post);
  const slug = await uniqueSlug(db, slugify(name));
  const aliasStatements = Object.entries(ids).map(([kind, value]) =>
    db.prepare("INSERT INTO tool_aliases (tool_id, kind, value) SELECT id, ?, ? FROM tools WHERE slug = ?").bind(kind, value, slug),
  );
  // One batch = one transaction: the tool and its aliases appear together or not at all.
  const [inserted] = await db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO tools (slug, name, description, category, tags, homepage_url, github_repo, is_open_source, status, first_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
         RETURNING id`,
      )
      .bind(
        slug,
        name,
        c.description || null,
        c.category,
        JSON.stringify(c.tags),
        c.homepage_url,
        ids.repo ?? null,
        c.is_open_source ? 1 : 0,
        post.posted_at,
      ),
    ...aliasStatements,
  ]);
  return inserted!.results[0]!.id;
}

async function uniqueSlug(db: D1Database, base: string): Promise<string> {
  // No LIKE here: production D1 rejects LIKE patterns over 50 bytes ("pattern too
  // complex"), while local SQLite allows 50,000, so tests would not catch it.
  const { results } = await db
    .prepare("SELECT slug FROM tools WHERE slug = ?1 OR substr(slug, 1, length(?1) + 1) = ?1 || '-'")
    .bind(base)
    .all<{ slug: string }>();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
