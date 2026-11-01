import { tasks, type Task } from "../db/db.js";
import type { Renderer } from "../render/renderer.js";
import type { AgentRunner, WorkerOutput } from "../workers/runner.js";
import type { StoredResult } from "../workers/result-schema.js";
import { produce } from "../studio/produce.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env, paths } from "../config.js";
import type { TaskType } from "../catalog.js";

const MAX_ATTEMPTS = 2;

/** How results/updates reach the customer (Telegram today; email/webhook later). */
export interface Notifier {
  workStarted(task: Task): Promise<void>;
  deliver(task: Task, result: StoredResult): Promise<void>;
  failed(task: Task): Promise<void>;
}

/**
 * Turns "payment settled" into "OpenCode agent working".
 *
 * The DB is the queue: a task in status `paid` is a job waiting to run. The in-memory
 * queue only holds IDs for speed; on boot (and every minute) we re-scan `paid` tasks,
 * so a crash between settlement and work never loses a paid job.
 */
export class Orchestrator {
  private queue: string[] = [];
  private active = 0;
  private sweeper?: NodeJS.Timeout;

  constructor(
    private runner: AgentRunner,
    private renderer: Renderer,
    private notifier: Notifier,
    private concurrency: number,
  ) {}

  start() {
    // Tasks that were mid-run when the process died go back to `paid`.
    for (const t of tasks.listByStatus("running")) tasks.transition(t.id, "running", "paid");
    const sweep = () => {
      tasks.releaseStaleSettling();
      for (const t of tasks.listByStatus("paid")) this.enqueue(t.id);
      // Completed but not yet delivered (e.g. Telegram was down): retry delivery.
      for (const t of tasks.listByStatus("completed")) void this.deliver(t);
    };
    sweep();
    this.sweeper = setInterval(sweep, 60_000);
  }

  stop() {
    clearInterval(this.sweeper);
  }

  /** Called from the x402 afterSettle hook. Safe to call more than once per task. */
  enqueue(taskId: string) {
    if (!this.queue.includes(taskId)) this.queue.push(taskId);
    this.pump();
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.active++;
      void this.execute(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async execute(taskId: string) {
    // CAS paid → running: guarantees exactly one worker per task even if enqueued twice.
    const before = tasks.get(taskId);
    if (!before || !tasks.transition(taskId, "paid", "running", { attempts: before.attempts + 1 })) return;
    const task = tasks.get(taskId)!;
    await this.notifier.workStarted(task).catch((e) => console.warn("[notify] workStarted", e));

    try {
      console.log(`[worker] ${taskId} → opencode (${task.type}, attempt ${task.attempts})`);
      const out = await this.runner.run({ taskId, type: task.type, brief: task.brief });
      // Agent designed in HTML/CSS → render flyers (PNG) and videos (MP4) before delivery.
      const result = await this.produce(taskId, task.type, out, 1);
      tasks.transition(taskId, "running", "completed", {
        result_json: JSON.stringify(result),
        result_md: out.result.deliverable_markdown,
        opencode_session: out.sessionId,
        error: null,
      });
      console.log(`[worker] ${taskId} completed (llm cost $${out.costUsd.toFixed(4)})`);
      await this.deliver(tasks.get(taskId)!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[worker] ${taskId} failed:`, msg);
      if (task.attempts < MAX_ATTEMPTS) {
        tasks.transition(taskId, "running", "paid", { error: msg });
        this.enqueue(taskId);
      } else {
        tasks.transition(taskId, "running", "failed", { error: msg });
        await this.notifier.failed(tasks.get(taskId)!).catch(() => {});
      }
    }
  }

  /**
   * Revise a delivered task in the agent's original session and re-render its assets.
   * Called by the bot when the founder replies to a deliverable.
   */
  async revise(taskId: string, feedback: string): Promise<{ task: Task; result: StoredResult }> {
    const task = tasks.get(taskId);
    if (!task?.opencode_session) throw new Error(`task ${taskId} has no agent session`);
    const version = task.revisions + 2; // v1 is the original delivery
    const out = await this.runner.revise(task.opencode_session, task.type, feedback);
    const result = await this.produce(taskId, task.type, out, version);
    tasks.update(taskId, {
      result_json: JSON.stringify(result),
      result_md: out.result.deliverable_markdown,
      revisions: task.revisions + 1,
    });
    return { task: tasks.get(taskId)!, result };
  }

  /**
   * High-resolution export of a delivered task's images (longest side 3840px = 4K), re-rendered
   * from the stored design source. No agent call and no redesign, so it's free.
   */
  async exportHd(taskId: string): Promise<{ file: string; width: number; height: number }[]> {
    const task = tasks.get(taskId);
    if (!task?.result_json) throw new Error(`task ${taskId} has no result`);
    const result = JSON.parse(task.result_json) as StoredResult;
    const out: { file: string; width: number; height: number }[] = [];
    try {
      for (const asset of result.assets.filter((a) => a.kind === "image")) {
        const scale = 3840 / Math.max(asset.width, asset.height);
        const file = `${taskId}/${asset.name}-4k.png`;
        mkdirSync(path.join(paths.assets, taskId), { recursive: true });
        writeFileSync(path.join(paths.assets, file), await this.renderer.renderImage(asset, scale));
        out.push({ file, width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) });
      }
    } finally {
      if (env.LOW_MEMORY) await this.renderer.close();
    }
    return out;
  }

  private produce(taskId: string, type: TaskType, out: WorkerOutput, version: number): Promise<StoredResult> {
    return produce({ runner: this.runner, renderer: this.renderer }, taskId, type, out, version);
  }

  private delivering = new Set<string>();

  private async deliver(task: Task) {
    if (this.delivering.has(task.id)) return; // the sweeper may race the worker
    this.delivering.add(task.id);
    try {
      await this.deliverOnce(task);
    } finally {
      this.delivering.delete(task.id);
    }
  }

  private async deliverOnce(task: Task) {
    if (task.chat_id === 0) {
      // API-created task (agent-to-agent): caller polls GET /api/tasks/:id.
      tasks.transition(task.id, "completed", "delivered");
      return;
    }
    try {
      await this.notifier.deliver(task, JSON.parse(task.result_json!));
      tasks.transition(task.id, "completed", "delivered");
    } catch (e) {
      console.warn(`[deliver] ${task.id} will retry:`, (e as Error).message);
    }
  }
}
