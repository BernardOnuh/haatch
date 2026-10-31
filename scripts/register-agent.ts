// One-time: mint this platform's ERC-8004 Agent ID on Celo.
//   1. Deploy the backend so PUBLIC_URL/.well-known/agent-registration.json is reachable.
//   2. REGISTRAR_PRIVATE_KEY=0x... npm run register-agent   (wallet needs a little CELO for gas)
//   3. Put the printed AGENT_ID in .env and restart — the registration file then lists it.
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";
import { payment } from "../src/config.js";
import { IDENTITY_REGISTRY, agentUri, identityRegistryAbi } from "../src/identity/erc8004.js";

const pk = process.env.REGISTRAR_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error("Set REGISTRAR_PRIVATE_KEY");

const chain = payment.network === "eip155:42220" ? celo : celoSepolia;
const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });
const registry = IDENTITY_REGISTRY[payment.network];
const uri = agentUri();

const card = await fetch(uri).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!card) throw new Error(`Registration file not reachable at ${uri} — deploy the backend first.`);

console.log(`Registering ${account.address} on ${chain.name} registry ${registry}\n  agentURI: ${uri}`);
const { request } = await publicClient.simulateContract({
  account,
  address: registry,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [uri],
});
const hash = await wallet.writeContract(request);
const receipt = await publicClient.waitForTransactionReceipt({ hash });

// Read the id from the event, not the return value (another registration could land first).
const [event] = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs, eventName: "Registered" });
console.log(`\n✅ Registered. tx ${payment.explorer}/tx/${hash}\nAGENT_ID=${event.args.agentId}`);
