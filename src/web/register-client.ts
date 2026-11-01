// Browser bundle (built to public/register.js). Registers haatch's ERC-8004 identity from the
// operator's own wallet (MetaMask, MiniPay, …): no private key ever touches the server. The
// ERC-8021 attribution suffix is appended to the transaction calldata.
import { createPublicClient, createWalletClient, custom, http, parseEventLogs, type EIP1193Provider, type Hex } from "viem";
import { celo, celoSepolia } from "viem/chains";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
    __REG__: { chainId: number; registry: Hex; agentUri: string; suffix: Hex | null; explorer: string; code: string | null };
  }
}

const abi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "event", name: "Registered", inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "agentURI", type: "string", indexed: false },
    { name: "owner", type: "address", indexed: true },
  ] },
] as const;

const $ = (id: string) => document.getElementById(id)!;
const log = (html: string, kind: "info" | "ok" | "err" = "info") => {
  const el = document.createElement("div");
  el.className = kind;
  el.innerHTML = html;
  $("log").appendChild(el);
};

async function register() {
  const cfg = window.__REG__;
  const chain = cfg.chainId === celo.id ? celo : celoSepolia;
  if (!cfg.suffix) return log("ATTRIBUTION_CODE isn't set on the server, so registering now would create an untagged transaction. Set it first.", "err");
  if (!window.ethereum) return log("No wallet found. Open this page in a browser with MetaMask, or in MiniPay.", "err");
  const btn = $("go") as HTMLButtonElement;
  btn.disabled = true;
  try {
    const card = await fetch(cfg.agentUri).then((r) => (r.ok ? r.json() : null));
    if (!card) throw new Error(`Registration file isn't reachable at ${cfg.agentUri}`);
    log(`✓ Registration file reachable: <b>${card.name}</b>`);

    const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
    await wallet.switchChain({ id: chain.id }).catch(() => wallet.addChain({ chain }));
    log(`✓ Wallet ${account.slice(0, 6)}…${account.slice(-4)} on ${chain.name}. This wallet will own the agent identity.`);

    const hash = await wallet.writeContract({
      address: cfg.registry,
      abi,
      functionName: "register",
      args: [cfg.agentUri],
      dataSuffix: cfg.suffix, // ERC-8021 attribution
    });
    log(`⏳ Sent: <a target="_blank" href="${cfg.explorer}/tx/${hash}">${hash.slice(0, 12)}…</a> waiting for confirmation…`);

    const pub = createPublicClient({ chain, transport: http() });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    const tx = await pub.getTransaction({ hash });
    const tagged = tx.input.toLowerCase().endsWith(cfg.suffix.slice(2).toLowerCase());
    const [event] = parseEventLogs({ abi, logs: receipt.logs, eventName: "Registered" });
    if (!event) throw new Error("Transaction confirmed but no Registered event was found.");
    log(`✓ Attribution tag in calldata: ${tagged ? `<b>yes</b> (code "${cfg.code}")` : "<b>NO</b>, contact the organizers"}`, tagged ? "ok" : "err");
    log(`🎉 Registered! <b>AGENT_ID=${event.args.agentId}</b><br>Set this in your environment variables and redeploy, and the registration file will list it.`, "ok");
  } catch (e) {
    log((e as Error).message.split("\n")[0], "err");
    btn.disabled = false;
  }
}

$("go").addEventListener("click", register);
