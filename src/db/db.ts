import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { env } from "../config.js";
import type { TaskType } from "../catalog.js";

/**
 * Task lifecycle:
 *   quoted ──(x402 verified)──▶ settling ──(settled on-chain)──▶ paid
 *     ▲                            │                                │
 *     └──────(settle failed)───────┘                     (worker picks up)
 *                                                                   ▼
 *                       failed ◀──(retries exhausted)── running ──▶ completed ──▶ delivered
 */
export type TaskStatus =
  | "quoted"
  | "settling"
  | "paid"
  | "running"
  | "completed"
  | "delivered"
  | "failed";

export interface Task {
  id: string;
  chat_id: number;
  user_id: number;
  type: TaskType;
  brief: string;
  price_atomic: string;
  status: TaskStatus;
  pay_token: string;
  tx_hash: string | null;
  payer: string | null;
  network: string | null;
  result_json: string | null;
  result_md: string | null;
  error: string | null;
  attempts: number;
  /** 1 = free-trial task: no payment, starts directly in `paid`. */
  is_trial: number;
  /** Revisions done after delivery (via Telegram reply). */
  revisions: number;
  paid_via: string | null;
  opencode_session: string | null;
  created_at: string;
  updated_at: string;
}

mkdirSync(path.dirname(env.DATABASE_PATH), { recursive: true });
const db = new DatabaseSync(env.DATABASE_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS tasks (
    id               TEXT PRIMARY KEY,
    chat_id          INTEGER NOT NULL,
    user_id          INTEGER NOT NULL,
    type             TEXT NOT NULL,
    brief            TEXT NOT NULL,
    price_atomic     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'quoted',
    pay_token        TEXT NOT NULL,
    tx_hash          TEXT UNIQUE,
    payer            TEXT,
    network          TEXT,
    result_json      TEXT,
    result_md        TEXT,
    error            TEXT,
    attempts         INTEGER NOT NULL DEFAULT 0,
    opencode_session TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS tasks_chat ON tasks(chat_id);
`);
// Migrations for databases created before these columns existed.
const columns = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map((c) => c.name);
const addColumn = (name: string, ddl: string) => {
  if (!columns.includes(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${ddl}`);
};
addColumn("is_trial", "INTEGER NOT NULL DEFAULT 0");
addColumn("revisions", "INTEGER NOT NULL DEFAULT 0");
addColumn("paid_via", "TEXT"); // 'demo' when the testnet demo wallet paid

db.exec(`
  -- One ongoing OpenCode chat session per Telegram chat, plus a daily message counter.
  CREATE TABLE IF NOT EXISTS chats (
    chat_id          INTEGER PRIMARY KEY,
    opencode_session TEXT,
    day              TEXT,
    count            INTEGER NOT NULL DEFAULT 0
  );
  -- Telegram messages that carried a deliverable, so a reply to one maps back to its task.
  CREATE TABLE IF NOT EXISTS task_messages (
    chat_id    INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    task_id    TEXT NOT NULL,
    PRIMARY KEY (chat_id, message_id)
  );
`);

// Conversation history for the direct engine (OpenCode keeps its own sessions).
db.exec(`
  CREATE TABLE IF NOT EXISTS llm_sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    history    TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export type LlmTurn = { role: "user" | "model"; text: string };

export const llmSessions = {
  create(title: string): string {
    const id = `dir_${randomUUID()}`;
    db.prepare(`INSERT INTO llm_sessions (id, title) VALUES (?, ?)`).run(id, title);
    return id;
  },

  history(id: string): LlmTurn[] | undefined {
    const row = db.prepare(`SELECT history FROM llm_sessions WHERE id = ?`).get(id) as { history: string } | undefined;
    return row ? (JSON.parse(row.history) as LlmTurn[]) : undefined;
  },

  /** Appends a turn pair, keeping the most recent `keep` turns. */
  append(id: string, turns: LlmTurn[], keep = 24) {
    const all = [...(this.history(id) ?? []), ...turns].slice(-keep);
    db.prepare(`UPDATE llm_sessions SET history = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(all), id);
  },
};

export const chats = {
  session(chatId: number): string | undefined {
    const row = db.prepare(`SELECT opencode_session FROM chats WHERE chat_id = ?`).get(chatId) as
      | { opencode_session: string | null }
      | undefined;
    return row?.opencode_session ?? undefined;
  },

  setSession(chatId: number, sessionId: string | null) {
    db.prepare(
      `INSERT INTO chats (chat_id, opencode_session) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET opencode_session = excluded.opencode_session`,
    ).run(chatId, sessionId);
  },

  /** Counts one message against today's limit and returns today's total. */
  countMessage(chatId: number): number {
    db.prepare(
      `INSERT INTO chats (chat_id, day, count) VALUES (?, date('now'), 1)
       ON CONFLICT(chat_id) DO UPDATE SET
         count = CASE WHEN day = date('now') THEN count + 1 ELSE 1 END,
         day = date('now')`,
    ).run(chatId);
    return (db.prepare(`SELECT count FROM chats WHERE chat_id = ?`).get(chatId) as { count: number }).count;
  },
};

