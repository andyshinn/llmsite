import { type FetchJob, classifyJobSchema, fetchJobSchema } from "@radar/core";
import { requeueStalePending, runClassifyJob } from "./classify-job.ts";
import { depsFromEnv } from "./deps.ts";
import { runFetchJob } from "./fetch-job.ts";
import { ADAPTERS } from "./sources/index.ts";

export const FETCH_QUEUE = "radar-fetch";
export const CLASSIFY_QUEUE = "radar-classify";

export default {
  // Daily run: one fetch job per source that has an adapter, plus a retry of
  // posts left pending (e.g. while the AI spend limit was blocking calls).
  async scheduled(controller, env, _ctx) {
    const until = new Date(controller.scheduledTime).toISOString();
    const jobs: FetchJob[] = Object.keys(ADAPTERS).map((source) => ({
      kind: "fetch",
      source: source as FetchJob["source"],
      mode: "daily",
      until,
    }));
    await env.FETCH_QUEUE.sendBatch(jobs.map((body) => ({ body })));
    const requeued = await requeueStalePending(env.DB, env.CLASSIFY_QUEUE);
    console.log(JSON.stringify({ event: "cron", sources: jobs.map((j) => j.source), requeued }));
  },

  async queue(batch, env, _ctx) {
    const deps = depsFromEnv(env);
    for (const message of batch.messages) {
      try {
        if (batch.queue === FETCH_QUEUE) {
          const job = fetchJobSchema.safeParse(message.body);
          if (job.success) await runFetchJob(job.data, deps);
          else console.error(JSON.stringify({ event: "bad_message", queue: batch.queue, body: message.body }));
        } else if (batch.queue === CLASSIFY_QUEUE) {
          const job = classifyJobSchema.safeParse(message.body);
          if (job.success) await runClassifyJob(job.data, deps);
          else console.error(JSON.stringify({ event: "bad_message", queue: batch.queue, body: message.body }));
        }
        message.ack();
      } catch (err) {
        console.error(JSON.stringify({ event: "job_failed", queue: batch.queue, body: message.body, attempts: message.attempts, error: String(err) }));
        message.retry({ delaySeconds: 60 * message.attempts });
      }
    }
  },
} satisfies ExportedHandler<Env>;
