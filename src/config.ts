import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const Env = z.object({
  X402_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  X402_API_KEY: z.string().startsWith("x402_"),
  PAY_TO_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  OPENCODE_URL: z.string().optional().transform((v) => v || undefined),
  OPENCODE_MODEL: z.string().regex(/^[^/]+\/.+$/, "format: provider/model"),
  OPENCODE_TIMEOUT_MS: z.coerce.number().default(600_000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  /** Free tasks per Telegram user before payment is required (0 disables trials). */
  FREE_TRIAL_TASKS: z.coerce.number().int().min(0).default(1),
  /** Max free-trial tasks across all users per day — bounds LLM spend. */
  FREE_TRIAL_DAILY_CAP: z.coerce.number().int().min(0).default(50),
  /** Chat messages per Telegram chat per day with the conversational agent. */
  CHAT_DAILY_LIMIT: z.coerce.number().int().min(0).default(30),
  /** Free revisions per delivered task (reply to the deliverable in Telegram). */
  FREE_REVISIONS: z.coerce.number().int().min(0).default(2),
  /** Chrome/Chromium used to render flyers and videos. Auto-detected if unset. */
  CHROME_PATH: z
    .string()
    .optional()
    .transform((v) => v || CHROME_CANDIDATES.find((p) => existsSync(p)))
    .pipe(z.string({ error: "Chrome not found — set CHROME_PATH" })),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  AGENT_ID: z.string().optional(),
  DATABASE_PATH: z.string().default("./data/app.db"),
});

export const env = Env.parse(process.env);

/**
 * Payment asset per network. Values come from the Celo facilitator's authoritative
 * token table (https://x402.celo.org/skill.md). `extra.name` is the EIP-712 domain
 * name, NOT the symbol — using the symbol fails verification.
 *
 * WARNING: USA₮ has an 18-decimal fee-currency adapter on Celo with the same name/symbol
 * (0x0357EE22...). Never price against it; this is the real 6-decimal token.
 */
const ASSETS = {
  mainnet: {
    network: "eip155:42220",
    symbol: "USA₮",
    address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
    decimals: 6,
    eip712: { name: "Tether America USD", version: "1" },
    facilitatorUrl: "https://api.x402.celo.org",
    explorer: "https://celoscan.io",
  },
  testnet: {
    // Celo Sepolia only supports USDC on the hosted facilitator.
    network: "eip155:11142220",
    symbol: "USDC",
    address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    decimals: 6,
    eip712: { name: "USDC", version: "2" },
    facilitatorUrl: "https://api.x402.sepolia.celo.org",
    explorer: "https://celo-sepolia.blockscout.com",
  },
} as const;

export const payment = ASSETS[env.X402_NETWORK];

export const paths = {
  /** Directory OpenCode workers run in; holds .opencode/agent/*.md and AGENTS.md. */
  agentsWorkspace: path.resolve("agents-workspace"),
  public: path.resolve("public"),
  /** Rendered flyers/videos: data/assets/<taskId>/<name>.png|mp4 */
  assets: path.resolve(path.dirname(env.DATABASE_PATH), "assets"),
};