export const taskMessages = {
  link(chatId: number, messageId: number, taskId: string) {
    db.prepare(`INSERT OR IGNORE INTO task_messages (chat_id, message_id, task_id) VALUES (?, ?, ?)`).run(
      chatId,
      messageId,
      taskId,
    );
  },

  taskFor(chatId: number, messageId: number): string | undefined {
    const row = db
      .prepare(`SELECT task_id FROM task_messages WHERE chat_id = ? AND message_id = ?`)
      .get(chatId, messageId) as { task_id: string } | undefined;
    return row?.task_id;
  },
};

export const tasks = {
  create(t: Pick<Task, "chat_id" | "user_id" | "type" | "brief" | "price_atomic">): Task {
    const id = randomUUID();
    const payToken = randomBytes(16).toString("hex");
    db.prepare(
      `INSERT INTO tasks (id, chat_id, user_id, type, brief, price_atomic, pay_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, t.chat_id, t.user_id, t.type, t.brief, t.price_atomic, payToken);
    return this.get(id)!;
  },

  /** Free-trial task: skips payment and is created ready for a worker. */
  createTrial(t: Pick<Task, "chat_id" | "user_id" | "type" | "brief">): Task {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tasks (id, chat_id, user_id, type, brief, price_atomic, pay_token, status, is_trial)
       VALUES (?, ?, ?, ?, ?, '0', ?, 'paid', 1)`,
    ).run(id, t.chat_id, t.user_id, t.type, t.brief, randomBytes(16).toString("hex"));
    return this.get(id)!;
  },

  /** Trials used by a user. Failed trials don't count, so the user gets another go. */
  trialsUsed(userId: number): number {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND is_trial = 1 AND status != 'failed'`)
      .get(userId) as { n: number };
    return row.n;
  },

  /** Demo-wallet payments made for a user today (testnet tester quota). */
  demoPaysToday(userId: number): number {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND paid_via = 'demo' AND updated_at >= datetime('now', 'start of day')`)
      .get(userId) as { n: number };
    return row.n;
  },

  trialsToday(): number {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE is_trial = 1 AND created_at >= datetime('now', 'start of day')`)
      .get() as { n: number };
    return row.n;
  },

  get(id: string): Task | undefined {
    return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task | undefined;
  },

  listByChat(chatId: number, limit = 10): Task[] {
    return db
      .prepare(`SELECT * FROM tasks WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(chatId, limit) as unknown as Task[];
  },

  listByStatus(...statuses: TaskStatus[]): Task[] {
    const q = statuses.map(() => "?").join(",");
    return db
      .prepare(`SELECT * FROM tasks WHERE status IN (${q}) ORDER BY created_at`)
      .all(...statuses) as unknown as Task[];
  },

  /**
   * Compare-and-set status change. Returns false if the task was not in `from`.
   * This is what makes payment → work handoff idempotent: only one caller wins.
   */
  transition(id: string, from: TaskStatus | TaskStatus[], to: TaskStatus, fields: Partial<Task> = {}): boolean {
    const fromList = Array.isArray(from) ? from : [from];
    const sets = Object.keys(fields).map((k) => `${k} = ?`);
    const sql = `UPDATE tasks SET status = ?, ${[...sets, "updated_at = datetime('now')"].join(", ")}
                 WHERE id = ? AND status IN (${fromList.map(() => "?").join(",")})`;
    const res = db
      .prepare(sql)
      .run(to, ...(Object.values(fields) as (string | number | null)[]), id, ...fromList);
    return res.changes === 1;
  },

  update(id: string, fields: Partial<Task>) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`);
    db.prepare(`UPDATE tasks SET ${[...sets, "updated_at = datetime('now')"].join(", ")} WHERE id = ?`).run(
      ...(Object.values(fields) as (string | number | null)[]),
      id,
    );
  },

  /** Release payments stuck mid-settlement (process crashed between verify and settle). */
  releaseStaleSettling(olderThanSeconds = 120): number {
    return Number(
      db
        .prepare(
          `UPDATE tasks SET status = 'quoted', updated_at = datetime('now')
           WHERE status = 'settling' AND updated_at < datetime('now', ?)`,
        )
        .run(`-${olderThanSeconds} seconds`).changes,
    );
  },
};
