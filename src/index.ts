import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { env, payment } from "./config.js";
import { createApp } from "./http/server.js";
import { onTaskPaid } from "./payments/x402.js";
import { OpenCodeRunner } from "./workers/opencode-runner.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { Renderer } from "./render/renderer.js";
import { createBot, telegramNotifier } from "./bot/telegram.js";

const runner = new OpenCodeRunner();
runner.start(); // boots OpenCode in the background; the web server and bot come up first

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

const app = createApp();

// Webhook mode: Telegram POSTs each update to us, which also wakes hosts that sleep when idle.
// The secret (derived from the bot token, so it's stable across restarts) keeps others out.
const webhookSecret = createHash("sha256").update(`haatch:${env.TELEGRAM_BOT_TOKEN}`).digest("hex").slice(0, 48);
const webhookPath = `/telegram/${webhookSecret.slice(0, 16)}`;
if (env.TELEGRAM_MODE === "webhook") {
  app.post(webhookPath, async (c) => {
    if (c.req.header("x-telegram-bot-api-secret-token") !== webhookSecret) return c.text("unauthorized", 401);
    try {
      await bot.handleUpdate(await c.req.json());
    } catch (e) {
      // Always answer 200: a non-2xx makes Telegram re-deliver the same update over and over.
      console.error("[bot] update failed:", e);
    }
    return c.text("ok");
  });
}

const http = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) =>
  console.log(`[http] :${port} · ${payment.symbol} on ${payment.network} · public ${env.PUBLIC_URL}`),
);

if (env.TELEGRAM_MODE === "webhook") {
  await bot.init();
  await bot.api.setWebhook(`${env.PUBLIC_URL}${webhookPath}`, { secret_token: webhookSecret });
  console.log(`[bot] @${bot.botInfo.username} webhook → ${env.PUBLIC_URL}/telegram/…`);
} else {
  // bot.start() removes any webhook left over from a webhook deployment before polling.
  void bot.start({ onStart: (me) => console.log(`[bot] @${me.username} polling`) });
}

const shutdown = async () => {
  orchestrator.stop();
  if (env.TELEGRAM_MODE === "polling") await bot.stop();
  http.close();
  runner.stop();
  await renderer.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
