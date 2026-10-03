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

it("runs the scheduled handler", async () => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: "0 6 * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
});

it("acks every queue message", async () => {
  const batch = createMessageBatch("radar-fetch", [
    { id: "a", timestamp: new Date(), attempts: 1, body: { kind: "fetch", source: "hn", mode: "manual" } },
  ]);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  const result = await getQueueResult(batch, ctx);
  expect(result.explicitAcks).toEqual(["a"]);
});
