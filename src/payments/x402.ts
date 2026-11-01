import { HTTPFacilitatorClient } from "@x402/core/server";
import type { HTTPRequestContext, HTTPTransportContext, RoutesConfig } from "@x402/core/http";
import { x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { getAddress } from "viem";
import { env, payment } from "../config.js";
import { CATALOG } from "../catalog.js";
import { tasks } from "../db/db.js";

/** Route the x402 middleware protects. One task = one payment. */
export const PAY_ROUTE = "POST /api/tasks/:id/pay";

export const taskIdFromPath = (p: string) => p.match(/^\/api\/tasks\/([^/]+)\/pay\/?$/)?.[1];

const facilitator = new HTTPFacilitatorClient({
  url: payment.facilitatorUrl,
  // The facilitator API key is metered per settlement and must never reach buyers.
  createAuthHeaders: async () => {
    const h = { "X-API-Key": env.X402_API_KEY };
    return { verify: h, settle: h, supported: h };
  },
});

export const resourceServer = new x402ResourceServer(facilitator);
resourceServer.register("eip155:*", new ExactEvmScheme());

/**
 * Per-task pricing: the price is read from the quote stored in the DB, so the buyer
 * signs for exactly the amount quoted in Telegram — never a client-supplied value.
 */
export const routes: RoutesConfig = {
  [PAY_ROUTE]: {
    accepts: {
      scheme: "exact",
      network: payment.network,
      payTo: getAddress(env.PAY_TO_ADDRESS),
      maxTimeoutSeconds: 300,
      price: (ctx: HTTPRequestContext) => {
        const task = tasks.get(taskIdFromPath(ctx.path) ?? "");
        if (!task) throw new Error("unknown task"); // guarded earlier by requireQuotedTask
        return {
          amount: task.price_atomic,
          asset: getAddress(payment.address),
          extra: { ...payment.eip712 },
        };
      },
    },
    description: "haatch — pay for one web3 creative task (flyer, campaign, captions), executed by an OpenCode design agent",
    mimeType: "application/json",
    serviceName: "haatch",
    unpaidResponseBody: (ctx) => {
      const task = tasks.get(taskIdFromPath(ctx.path) ?? "");
      return {
        contentType: "application/json",
        body: task && {
          taskId: task.id,
          type: task.type,
          title: CATALOG[task.type].title,
          price: task.price_atomic,
          asset: payment.symbol,
        },
      };
    },
  },
};

// ── Payment → work handoff ─────────────────────────────────────────────────────
// x402 flow inside the Hono middleware is: verify → route handler → settle → hooks.
// We only start work in `afterSettle`, i.e. once the USA₮ transfer is confirmed on-chain.

type PaidListener = (taskId: string) => void;
const paidListeners: PaidListener[] = [];
export const onTaskPaid = (fn: PaidListener) => paidListeners.push(fn);

const pathOf = (transportContext: unknown) =>
  (transportContext as HTTPTransportContext | undefined)?.request?.path ?? "";

resourceServer.onAfterSettle(async ({ result, transportContext }) => {
  const taskId = taskIdFromPath(pathOf(transportContext));
  if (!taskId) return;
  const won = tasks.transition(taskId, "settling", "paid", {
    tx_hash: result.transaction,
    payer: result.payer ?? null,
    network: result.network,
  });
  if (won) {
    console.log(`[x402] task ${taskId} settled tx=${result.transaction}`);
    for (const fn of paidListeners) fn(taskId);
  }
});

resourceServer.onSettleFailure(async ({ error, transportContext }) => {
  const taskId = taskIdFromPath(pathOf(transportContext));
  if (!taskId) return;
  console.warn(`[x402] settle failed for ${taskId}:`, error);
  tasks.transition(taskId, "settling", "quoted"); // let the buyer retry
});
// Note: no revert on onVerifiedPaymentCanceled. A cancel happens when a *losing* concurrent
// request gets 409 from the handler; the winner still owns the `settling` state.
// Anything genuinely stuck is released by tasks.releaseStaleSettling().
