import { readFileSync } from "node:fs";
import path from "node:path";
import { paths } from "../config.js";

/**
 * Curated web3 knowledge base (agents-workspace/knowledge/*.md).
 *
 * Injected as system context on every agent call, so the model works from a niche,
 * opinionated playbook instead of generic "blockchain" defaults. Read per call (files are
 * small) so edits to the knowledge base apply without restarting.
 */
export type KnowledgeFile = "core" | "sectors" | "visual-system" | "motion" | "copy";

export function loadKnowledge(files: readonly KnowledgeFile[]): string {
  const sections = files.map((f) => readFileSync(path.join(paths.agentsWorkspace, "knowledge", `${f}.md`), "utf8").trim());
  return [
    "KNOWLEDGE BASE — follow these playbooks; they override generic habits.",
    ...sections,
  ].join("\n\n---\n\n");
}
