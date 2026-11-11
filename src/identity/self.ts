import { HEADERS, SelfAgentVerifier } from "@selfxyz/agent-sdk";
import type { MiddlewareHandler } from "hono";
import { env } from "../config.js";

/**
 * Optional Self Agent ID gate (proof-of-human behind an agent).
 *
 * Self binds an agent's signing key to a zero-knowledge proof that a real,
 * unique human stands behind it. The agent sends three signed headers
 * (`x-self-agent-*`); the verifier recovers the address from the signature,
 * then checks registration + human-proof freshness on Celo. Nothing personal
 * leaves the phone — the service only learns "a verified human controls this
 * agent".
 *
 * Off by default (`SELF_REQUIRED=false`) so the live pay flow is never blocked
 * by an RPC hiccup. Turn it on for the agent-to-agent path on mainnet.
 */

let verifier: SelfAgentVerifier | undefined;

function getVerifier(): SelfAgentVerifier {
  if (verifier) return verifier;
  const builder = SelfAgentVerifier.create()
    .network(env.SELF_NETWORK)
    .sybilLimit(env.SELF_SYBIL_LIMIT);
  if (env.SELF_MIN_AGE && env.SELF_MIN_AGE > 0) builder.requireAge(env.SELF_MIN_AGE);
  verifier = builder.build();
  return verifier;
}

/** Hono middleware: require a valid Self proof before the handler runs. Fails closed. */
export const selfGate = (): MiddlewareHandler => async (c, next) => {
  if (!env.SELF_REQUIRED) return next();

  const signature = c.req.header(HEADERS.SIGNATURE);
  const timestamp = c.req.header(HEADERS.TIMESTAMP);
  if (!signature || !timestamp) {
    return c.json(
      {
        error: "Self proof required",
        detail:
          "Send x-self-agent-signature / x-self-agent-timestamp headers. Use SelfAgent from @selfxyz/agent-sdk — its fetch() adds them automatically. Register at https://self.xyz.",
        headers: HEADERS,
      },
      401,
    );
  }

  const url = new URL(c.req.url);
  const body = await c.req.raw.clone().text();

  try {
    const result = await getVerifier().verify({
      signature,
      timestamp,
      method: c.req.method,
      url: url.pathname + url.search,
      body,
      keytype: c.req.header(HEADERS.KEYTYPE),
      agentKey: c.req.header(HEADERS.KEY),
    });

    if (!result.valid) {
      const status = result.retryAfterMs ? 429 : 401;
      return c.json(
        {
          error: result.error ?? "Self verification failed",
          self: {
            address: result.agentAddress,
            agentId: result.agentId.toString(),
            retryAfterMs: result.retryAfterMs,
          },
        },
        status,
      );
    }

    c.header("x-self-verified-address", result.agentAddress);
    await next();
  } catch (err) {
    console.error("[self] verification error:", err);
    return c.json({ error: "Self verification unavailable, try again" }, 503);
  }
};
