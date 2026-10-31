import type { TaskType } from "../catalog.js";
import type { Renderer } from "../render/renderer.js";
import type { OpenCodeRunner, WorkerOutput } from "../workers/opencode-runner.js";
import type { StoredResult } from "../workers/result-schema.js";

/**
 * Agent output → delivered files. Every design passes layout QA (text off-canvas, overlapping
 * text) before rendering; problems go back to the agent once, with exact measurements.
 * Used for new tasks, revisions, and scripts/test-worker.ts.
 */
export async function produce(
  { runner, renderer }: { runner: OpenCodeRunner; renderer: Renderer },
  taskId: string,
  type: TaskType,
  out: WorkerOutput,
  version: number,
): Promise<StoredResult> {
  let result = out.result;
  if (!result.assets.length) return result;

  let issues = await renderer.inspectAll(result.assets);
  if (issues.length) {
    console.warn(`[qa] ${taskId}: ${issues.length} layout issue(s), asking the agent to fix:\n  ${issues.join("\n  ")}`);
    try {
      const fixed = await runner.fixLayout(out.sessionId, type, issues);
      const after = await renderer.inspectAll(fixed.result.assets);
      console.log(`[qa] ${taskId}: after fix ${after.length} issue(s)${after.length ? `:\n  ${after.join("\n  ")}` : ""}`);
      if (after.length <= issues.length) {
        result = fixed.result;
        issues = after;
      }
    } catch (e) {
      console.warn(`[qa] ${taskId}: fix round failed, delivering original:`, (e as Error).message);
    }
    if (issues.length) {
      const note = `Layout QA: ${issues.length} unresolved issue(s): ${issues.join("; ")}`;
      result = { ...result, quality_check: { ...result.quality_check, notes: `${result.quality_check.notes} ${note}`.trim() } };
    }
  }

  const rendered = await renderer.renderAll(taskId, result.assets, version);
  return { ...result, rendered };
}
