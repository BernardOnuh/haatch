import { serve } from "@hono/node-server";
import { env, payment } from "./config.js";
import { createApp } from "./http/server.js";
import { onTaskPaid } from "./payments/x402.js";
import { OpenCodeRunner } from "./workers/opencode-runner.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { Renderer } from "./render/renderer.js";
import { createBot, telegramNotifier } from "./bot/telegram.js";

const runner = new OpenCodeRunner();
await runner.start();

// Free-trial tasks skip payment and go straight to the worker queue.
const renderer = new Renderer();
const bot = createBot({
  startTask: (taskId) => orchestrator.enqueue(taskId),
  revise: (taskId, feedback) => orchestrator.revise(taskId, feedback),
  runner,
});
const orchestrator = new Orchestrator(runner, renderer, telegramNotifier(bot), env.WORKER_CONCURRENCY);

// ── THE HANDOFF ── x402 settled on Celo → queue → OpenCode agent session.
onTaskPaid((taskId) => orchestrator.enqueue(taskId));
orchestrator.start();

const http = serve({ fetch: createApp().fetch, port: env.PORT }, ({ port }) =>
  console.log(`[http] :${port} · ${payment.symbol} on ${payment.network} · public ${env.PUBLIC_URL}`),
);
void bot.start({ onStart: (me) => console.log(`[bot] @${me.username} polling`) });

const shutdown = async () => {
  orchestrator.stop();
  await bot.stop();
  http.close();
  runner.stop();
  await renderer.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
