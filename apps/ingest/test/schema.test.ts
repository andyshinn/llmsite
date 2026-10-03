import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SETTING_KEYS, getSetting } from "@radar/core";

describe("migration 0001", () => {
  it("seeds every setting with a valid default", async () => {
    for (const key of SETTING_KEYS) {
      await expect(getSetting(env.DB, key)).resolves.toBeDefined();
    }
    expect(await getSetting(env.DB, "review_threshold")).toBe(1);
  });

  it("keeps tools_fts in sync on insert, update and delete", async () => {
    const search = (q: string) =>
      env.DB.prepare("SELECT rowid FROM tools_fts WHERE tools_fts MATCH ?").bind(q).all<{ rowid: number }>();

    const { meta } = await env.DB.prepare(
      "INSERT INTO tools (slug, name, description, tags) VALUES ('zed', 'Zed', 'Fast editor with agents', '[\"ide\",\"rust\"]')",
    ).run();
    const id = meta.last_row_id;

    expect((await search("agents")).results).toEqual([{ rowid: id }]);
    expect((await search("rust")).results).toEqual([{ rowid: id }]);

    await env.DB.prepare("UPDATE tools SET description = 'Collaborative editor' WHERE id = ?").bind(id).run();
    expect((await search("agents")).results).toEqual([]);
    expect((await search("collaborative")).results).toEqual([{ rowid: id }]);

    await env.DB.prepare("DELETE FROM tools WHERE id = ?").bind(id).run();
    expect((await search("collaborative")).results).toEqual([]);
  });
});
