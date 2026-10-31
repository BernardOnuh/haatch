// Browser bundle (built to public/pay.js by `npm run build:pay`).
// Connects the startup's wallet (MiniPay, MetaMask, …), signs the x402 EIP-3009
// authorization for USA₮, and calls the x402-protected pay endpoint. No gas needed:
// the Celo facilitator submits the transfer.
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { celo, celoSepolia } from "viem/chains";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
    __TASK__: { id: string; network: string; explorer: string };
  }
}

const $ = (id: string) => document.getElementById(id)!;
const setStatus = (msg: string, kind: "info" | "ok" | "err" = "info") => {
  const el = $("status");
  el.textContent = msg;
  el.dataset.kind = kind;
};

async function pay() {
  const { id, network, explorer } = window.__TASK__;
  const chain = network === "eip155:42220" ? celo : celoSepolia;
  if (!window.ethereum) return setStatus("No wallet found. Open this page in MiniPay or a browser with MetaMask.", "err");

  const btn = $("pay") as HTMLButtonElement;
  btn.disabled = true;
  try {
    setStatus("Connecting wallet…");
    const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const wallet = createWalletClient({ account: address, chain, transport: custom(window.ethereum) });
    // Signing typed data doesn't strictly need the chain selected, but most wallets require it.
    await wallet.switchChain({ id: chain.id }).catch(() => wallet.addChain({ chain }));

    const client = new x402Client();
    // Default per-payment cap in the x402 client is $1; our tasks cost more.
    client.setSpendControls({ maxAmountPerPayment: "$25" });
    client.register(
      "eip155:*",
      new ExactEvmScheme({
        address,
        signTypedData: (msg) => wallet.signTypedData({ account: address, ...(msg as any) }),
      }),
    );
    const payFetch = wrapFetchWithPayment(fetch, client);

    setStatus("Approve the signature in your wallet (no gas)…");
    const res = await payFetch(`/api/tasks/${id}/pay`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? failureReason(res));

    const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    const tx = header ? decodePaymentResponseHeader(header).transaction : undefined;
    setStatus("✅ Paid! Your agent has started. Return to Telegram for the result.", "ok");
    if (tx) {
      const a = $("tx") as HTMLAnchorElement;
      a.href = `${explorer}/tx/${tx}`;
      a.textContent = `View settlement: ${tx.slice(0, 10)}…`;
      a.hidden = false;
    }
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), "err");
    btn.disabled = false;
  }
}

/** A rejected x402 retry carries the facilitator's reason in the `payment-required` header. */
function failureReason(res: Response): string {
  const header = res.headers.get("payment-required");
  try {
    const reason: string | undefined = header ? JSON.parse(atob(header)).error : undefined;
    if (reason?.includes("insufficient_funds")) {
      const testnet = window.__TASK__.network !== "eip155:42220";
      return "Not enough balance in this wallet to pay." + (testnet ? " Get free test USDC at faucet.circle.com (Celo Sepolia)." : "");
    }
    if (reason) return `Payment rejected: ${reason}`;
  } catch {}
  return `Payment failed (${res.status})`;
}

$("pay").addEventListener("click", pay);
