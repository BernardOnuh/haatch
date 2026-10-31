import { payment } from "../config.js";
import { CATALOG, formatAtomic } from "../catalog.js";
import type { Task } from "../db/db.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function payPage(task: Task): string {
  const service = CATALOG[task.type];
  const amount = formatAtomic(task.price_atomic);
  const boot = JSON.stringify({ id: task.id, network: payment.network, explorer: payment.explorer });
  const done = task.status !== "quoted";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay for task</title>
<style>
  :root { color-scheme: light dark; --bg:#fcfcf7; --fg:#1a1a1a; --muted:#6b6b6b; --card:#fff; --line:#e6e6e0; --accent:#35d07f; --err:#c0392b; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#f2f2f2; --muted:#9a9a9a; --card:#1b1b1b; --line:#2c2c2c; } }
  body { margin:0; font:16px/1.5 system-ui,sans-serif; background:var(--bg); color:var(--fg); display:grid; place-items:center; min-height:100vh; padding:16px; box-sizing:border-box; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:24px; max-width:420px; width:100%; }
  h1 { font-size:20px; margin:0 0 4px; } .muted { color:var(--muted); font-size:14px; }
  .price { font-size:32px; font-weight:700; margin:20px 0; }
  button { width:100%; padding:14px; border:0; border-radius:12px; background:var(--accent); color:#06311b; font-weight:700; font-size:16px; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  #status { margin-top:16px; font-size:14px; min-height:1.5em; } #status[data-kind=err]{color:var(--err)}
  a { color:inherit; display:block; margin-top:8px; font-size:14px; }
</style></head>
<body><main class="card">
  <h1>${esc(service.title)}</h1>
  <div class="muted">${esc(service.deliverable)}</div>
  <div class="price">${amount} ${payment.symbol}</div>
  <div class="muted">Paid on Celo via x402 · gasless · task ${task.id.slice(0, 8)}</div>
  ${payment.network === "eip155:42220" ? "" : `<div class="muted" style="margin-top:8px">🧪 Testnet: get free test USDC at <a href="https://faucet.circle.com" target="_blank" rel="noopener" style="display:inline">faucet.circle.com</a> (choose Celo Sepolia). No gas needed.</div>`}<br>
  <button id="pay" ${done ? "disabled" : ""}>${done ? `Already ${task.status}` : `Pay ${amount} ${payment.symbol}`}</button>
  <div id="status" aria-live="polite"></div>
  <a id="tx" target="_blank" rel="noopener" hidden></a>
</main>
<script>window.__TASK__ = ${boot};</script>
<script type="module" src="/pay.js"></script>
</body></html>`;
}
