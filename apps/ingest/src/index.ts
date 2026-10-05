// Ingest Worker. Launch-plan step 1 stub: the cron handler and queue consumer
// are wired up so the deploy works end to end; adapters and the classifier
// arrive in later steps.

export default {
  async scheduled(controller, _env, _ctx) {
    console.log(JSON.stringify({ event: "cron", cron: controller.cron, at: new Date(controller.scheduledTime).toISOString() }));
  },

  async queue(batch, _env, _ctx) {
    for (const message of batch.messages) {
      console.log(JSON.stringify({ event: "message", queue: batch.queue, id: message.id, body: message.body }));
      message.ack();
    }
  },
} satisfies ExportedHandler<Env>;
