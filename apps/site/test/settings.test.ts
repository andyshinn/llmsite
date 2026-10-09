import { env } from "cloudflare:workers";
import { getSetting } from "@radar/core";
import { describe, expect, it } from "vitest";
import { SETTING_FIELDS, SettingError, formatTagGroups, loadSettings, saveSetting, suggestedTags } from "../src/lib/settings-admin.ts";

const db = env.DB;
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("saveSetting", () => {
  it("covers every setting key", async () => {
    const stored = await loadSettings(db);
    expect(SETTING_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(stored).sort());
  });

  it("saves numbers, lines, weights and reasoning levels", async () => {
    await saveSetting(db, "review_threshold", form({ value: "0.85" }));
    expect(await getSetting(db, "review_threshold")).toBe(0.85);

    await saveSetting(db, "github_topics", form({ value: " mcp\nclaude-code \n\n ai-agents" }));
    expect(await getSetting(db, "github_topics")).toEqual(["mcp", "claude-code", "ai-agents"]);

    await saveSetting(db, "trending_weights", form({ w_s: "2", w_e: "1", w_g: "0.5", g: "1.8" }));
    expect(await getSetting(db, "trending_weights")).toEqual({ w_s: 2, w_e: 1, w_g: 0.5, g: 1.8 });

    await saveSetting(db, "model_reasoning_effort", form({ value: "" }));
    expect(await getSetting(db, "model_reasoning_effort")).toBe("");
    await saveSetting(db, "model_reasoning_effort", form({ value: "low" }));
  });

  it.each([
    ["review_threshold", { value: "1.5" }],
    ["review_threshold", { value: "" }],
    ["max_fewshot", { value: "2.5" }],
    ["github_min_stars", { value: "-1" }],
    ["categories", { value: "agent\ncli" }], // missing "other"
    ["categories", { value: "Agent\nother" }], // not lowercase
    ["categories", { value: "cli\ncli\nother" }],
    ["model_id", { value: "" }],
    ["model_reasoning_effort", { value: "extreme" }],
    ["trending_weights", { w_s: "1", w_e: "1", w_g: "", g: "1" }],
    ["no_such_setting", { value: "1" }],
  ])("rejects %s = %j", async (key, entries) => {
    const before = await loadSettings(db);
    await expect(saveSetting(db, key, form(entries))).rejects.toBeInstanceOf(SettingError);
    expect(await loadSettings(db)).toEqual(before);
  });
});

describe("tags setting", () => {
  it("round-trips the seeded vocabulary through the text format", async () => {
    const seeded = await getSetting(db, "tags");
    expect(seeded.map((g) => g.slug)).toEqual(["works-with", "models", "platform", "interface"]);
    const text = formatTagGroups(seeded);
    expect(text).toContain("# Works with | the coding agent or editor it plugs into or drives\nclaude-code: Claude Code");
    await saveSetting(db, "tags", form({ value: text }));
    expect(await getSetting(db, "tags")).toEqual(seeded);
  });

  it("parses groups and tags, and rejects duplicates and bad slugs with a pointer", async () => {
    const original = await getSetting(db, "tags");
    try {
      await saveSetting(db, "tags", form({ value: "# Works with | host agent\nclaude-code: Claude Code\nkiro\n\n# Platform\nmacos: macOS" }));
      expect(await getSetting(db, "tags")).toEqual([
        { slug: "works-with", label: "Works with", hint: "host agent", tags: [{ slug: "claude-code", label: "Claude Code" }, { slug: "kiro", label: "kiro" }] },
        { slug: "platform", label: "Platform", hint: "", tags: [{ slug: "macos", label: "macOS" }] },
      ]);
      await expect(saveSetting(db, "tags", form({ value: "# A\nx\n# B\nx" }))).rejects.toThrow("only once");
      await expect(saveSetting(db, "tags", form({ value: "# Works with\nClaude Code" }))).rejects.toThrow('Works with, "Claude Code"');
      await expect(saveSetting(db, "tags", form({ value: "orphan: Orphan" }))).rejects.toThrow(SettingError);
    } finally {
      await db.prepare("UPDATE settings SET value = ? WHERE key = 'tags'").bind(JSON.stringify(original)).run();
    }
  });

  it("lists tags the classifier suggested", async () => {
    await db.prepare("DELETE FROM posts").run();
    await db
      .prepare(
        `INSERT INTO posts (source, external_id, url, canonical_url, title, posted_at, status, classification) VALUES
         ('hn', 's1', 'u', 'u', 't', '2026-10-01T00:00:00Z', 'queued', '{"suggested_tags":["kiro","amp"]}'),
         ('hn', 's2', 'u', 'u', 't', '2026-10-01T00:00:00Z', 'queued', '{"suggested_tags":["kiro"]}'),
         ('hn', 's3', 'u', 'u', 't', '2026-10-01T00:00:00Z', 'dropped', '{"suggested_tags":["ignored"]}')`,
      )
      .run();
    expect(await suggestedTags(db)).toEqual([{ tag: "kiro", n: 2 }, { tag: "amp", n: 1 }]);
    await db.prepare("DELETE FROM posts").run();
  });
});
