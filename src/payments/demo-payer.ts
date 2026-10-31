import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import { env, payment } from "../config.js";

export type DemoPayResult = { ok: true; tx?: string } | { ok: false; error: string };

/**
 * Testnet demo wallet: pays a task's quote through the *real* x402 flow — it calls our own
 * x402-protected endpoint exactly like an external agent would, so the Celo facilitator
 * verifies and settles on-chain and the tester gets a real tx receipt. No wallet needed.
 */
function createDemoPayer(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const client = new x402Client();
  client.setSpendControls({ maxAmountPerPayment: "$10" }); // stock default is $1; tasks cost more
  client.register("eip155:*", new ExactEvmScheme(account));
  const payFetch = wrapFetchWithPayment(fetch, client);
  const chain = createPublicClient({ chain: celoSepolia, transport: http() });

  return {
    address: account.address,

    /** Test-USDC balance, for the funding script and low-balance warnings. */
    async balance(): Promise<string> {
      const raw = await chain.readContract({
        address: getAddress(payment.address),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      return formatUnits(raw, payment.decimals);
    },

    async pay(taskId: string): Promise<DemoPayResult> {
      try {
        const res = await payFetch(`http://127.0.0.1:${env.PORT}/api/tasks/${taskId}/pay`, { method: "POST" });
        if (res.ok) {
          const receipt = res.headers.get("payment-response");
          return { ok: true, tx: receipt ? decodePaymentResponseHeader(receipt).transaction : undefined };
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        let reason = body.error ?? `HTTP ${res.status}`;
        const required = res.headers.get("payment-required");
        if (required) {
          try {
            reason = JSON.parse(Buffer.from(required, "base64").toString()).error ?? reason;
          } catch {}
        }
        return { ok: false, error: reason };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}

export const demoPayer = env.DEMO_PAYER_PRIVATE_KEY
  ? createDemoPayer(env.DEMO_PAYER_PRIVATE_KEY as `0x${string}`)
  : undefined;
