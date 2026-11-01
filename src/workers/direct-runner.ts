import { readFileSync } from "node:fs";
import path from "node:path";
import { Agent } from "undici";
import { env, paths } from "../config.js";
import { llmSessions, type LlmTurn } from "../db/db.js";
import { BaseRunner, CHAT_AGENT, googleApiKey, withTimeout, type ImageInput } from "./runner.js";

/**
 * Lightweight engine for small hosts (e.g. Render free, 512 MB) where the OpenCode server
 * doesn't fit. It runs the *same* agents — the system prompts in
 * agents-workspace/.opencode/agent/*.md plus the web3 knowledge base — by calling the Gemini
 * API directly, and keeps per-session history in SQLite so revisions and chat keep context.
 */
export class DirectRunner extends BaseRunner {
  private readonly model = env.DIRECT_MODEL ?? (env.OPENCODE_MODEL.startsWith("google/") ? env.OPENCODE_MODEL.slice(7) : "gemini-flash-latest");
  // Large designs can take minutes; don't let Node's 5-minute header timeout cut them off.
  private readonly dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

  start() {
    if (!googleApiKey()) console.error("[direct] GEMINI_API_KEY is not set — agent calls will fail.");
    console.log(`[direct] agents run via the Gemini API (${this.model}, chat: ${env.DIRECT_CHAT_MODEL}); prompts from ${path.join(paths.agentsWorkspace, ".opencode/agent")}`);
  }

  stop() {}

  protected async createSession(title: string): Promise<string> {
    return llmSessions.create(title);
  }

  protected async prompt(sessionId: string, agent: string, text: string, system?: string, images: ImageInput[] = []) {
    const history = llmSessions.history(sessionId);
    if (!history) throw new Error(`unknown session ${sessionId}`);
    const { prompt: agentPrompt, temperature } = loadAgent(agent);

    const body = {
      systemInstruction: { parts: [{ text: system ? `${agentPrompt}\n\n${system}` : agentPrompt }] },
      contents: [
        ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        { role: "user", parts: [{ text }, ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } }))] },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: 32_768,
        // Task agents must return the JSON output contract; the chat agent talks in plain text.
        ...(agent === CHAT_AGENT ? {} : { responseMimeType: "application/json" }),
      },
    };

    // Chat needs speed (a person is waiting); design and copy tasks need the stronger model.
    const model = agent === CHAT_AGENT ? env.DIRECT_CHAT_MODEL : this.model;
    const reply = await withTimeout(this.generate(model, body), agent === CHAT_AGENT ? 90_000 : env.OPENCODE_TIMEOUT_MS);
    llmSessions.append(sessionId, [
      // Images aren't kept in history (size); the agent's own reply describes what it saw.
      { role: "user", text: images.length ? `${text}\n[${images.length} image(s) attached]` : text },
      { role: "model", text: reply },
    ] satisfies LlmTurn[]);
    return { text: reply, cost: 0 };
  }

  /** One Gemini call, retrying once on rate limits / overload. */
  private async generate(model: string, body: unknown, attempt = 1): Promise<string> {
    const key = googleApiKey();
    if (!key) throw new Error("ProviderAuthError: GEMINI_API_KEY is missing");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      dispatcher: this.dispatcher,
    } as RequestInit);
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 4_000));
      return this.generate(model, body, attempt + 1);
    }
    const json = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) throw new Error(`gemini ${res.status}: ${json.error?.message ?? res.statusText}`);
    const candidate = json.candidates?.[0];
    const out = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!out) throw new Error(`gemini returned no text (finishReason: ${candidate?.finishReason ?? "none"})`);
    return out;
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  error?: { message?: string };
}

/** Reads an OpenCode agent file: frontmatter `temperature` + the markdown body as the system prompt. */
function loadAgent(name: string): { prompt: string; temperature: number } {
  const raw = readFileSync(path.join(paths.agentsWorkspace, ".opencode", "agent", `${name}.md`), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const front = m?.[1] ?? "";
  const temperature = Number(front.match(/^temperature:\s*([\d.]+)/m)?.[1] ?? 0.7);
  return { prompt: (m?.[2] ?? raw).trim(), temperature };
}
