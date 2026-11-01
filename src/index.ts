import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { env, payment } from "./config.js";
import { createApp } from "./http/server.js";
import { onTaskPaid } from "./payments/x402.js";
import { createRunner } from "./workers/runner.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { Renderer } from "./render/renderer.js";
import { createBot, telegramNotifier } from "./bot/telegram.js";

const runner = await createRunner(); // AGENT_ENGINE: opencode (default) or direct
runner.start(); // OpenCode boots in the background (direct engine is instant); web server and bot come up first

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
  // Register the webhook in the background, retrying, so a Telegram hiccup at boot can't
  // take the web server (and x402 payments) down with it.
  void (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await bot.init();
        await bot.api.setWebhook(`${env.PUBLIC_URL}${webhookPath}`, { secret_token: webhookSecret });
        console.log(`[bot] @${bot.botInfo.username} webhook → ${env.PUBLIC_URL}/telegram/…`);
        return;
      } catch (e) {
        console.error(`[bot] webhook setup attempt ${attempt} failed: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, Math.min(60_000, 5_000 * attempt)));
      }
    }
  })();
} else {
  // bot.start() removes any webhook left over from a webhook deployment before polling.
  void bot.start({ onStart: (me) => console.log(`[bot] @${me.username} polling`) });
}

if (env.KEEP_AWAKE) {
  setInterval(() => void fetch(`${env.PUBLIC_URL}/health`).catch(() => {}), 10 * 60_000);
  console.log("[http] keep-awake: pinging /health every 10 min");
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
