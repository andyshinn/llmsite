import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ToolError, addAlias, getTool, listTools, removeAlias, setHidden, toolStatusCounts, updateTool } from "../src/lib/tools-admin.ts";

const db = env.DB;
beforeEach(async () => {
  await db.batch(["review_decisions", "post_snapshots", "repo_snapshots", "tool_aliases", "posts", "tool_merges", "reports", "tools"].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

let nextId = 0;
async function tool(name: string, over: { repo?: string; status?: string; category?: string; score?: number; firstSeen?: string } = {}) {
  const id = ++nextId;
  await db.batch([
    db
      .prepare("INSERT INTO tools (id, slug, name, github_repo, status, category, trending_score, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, `${name.toLowerCase().replace(/\W+/g, "-")}-${id}`, name, over.repo ?? null, over.status ?? "queued", over.category ?? "agent", over.score ?? 0, over.firstSeen ?? "2026-10-01T00:00:00.000Z"),
    db.prepare("INSERT INTO tool_aliases (tool_id, kind, value) VALUES (?, 'name', ?)").bind(id, name.toLowerCase().replace(/\W+/g, "")),
    ...(over.repo ? [db.prepare("INSERT INTO tool_aliases (tool_id, kind, value) VALUES (?, 'repo', ?)").bind(id, over.repo)] : []),
  ]);
  return id;
}
async function post(toolId: number, status = "queued", postedAt = "2026-10-05T00:00:00.000Z") {
  const row = await db
    .prepare("INSERT INTO posts (source, external_id, url, canonical_url, title, posted_at, status, tool_id) VALUES ('hn', ?, 'https://x.dev', 'https://x.dev', 'A post', ?, ?, ?) RETURNING id")
    .bind(`p${++nextId}`, postedAt, status, toolId)
    .first<{ id: number }>();
  return row!.id;
}
const form = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of [v].flat()) f.append(k, x);
  return f;
};
const valid = (over: Record<string, string | string[]> = {}) =>
  form({
    name: "Worktrunk", slug: "worktrunk", description: "Git worktrees for agents.", category: "agent-tools",
    tags: ["claude-code", "not-a-tag"], homepage_url: "worktrunk.dev", github_repo: "https://github.com/Max/Worktrunk", is_open_source: "true", ...over,
  });

describe("listTools", () => {
  it("searches names and aliases, filters by status and category, and sorts", async () => {
    const a = await tool("Worktrunk", { repo: "max/worktrunk", status: "published", score: 2 });
    const b = await tool("Hall Monitor", { category: "agent-tools", score: 5 });
    await tool("Hidden Thing", { status: "hidden", firstSeen: "2026-10-07T00:00:00.000Z" });
    await post(a);
    await post(a);

    const byRepo = await listTools(db, { q: "max/work" });
    expect(byRepo.tools.map((t) => t.id)).toEqual([a]);
    expect(byRepo.tools[0]).toMatchObject({ posts: 2, github_repo: "max/worktrunk", status: "published" });
    // "Hall-Monitor" normalizes to the stored name alias "hallmonitor".
    expect((await listTools(db, { q: "Hall-Monitor" })).tools.map((t) => t.id)).toEqual([b]);
    expect((await listTools(db, { status: "hidden" })).total).toBe(1);
    expect((await listTools(db, { category: "agent-tools" })).tools.map((t) => t.id)).toEqual([b]);
    expect((await listTools(db, {})).tools.map((t) => t.name)).toEqual(["Hall Monitor", "Worktrunk", "Hidden Thing"]);
    expect((await listTools(db, { sort: "newest" })).tools[0]!.name).toBe("Hidden Thing");
    expect((await listTools(db, { sort: "bogus", status: "bogus" })).total).toBe(3);
    expect(await toolStatusCounts(db)).toEqual({ published: 1, queued: 1, hidden: 1 });
  });

  it("pages through results", async () => {
    for (let i = 0; i < 55; i++) await tool(`Tool ${i}`);
    const p2 = await listTools(db, { page: 2 });
    expect(p2.total).toBe(55);
    expect(p2.tools).toHaveLength(5);
  });
});

describe("updateTool", () => {
  it("saves validated fields, keeps only vocabulary tags and adds aliases", async () => {
    const id = await tool("Work Trunk");
    await updateTool(db, id, valid());
    const t = await getTool(db, id);
    expect(t).toMatchObject({
      name: "Worktrunk", slug: "worktrunk", description: "Git worktrees for agents.", category: "agent-tools", tags: ["claude-code"],
      homepage_url: "https://worktrunk.dev/", github_repo: "max/worktrunk", is_open_source: 1,
    });
    expect(t!.aliases).toEqual([
      { kind: "repo", value: "max/worktrunk" },
      { kind: "domain", value: "worktrunk.dev" },
      { kind: "name", value: "worktrunk" },
    ]);
  });

  it("refuses a taken slug, another tool's repo, a bad category and a long description", async () => {
    const id = await tool("Worktrunk");
    await tool("Other", { repo: "max/worktrunk" });
    await db.prepare("UPDATE tools SET slug = 'taken' WHERE id != ?").bind(id).run();
    await expect(updateTool(db, id, valid({ slug: "taken" }))).rejects.toThrow('"taken" is already used');
    await expect(updateTool(db, id, valid())).rejects.toThrow("max/worktrunk already belongs to Other. Merge");
    await expect(updateTool(db, id, valid({ github_repo: "", category: "sdk" }))).rejects.toThrow("category");
    await expect(updateTool(db, id, valid({ github_repo: "", description: "x".repeat(141) }))).rejects.toThrow("under 140");
    await expect(updateTool(db, id, valid({ github_repo: "", slug: "Bad Slug" }))).rejects.toThrow(ToolError);
  });
});

describe("aliases", () => {
  it("normalizes, refuses shared hosts and other tools' aliases, and removes", async () => {
    const id = await tool("Worktrunk");
    const other = await tool("Other", { repo: "acme/other" });
    await addAlias(db, id, "repo", "https://github.com/Max/WT");
    await addAlias(db, id, "domain", "https://www.worktrunk.dev/docs");
    await addAlias(db, id, "name", "Work Trunk CLI");
    await expect(addAlias(db, id, "domain", "max.github.io")).rejects.toThrow("shared host");
    await expect(addAlias(db, id, "repo", "acme/other")).rejects.toThrow("already belongs to Other");
    expect((await getTool(db, id))!.aliases).toEqual([
      { kind: "repo", value: "max/wt" },
      { kind: "domain", value: "worktrunk.dev" },
      { kind: "name", value: "worktrunk" },
    ]);
    await removeAlias(db, id, "repo", "max/wt");
    await removeAlias(db, id, "repo", "acme/other"); // not this tool's: no effect
    expect((await getTool(db, id))!.aliases).toHaveLength(2);
    expect((await getTool(db, other))!.aliases).toHaveLength(2);
  });
});

describe("hide", () => {
  it("hides, and unhides to published only if a post is published", async () => {
    const a = await tool("A", { status: "published" });
    await post(a, "published");
    const b = await tool("B");
    await post(b, "queued");
    for (const id of [a, b]) await setHidden(db, id, true);
    expect(await toolStatusCounts(db)).toEqual({ hidden: 2 });
    for (const id of [a, b]) await setHidden(db, id, false);
    expect((await getTool(db, a))!.status).toBe("published");
    expect((await getTool(db, b))!.status).toBe("queued");
  });
});
