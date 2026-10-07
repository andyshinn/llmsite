import { describe, expect, it } from "vitest";
import { githubHref, safeHref } from "../src/lib/ui.ts";

describe("link helpers", () => {
  it("links http(s) homepages only", () => {
    expect(safeHref("https://patchwork.dev/")).toBe("https://patchwork.dev/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });

  it("turns owner/repo into a GitHub URL", () => {
    expect(githubHref("acme/patchwork")).toBe("https://github.com/acme/patchwork");
    expect(githubHref("acme/patch work")).toBeNull();
    expect(githubHref("https://evil.example/x")).toBeNull();
    expect(githubHref(null)).toBeNull();
  });
});
