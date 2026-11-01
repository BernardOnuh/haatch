import { Hono, type MiddlewareHandler } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { paymentMiddleware } from "@x402/hono";
import { z } from "zod";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { env, paths, payment } from "../config.js";
import { CATALOG, formatAtomic, isTaskType, listedServices, toAtomic } from "../catalog.js";
import type { StoredResult } from "../workers/result-schema.js";
import { tasks, type Task } from "../db/db.js";
import { resourceServer, routes } from "../payments/x402.js";
import { payPage } from "./pay-page.js";
import { agentCard, agentUri, IDENTITY_REGISTRY } from "../identity/erc8004.js";
import { attributionSuffix } from "../identity/attribution.js";

const publicTask = (t: Task) => ({
  id: t.id,
  type: t.type,
  title: CATALOG[t.type].title,
  status: t.status,
  price: { amount: formatAtomic(t.price_atomic), atomic: t.price_atomic, asset: payment.symbol },
  receipt: t.tx_hash ? { tx: t.tx_hash, payer: t.payer, network: t.network, url: `${payment.explorer}/tx/${t.tx_hash}` } : null,
  createdAt: t.created_at,
});

/** Reject payment attempts for tasks that don't exist or are already paid, *before* x402 runs. */
const requireQuotedTask: MiddlewareHandler = async (c, next) => {
  const task = tasks.get(c.req.param("id") ?? "");
  if (!task) return c.json({ error: "task not found" }, 404);
  if (task.status !== "quoted") return c.json({ error: `task is ${task.status}`, task: publicTask(task) }, 409);
  await next();
};

