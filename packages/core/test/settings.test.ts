import { describe, expect, it } from "vitest";
import { fetchJobSchema, parseSetting } from "../src/index.ts";

describe("parseSetting", () => {
  it("accepts a valid threshold", () => {
    expect(parseSetting("review_threshold", "1")).toBe(1);
  });

  it("rejects an out-of-range threshold", () => {
    expect(() => parseSetting("review_threshold", "1.5")).toThrow();
  });

  it("rejects trending weights with a missing term", () => {
    expect(() => parseSetting("trending_weights", '{"w_s":3,"w_e":1,"w_g":1.5}')).toThrow();
  });
});

describe("fetchJobSchema", () => {
  it("accepts a backfill job", () => {
    const job = { kind: "fetch", source: "hn", mode: "backfill", since: "2026-07-05T00:00:00Z" };
    expect(fetchJobSchema.parse(job)).toEqual(job);
  });

  it("rejects an unknown source", () => {
    expect(fetchJobSchema.safeParse({ kind: "fetch", source: "digg", mode: "daily" }).success).toBe(false);
  });
});

describe("categories setting", () => {
  it("requires other, lowercase slugs and no duplicates", () => {
    expect(parseSetting("categories", '["agent","other"]')).toEqual(["agent", "other"]);
    expect(() => parseSetting("categories", '["agent"]')).toThrow();
    expect(() => parseSetting("categories", '["Agent","other"]')).toThrow();
    expect(() => parseSetting("categories", '["other","other"]')).toThrow();
  });
});
