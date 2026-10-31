import { z } from "zod";

/**
 * A visual the agent designs as self-contained HTML/CSS. The backend renders it:
 * `image` → PNG screenshot, `video` → MP4 by stepping the CSS animation timeline.
 */
export const DesignAsset = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,40}$/, "lowercase-kebab name"),
  kind: z.enum(["image", "video"]),
  width: z.number().int().min(320).max(2160),
  height: z.number().int().min(320).max(2160),
  duration_seconds: z.number().min(3).max(30).optional(),
  html: z.string().min(200).max(120_000),
});
export type DesignAsset = z.infer<typeof DesignAsset>;

/**
 * Contract between the backend and OpenCode worker agents. Each agent's system prompt
 * (agents-workspace/.opencode/agent/*.md) instructs it to return exactly this JSON shape;
 * we validate it before anything reaches the customer.
 */
export const WorkerResult = z.object({
  task_type: z.string(),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  deliverable_markdown: z.string().min(200),
  assets: z.array(DesignAsset).max(4).default([]),
  assumptions: z.array(z.string()).max(10).default([]),
  follow_up_questions: z.array(z.string()).max(5).default([]),
  quality_check: z.object({
    brief_coverage: z.enum(["full", "partial"]),
    notes: z.string().default(""),
  }),
});
export type WorkerResult = z.infer<typeof WorkerResult>;

/** A rendered asset file on disk, attached to the stored result after rendering. */
export interface RenderedAsset {
  name: string;
  kind: "image" | "video";
  file: string; // path relative to the assets dir: <taskId>/<name>.png|mp4
  width: number;
  height: number;
}

export type StoredResult = WorkerResult & { rendered?: RenderedAsset[] };

/** Pull the JSON object out of an LLM reply (tolerates ```json fences and stray prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}