export function createApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, network: payment.network, asset: payment.symbol }));

  // ERC-8004 registration file — the agentURI registered on-chain points here.
  app.get("/.well-known/agent-registration.json", (c) => c.json(agentCard()));

  app.get("/api/catalog", (c) =>
    c.json(
      listedServices().map(([type, s]) => ({
        type,
        title: s.title,
        deliverable: s.deliverable,
        price: { amount: s.price, asset: payment.symbol },
      })),
    ),
  );

  // Agent-to-agent entry point: other agents can create + pay tasks without Telegram.
  // (Results for API-created tasks are fetched via GET /api/tasks/:id.)
  app.post("/api/tasks", async (c) => {
    const body = z
      .object({ type: z.string().refine((t) => listedServices().some(([type]) => type === t), "unknown task type"), brief: z.string().min(20).max(4000) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues }, 400);
    const type = body.data.type as keyof typeof CATALOG;
    const task = tasks.create({ chat_id: 0, user_id: 0, type, brief: body.data.brief, price_atomic: toAtomic(CATALOG[type].price) });
    return c.json({ ...publicTask(task), payUrl: `${env.PUBLIC_URL}/api/tasks/${task.id}/pay` }, 201);
  });

  app.get("/api/tasks/:id", (c) => {
    const task = tasks.get(c.req.param("id"));
    if (!task) return c.json({ error: "not found" }, 404);
    const done = task.status === "delivered" || task.status === "completed";
    const result = done ? (JSON.parse(task.result_json ?? "null") as StoredResult | null) : null;
    return c.json({
      ...publicTask(task),
      // Rendered files (PNG flyers / MP4 videos); the HTML sources stay server-side.
      result: result && {
        ...result,
        assets: undefined,
        rendered: (result.rendered ?? []).map((a) => ({ ...a, url: `${env.PUBLIC_URL}/assets/${a.file}` })),
      },
    });
  });

  // ── x402-protected payment endpoint ──
  // verify → handler (claims the task) → settle on Celo → afterSettle hook → worker queue
  app.post("/api/tasks/:id/pay", requireQuotedTask, paymentMiddleware(routes, resourceServer), (c) => {
    const id = c.req.param("id");
    // Payment is verified but not yet settled. Claim the task so a concurrent second
    // payment for the same task gets 409 and is never settled (no double charge).
    if (!tasks.transition(id, "quoted", "settling")) return c.json({ error: "payment already in progress" }, 409);
    return c.json({ ok: true, taskId: id, status: "paid", message: "Payment received. An agent is starting on your task." });
  });

  // Human payment page opened from the Telegram "Pay" button.
  app.get("/pay/:id", (c) => {
    const task = tasks.get(c.req.param("id"));
    if (!task || c.req.query("t") !== task.pay_token) return c.text("Payment link invalid or expired.", 404);
    return c.html(payPage(task));
  });
  app.get("/pay.js", serveStatic({ path: "./public/pay.js" }));
  // Operator page: register the ERC-8004 identity from your own wallet, with the ERC-8021 tag.
  app.get("/register-agent", (c) => {
    if (!env.ADMIN_TOKEN || c.req.query("t") !== env.ADMIN_TOKEN) return c.notFound();
    let suffix: string | null = null;
    try {
      suffix = attributionSuffix(env.ATTRIBUTION_CODE);
    } catch {}
    const boot = JSON.stringify({
      chainId: payment.network === "eip155:42220" ? 42220 : 11142220,
      registry: IDENTITY_REGISTRY[payment.network],
      agentUri: agentUri(),
      suffix,
      explorer: payment.explorer,
      code: env.ATTRIBUTION_CODE ?? null,
    });
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Register haatch agent</title><style>
body{margin:0;font:16px/1.5 system-ui;background:#0a0b0d;color:#f4f5f0;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:560px;width:100%;background:#15171b;border:1px solid #2a2d33;border-radius:16px;padding:24px}
h1{margin:0 0 6px;font-size:22px}.m{color:#8b8f87;font-size:14px}code{color:#c8ff3d;word-break:break-all}
button{margin-top:18px;width:100%;padding:14px;border:0;border-radius:12px;background:#c8ff3d;color:#0a0b0d;font-weight:700;font-size:16px;cursor:pointer}
button:disabled{opacity:.5}#log div{margin-top:10px;font-size:14px}.ok{color:#c8ff3d}.err{color:#ff6a5a}a{color:inherit}
</style></head><body><main>
<h1>Register haatch on ERC-8004</h1>
<div class="m">Network: <b>${payment.network === "eip155:42220" ? "Celo mainnet" : "Celo Sepolia (testnet)"}</b><br>
Registry: <code>${IDENTITY_REGISTRY[payment.network]}</code><br>
Agent URI: <code>${agentUri()}</code><br>
ERC-8021 attribution: ${env.ATTRIBUTION_CODE ? `<code>${env.ATTRIBUTION_CODE}</code> ✓` : `<b style="color:#ff6a5a">not set: registration blocked</b>`}<br>
${env.AGENT_ID ? `<b style="color:#ff6a5a">AGENT_ID is already set (${env.AGENT_ID}). Registering again creates a second identity.</b>` : ""}</div>
<button id="go">Connect wallet & register</button><div id="log"></div>
</main><script>window.__REG__=${boot};</script><script type="module" src="/register.js"></script></body></html>`);
  });
  app.get("/register.js", serveStatic({ path: "./public/register.js" }));

  // Logo referenced by the ERC-8004 registration file.
  app.get("/logo.png", serveStatic({ path: "./brand/haatch-avatar.png" }));

  // Rendered assets. The task UUID in the path acts as the access capability (MVP).
  app.get("/assets/:taskId/:file", async (c) => {
    const { taskId, file } = c.req.param();
    if (!/^[0-9a-f-]{36}$/.test(taskId) || !/^[a-z0-9-]+\.(png|mp4)$/.test(file)) return c.notFound();
    const bytes = await readFile(path.join(paths.assets, taskId, file)).catch(() => null);
    if (!bytes) return c.notFound();
    return c.body(bytes, 200, { "content-type": file.endsWith(".mp4") ? "video/mp4" : "image/png" });
  });

  return app;
}
