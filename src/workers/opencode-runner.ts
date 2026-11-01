import { createOpencodeClient, type OpencodeClient, type Part } from "@opencode-ai/sdk";
import { createOpencodeServer } from "@opencode-ai/sdk/server";
import { Agent } from "undici";
import { env, paths } from "../config.js";
import { BaseRunner, googleApiKey, withTimeout } from "./runner.js";

export type { WorkerJob, WorkerOutput } from "./runner.js";

/**
 * Default engine. Talks to an OpenCode server over HTTP. Each paid task gets its own OpenCode
 * session, run with the agent configured for that task type (e.g. `web3-designer`), in the
 * sandboxed agents-workspace directory.
 *
 *   backend ──HTTP──▶ opencode serve ──▶ session.create ──▶ session.prompt(agent, brief)
 *                                                          ◀── JSON deliverable
 *
 * The same session is reused for revisions, so the agent keeps the full context of the
 * original brief and its own output. Telegram chat uses a separate long-lived session per chat.
 */
export class OpenCodeRunner extends BaseRunner {
  private client?: OpencodeClient;
  private closeServer?: () => void;
  private ready?: Promise<OpencodeClient>;

  /**
   * Starts OpenCode in the background and returns immediately. Agent calls wait for it.
   * Small hosts can take well over the SDK's default 5s to boot `opencode serve`, so each
   * attempt gets 90s, and failed attempts retry instead of taking the whole app down.
   */
  start() {
    this.ready ??= this.connectWithRetry();
    this.ready.catch(() => {}); // surfaced to callers via api()
  }

  stop() {
    this.closeServer?.();
  }

  private async connectWithRetry(attempts = 5): Promise<OpencodeClient> {
    for (let i = 1; ; i++) {
      try {
        return await this.connect();
      } catch (e) {
        console.error(`[opencode] start attempt ${i}/${attempts} failed: ${(e as Error).message}`);
        if (i >= attempts) throw e;
        await new Promise((r) => setTimeout(r, 5_000 * i));
      }
    }
  }

  private async connect(): Promise<OpencodeClient> {
    // Google's key has three accepted names across OpenCode/AI SDK versions; set all of them
    // from whichever one the host provided, so the spawned `opencode serve` always finds it.
    const googleKey = googleApiKey();
    if (googleKey) {
      process.env.GEMINI_API_KEY ||= googleKey;
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= googleKey;
      process.env.GOOGLE_API_KEY ||= googleKey;
    } else if (env.OPENCODE_MODEL.startsWith("google/")) {
      console.error("[opencode] OPENCODE_MODEL is a Google model but no GEMINI_API_KEY is set — agent calls will fail.");
    }
    let baseUrl = env.OPENCODE_URL;
    if (!baseUrl) {
      // Spawns `opencode serve` as a child process (needs the `opencode` CLI on PATH).
      const server = await createOpencodeServer({ hostname: "127.0.0.1", port: 0, timeout: 90_000 });
      baseUrl = server.url;
      this.closeServer = server.close;
    }
    // session.prompt holds the HTTP request open until the agent finishes. Node's fetch aborts
    // after 5 min without response headers, so lift that limit; withTimeout() enforces ours.
    const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
    this.client = createOpencodeClient({
      baseUrl,
      directory: paths.agentsWorkspace,
      fetch: (req: Request) => fetch(req, { dispatcher } as RequestInit),
    });
    console.log(`[opencode] connected to ${baseUrl} (workspace ${paths.agentsWorkspace})`);
    return this.client;
  }

  private api(): Promise<OpencodeClient> {
    if (!this.ready) throw new Error("OpenCodeRunner not started");
    return this.ready;
  }

  protected async createSession(title: string): Promise<string> {
    const session = await (await this.api()).session.create({ body: { title }, throwOnError: true });
    return session.data.id;
  }

  protected async prompt(sessionId: string, agent: string, text: string, system?: string) {
    const client = await this.api();
    const [providerID, ...rest] = env.OPENCODE_MODEL.split("/");
    const res = await withTimeout(
      client.session.prompt({
        path: { id: sessionId },
        body: { agent, model: { providerID, modelID: rest.join("/") }, system, parts: [{ type: "text", text }] },
        throwOnError: true,
      }),
      env.OPENCODE_TIMEOUT_MS,
      () => client.session.abort({ path: { id: sessionId } }),
    );
    const { info, parts } = res.data;
    if (info.error) throw new Error(`opencode: ${info.error.name}: ${JSON.stringify(info.error.data)}`);
    return { text: textOf(parts), cost: info.cost };
  }
}

const textOf = (parts: Part[]) =>
  parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text" && !p.synthetic)
    .map((p) => p.text)
    .join("\n");
