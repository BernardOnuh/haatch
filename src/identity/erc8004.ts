import { env, payment } from "../config.js";
import { CATALOG } from "../catalog.js";

/** ERC-8004 registries on Celo (https://docs.celo.org/build-on-celo/build-with-ai/8004). */
export const IDENTITY_REGISTRY = {
  "eip155:42220": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  "eip155:11142220": "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const;

export const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export const agentUri = () => `${env.PUBLIC_URL}/.well-known/agent-registration.json`;

/** ERC-8004 registration file, served at agentUri(). */
export function agentCard() {
  const registry = IDENTITY_REGISTRY[payment.network];
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "haatch",
    description:
      "On-demand web3 creative studio. AI design agents (OpenCode) trained on a web3 knowledge base create promo " +
      "flyers, motion videos, and campaign copy for blockchain projects, paid per task in " +
      `${payment.symbol} on Celo via x402. Telegram: @haatchedbot.`,
    image: `${env.PUBLIC_URL}/logo.png`,
    services: [
      { name: "web", endpoint: env.PUBLIC_URL },
      { name: "catalog", endpoint: `${env.PUBLIC_URL}/api/catalog` },
      { name: "tasks", endpoint: `${env.PUBLIC_URL}/api/tasks`, version: "1" },
    ],
    skills: Object.keys(CATALOG),
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    registrations: env.AGENT_ID ? [{ agentId: Number(env.AGENT_ID), agentRegistry: `${payment.network}:${registry}` }] : [],
  };
}
