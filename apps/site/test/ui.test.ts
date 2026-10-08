import { describe, expect, it } from "vitest";
import { aboutDuration, githubHref, safeHref } from "../src/lib/ui.ts";

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

describe("aboutDuration", () => {
  it("rounds to minutes, hours or days", () => {
    expect(aboutDuration(0.2)).toBe("about 1 minute");
    expect(aboutDuration(45)).toBe("about 45 minutes");
    expect(aboutDuration(150)).toBe("about 3 hours");
    expect(aboutDuration(5 * 1440)).toBe("about 5 days");
  });
});
