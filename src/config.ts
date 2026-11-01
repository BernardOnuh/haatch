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
  /**
   * opencode: agents run inside OpenCode (default; needs ~400 MB for the OpenCode server).
   * direct:   the same agent prompt files are sent straight to the Gemini API — for 512 MB hosts.
   */
  AGENT_ENGINE: z.enum(["opencode", "direct"]).default("opencode"),
  /** Gemini model for the direct engine; defaults to OPENCODE_MODEL's model when it's a Google one. */
  DIRECT_MODEL: z.string().optional().transform((v) => v || undefined),
  /** Faster, cheaper model for conversational replies in the direct engine. */
  DIRECT_CHAT_MODEL: z.string().default("gemini-flash-lite-latest"),
  OPENCODE_URL: z.string().optional().transform((v) => v || undefined),
  OPENCODE_MODEL: z.string().regex(/^[^/]+\/.+$/, "format: provider/model"),
  OPENCODE_TIMEOUT_MS: z.coerce.number().default(600_000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  /** Free tasks per Telegram user before payment is required (0 disables trials). */
  FREE_TRIAL_TASKS: z.coerce.number().int().min(0).default(3),
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
  /**
   * Testnet only: a platform-funded wallet that pays quotes for testers through the real
   * x402 flow ("⚡ Pay with demo wallet"), so judges can try paid tasks without a wallet.
   */
  DEMO_PAYER_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((v) => {
      // Forgive copy-paste damage from host dashboards: spaces, quotes, missing 0x.
      const k = (v ?? "").trim().replace(/^['"]|['"]$/g, "");
      if (!k) return undefined;
      const key = /^[a-fA-F0-9]{64}$/.test(k) ? `0x${k}` : k;
      if (/^0x[a-fA-F0-9]{64}$/.test(key)) return key;
      console.warn("[config] DEMO_PAYER_PRIVATE_KEY is not a valid private key — demo wallet payments are disabled.");
      return undefined;
    }),
  DEMO_PAYS_PER_USER_DAILY: z.coerce.number().int().min(0).default(3),
  /**
   * polling: the bot asks Telegram for updates (best for always-on machines).
   * webhook: Telegram POSTs updates to PUBLIC_URL — required on hosts that sleep when idle (Render free).
   */
  TELEGRAM_MODE: z.enum(["polling", "webhook"]).default("polling"),
  /**
   * Ping our own public URL every 10 minutes so hosts that sleep after 15 idle minutes
   * (Render free) stay awake — no 30–60s cold start on the first Telegram message.
   */
  KEEP_AWAKE: z.stringbool().default(false),
  /** Small hosts (Render free, 512 MB): one job at a time, Chrome closed between renders, no video. */
  LOW_MEMORY: z.stringbool().default(false),
  /** ERC-8021 attribution code from the Loops hackathon registration; appended to every tx we send. */
  ATTRIBUTION_CODE: z.string().optional().transform((v) => v?.trim() || undefined),
  /** Protects operator-only pages (e.g. /register-agent). */
  ADMIN_TOKEN: z.string().optional().transform((v) => v?.trim() || undefined),
  AGENT_ID: z.string().optional(),
  DATABASE_PATH: z.string().default("./data/app.db"),
});

// Render injects its public URL; use it when PUBLIC_URL isn't set explicitly.
process.env.PUBLIC_URL ||= process.env.RENDER_EXTERNAL_URL;

export const env = Env.transform((e) => {
  // The demo wallet pays with the platform's own funds — fine for testnet demos, but on mainnet
  // those payments aren't "independent" (and would spend real money), so it's disabled there.
  if (e.X402_NETWORK === "mainnet" && e.DEMO_PAYER_PRIVATE_KEY) {
    console.warn("[config] DEMO_PAYER_PRIVATE_KEY ignored on mainnet — demo wallet payments are testnet-only.");
    return { ...e, DEMO_PAYER_PRIVATE_KEY: undefined };
  }
  return e;
}).parse(process.env);

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
