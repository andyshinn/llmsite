import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../src/index.ts";
import { fakeQueue } from "./helpers.ts";

it("enqueues one daily fetch job per source with an adapter", async () => {
  const fetchQ = fakeQueue();
  const ctx = createExecutionContext();
  const scheduledTime = Date.parse("2026-10-06T06:00:00Z");
  await worker.scheduled(createScheduledController({ cron: "0 6 * * *", scheduledTime }), { ...env, FETCH_QUEUE: fetchQ.queue }, ctx);
  await waitOnExecutionContext(ctx);
  expect(fetchQ.sent).toEqual([
    { kind: "fetch", source: "hn", mode: "daily", until: "2026-10-06T06:00:00.000Z" },
    { kind: "fetch", source: "lobsters", mode: "daily", until: "2026-10-06T06:00:00.000Z" },
  ]);
});

it("acks malformed messages and jobs with nothing to do", async () => {
  const batch = createMessageBatch("radar-fetch", [
    { id: "bad", timestamp: new Date(), attempts: 1, body: { kind: "fetch", source: "digg" } },
    { id: "noop", timestamp: new Date(), attempts: 1, body: { kind: "fetch", source: "producthunt", mode: "manual" } },
  ]);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  const result = await getQueueResult(batch, ctx);
  expect(result.explicitAcks).toEqual(["bad", "noop"]);
});

it("retries a message whose job throws", async () => {
  const batch = createMessageBatch("radar-classify", [
    { id: "boom", timestamp: new Date(), attempts: 2, body: { kind: "classify", post_id: 1 } },
  ]);
  const brokenDb = {
    prepare() {
      throw new Error("D1 unavailable");
    },
  } as unknown as D1Database;
  const ctx = createExecutionContext();
  await worker.queue(batch, { ...env, DB: brokenDb }, ctx);
  const result = await getQueueResult(batch, ctx);
  expect(result.retryMessages.map((m: { msgId: string }) => m.msgId)).toEqual(["boom"]);
});
