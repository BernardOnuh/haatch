# Startup Task Agents: worker workspace

This directory is the sandbox OpenCode worker agents run in. The backend creates one OpenCode
session per paid task and sends the client brief to the agent for that task type.

- Agents live in `.opencode/agent/*.md`. The filename is the agent name used in `src/catalog.ts`.
- Workers are text-only: file edits and shell are denied in `opencode.json`. They only produce the JSON
  deliverable described in each agent's output contract.
- To add a new service (e.g. community engagement), add an agent file here, then add a catalog
  entry pointing at it.
