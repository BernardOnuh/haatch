// End-to-end buyer test (agent-to-agent path): create a task over the API and pay it with x402.
//   BUYER_PRIVATE_KEY=0x... npm run test-pay -- http://localhost:3000
// On testnet, fund the buyer with Celo Sepolia USDC from https://faucet.circle.com
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const base = process.argv[2] ?? "http://localhost:3000";
const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`);

const client = new x402Client();
client.setSpendControls({ maxAmountPerPayment: "$10" }); // default cap is $1
client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: "https://forno.celo.org" }));
const payFetch = wrapFetchWithPayment(fetch, client);

const created = await fetch(`${base}/api/tasks`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "content_ideas",
    brief: "Name: Ledgerly. Stablecoin invoicing + instant payouts for freelancers in Nigeria and Kenya. Tone: warm, no jargon.",
  }),
}).then((r) => r.json());
console.log("quote:", created.price, created.id);

const paid = await payFetch(`${base}/api/tasks/${created.id}/pay`, { method: "POST" });
const header = paid.headers.get("payment-response");
console.log(paid.status, await paid.json(), header ? decodePaymentResponseHeader(header) : "(no receipt header)");

for (;;) {
  const t = await fetch(`${base}/api/tasks/${created.id}`).then((r) => r.json());
  console.log("status:", t.status);
  if (t.status === "delivered" || t.status === "failed") {
    console.log(JSON.stringify(t, null, 2));
    break;
  }
  await new Promise((r) => setTimeout(r, 5000));
}
