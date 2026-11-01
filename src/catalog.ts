import { env, payment } from "./config.js";
import type { KnowledgeFile } from "./knowledge/index.js";

interface Service {
  title: string;
  /** Whole token units; converted to atomic units (6 decimals) when quoting. */
  price: string;
  /** OpenCode agent name in agents-workspace/.opencode/agent/<agent>.md. */
  agent: string;
  deliverable: string;
  /** Knowledge base files injected into the agent's context for this service. */
  knowledge: readonly KnowledgeFile[];
  /** Rendered asset the deliverable must include (designed in HTML/CSS, rendered by the backend). */
  produces?: { kind: "image"; min: number } | { kind: "video"; min: number };
  /** Hidden services stay valid for existing tasks but aren't offered in the menu. */
  listed: boolean;
}

/**
 * Web3 creative studio catalog. Prices are fixed per task type (x402 `exact` scheme).
 */
export const CATALOG = {
  logo: {
    title: "Logo design",
    price: "1.00",
    agent: "web3-designer",
    deliverable: "3 logo concepts as a board, your primary logo on dark and light (PNG), plus the vector SVG and color palette.",
    knowledge: ["core", "sectors", "visual-system", "logo"],
    produces: { kind: "image", min: 2 },
    listed: true,
  },
  social_kit: {
    title: "X / Twitter kit",
    price: "1.00",
    agent: "web3-designer",
    deliverable: "X header banner (1500×500), profile picture, and a launch post image (1600×900), built from your logo and colors.",
    knowledge: ["core", "sectors", "visual-system", "copy", "logo"],
    produces: { kind: "image", min: 3 },
    listed: true,
  },
  flyer: {
    title: "Web3 promo flyer",
    price: "0.75",
    agent: "web3-designer",
    deliverable: "A launch/announcement flyer in 2 formats (X 1600×900 + feed 1080×1350) as PNG, plus copy and rationale.",
    knowledge: ["core", "sectors", "visual-system", "copy"],
    produces: { kind: "image", min: 2 },
    listed: true,
  },
  promo_video: {
    title: "Promo video (15s)",
    price: "1.50",
    agent: "web3-designer",
    deliverable: "A 10–20s vertical motion-graphics promo (1080×1920 MP4) with kinetic type and product moments.",
    knowledge: ["core", "sectors", "visual-system", "motion", "copy"],
    produces: { kind: "video", min: 1 },
    listed: true,
  },
  content_ideas: {
    title: "Web3 campaign ideas",
    price: "0.50",
    agent: "brand-strategist",
    deliverable: "A 30-day campaign plan for your launch: pillars, post ideas, formats, flyer/video concepts.",
    knowledge: ["core", "sectors", "copy"],
    listed: true,
  },
  social_captions: {
    title: "Social captions pack",
    price: "0.25",
    agent: "brand-strategist",
    deliverable: "10 crypto-native captions (X, Telegram, LinkedIn) with hooks and CTAs.",
    knowledge: ["core", "sectors", "copy"],
    listed: true,
  },
  brand_voice: {
    title: "Brand voice guide",
    price: "0.50",
    agent: "brand-strategist",
    deliverable: "Voice pillars, tone spectrum, do/don't word lists, and before/after rewrites.",
    knowledge: ["core", "sectors", "copy"],
    listed: true,
  },
  visual_brief: {
    title: "Visual identity brief",
    price: "2.00",
    agent: "brand-strategist",
    deliverable: "A designer-ready brief: mood, palette direction, type, imagery, references.",
    knowledge: ["core", "sectors", "visual-system"],
    listed: false,
  },
  brand_assets: {
    title: "Brand asset descriptions",
    price: "2.00",
    agent: "brand-strategist",
    deliverable: "Bios, taglines, one-liners, boilerplate, and alt descriptions for core assets.",
    knowledge: ["core", "copy"],
    listed: false,
  },
} as const satisfies Record<string, Service>;

export type TaskType = keyof typeof CATALOG;

export const isTaskType = (t: string): t is TaskType => t in CATALOG;

/** Services offered to new customers. */
export const listedServices = () =>
  (Object.entries(CATALOG) as [TaskType, Service][]).filter(
    // Video rendering needs ~1–2 GB of memory; hide it on low-memory hosts.
    ([, s]) => s.listed && !(env.LOW_MEMORY && s.produces?.kind === "video"),
  );

/** "1.50" → "1500000" (string, atomic units, no float math). */
export function toAtomic(amount: string, decimals = payment.decimals): string {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole + frac.padEnd(decimals, "0").slice(0, decimals)).toString();
}

export function formatAtomic(atomic: string, decimals = payment.decimals): string {
  const v = BigInt(atomic);
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${v / base}.${frac}`;
}
