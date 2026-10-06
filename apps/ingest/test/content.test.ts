import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleKey, getArticleText, readCapped, readable } from "../src/content.ts";
import articleHtml from "./fixtures/article.html?raw";
import lobstersStory from "./fixtures/lobsters-story.json";
import { fakeFetch, json, makeDeps } from "./helpers.ts";

let nextId = 1000;
beforeEach(() => {
  nextId++;
});

describe("readable", () => {
  it("keeps the article and drops navigation, scripts and footer", () => {
    const text = readable(articleHtml);
    expect(text).toContain("open-source coding agent that reviews pull requests");
    expect(text).not.toContain("Pricing");
    expect(text).not.toContain("window.analytics");
    expect(text).not.toContain("Privacy");
  });
});

describe("readCapped", () => {
  it("stops reading at the byte cap and cancels the rest of the body", async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode("a".repeat(1000)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const text = await readCapped(new Response(endless), 2500);
    expect(text).toHaveLength(2500);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
  });
});

describe("getArticleText", () => {
  it("extracts a web page and caches it in R2", async () => {
    const page = () => new Response(articleHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
    const fetcher = fakeFetch((u) => (u === "https://patchwork.example/blog/launch" ? page() : undefined));
    const post = { id: nextId, url: "https://patchwork.example/blog/launch" };

    const text = await getArticleText(post, makeDeps({ fetch: fetcher }));
    expect(text).toContain("Version 1.0 adds support for monorepos");
    expect(await (await env.ARTICLES.get(articleKey(post.id)))!.text()).toBe(text);

    await getArticleText(post, makeDeps({ fetch: fetcher }));
    expect(fetcher.calls).toHaveLength(1); // second read came from R2
  });

  it("falls back to raw.githubusercontent.com when the README API is rate limited", async () => {
    const fetcher = fakeFetch(
      (u) => (u === "https://api.github.com/repos/acme/tool/readme" ? new Response("rate limited", { status: 403 }) : undefined),
      (u) => (u === "https://raw.githubusercontent.com/acme/tool/HEAD/README.md" ? new Response("# Tool\n\nAn AI CLI.") : undefined),
    );
    const text = await getArticleText({ id: nextId, url: "https://github.com/acme/tool" }, makeDeps({ fetch: fetcher }));
    expect(text).toBe("# Tool\n\nAn AI CLI.");
  });

  it("reads lobste.rs text posts from the story JSON", async () => {
    const fetcher = fakeFetch((u) => (u === "https://lobste.rs/s/nvkrb9.json" ? json(lobstersStory) : undefined));
    const text = await getArticleText(
      { id: nextId, url: "https://lobste.rs/s/nvkrb9/what_are_you_doing_this_week" },
      makeDeps({ fetch: fetcher }),
    );
    expect(text).toContain("What are you doing this week?");
  });

  it("returns empty text and caches nothing when the fetch fails", async () => {
    const fetcher = fakeFetch(() => new Response("nope", { status: 404 }));
    const post = { id: nextId, url: "https://gone.example/" };
    expect(await getArticleText(post, makeDeps({ fetch: fetcher }))).toBe("");
    expect(await env.ARTICLES.get(articleKey(post.id))).toBeNull();
  });
});
