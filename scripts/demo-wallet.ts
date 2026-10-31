// Testnet demo wallet: creates it (key saved to .env only) and shows its address + balance.
//   npm run demo-wallet
// Fund it once at https://faucet.circle.com (choose Celo Sepolia) — testers then pay with
// "⚡ Pay with demo wallet" in Telegram, through the real x402 flow.
import { appendFileSync, readFileSync } from "node:fs";
import { generatePrivateKey } from "viem/accounts";

const envFile = readFileSync(".env", "utf8");
if (/^X402_NETWORK=mainnet/m.test(envFile)) throw new Error("The demo wallet is testnet-only.");
if (!/^DEMO_PAYER_PRIVATE_KEY=0x[a-fA-F0-9]{64}/m.test(envFile)) {
  appendFileSync(
    ".env",
    `\n# Testnet demo wallet: pays quotes for testers via x402. Fund at faucet.circle.com (Celo Sepolia).\nDEMO_PAYER_PRIVATE_KEY=${generatePrivateKey()}\nDEMO_PAYS_PER_USER_DAILY=3\n`,
  );
  console.log("Created a new demo wallet (private key saved to .env).");
}

const { demoPayer } = await import("../src/payments/demo-payer.js");
if (!demoPayer) throw new Error("DEMO_PAYER_PRIVATE_KEY not loaded");
console.log(`\nDemo wallet address: ${demoPayer.address}`);
console.log(`Test USDC balance:   ${await demoPayer.balance()}`);
console.log(`\nFund it: https://faucet.circle.com → network "Celo Sepolia" → paste the address above.`);
