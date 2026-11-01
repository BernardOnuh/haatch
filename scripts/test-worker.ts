// Run an OpenCode agent directly — no payment, no Telegram — and render any designed assets.
// Useful for iterating on agent prompts and the knowledge base.
//   npm run test-worker -- flyer
//   npm run test-worker -- promo_video
import { isTaskType } from "../src/catalog.js";
import { paths } from "../src/config.js";
import { Renderer } from "../src/render/renderer.js";
import { createRunner } from "../src/workers/runner.js";
import { produce } from "../src/studio/produce.js";

const type = process.argv[2] ?? "flyer";
if (!isTaskType(type)) throw new Error(`unknown task type ${type}`);

const brief = process.env.BRIEF ?? `Project: Ledgerly — stablecoin invoicing + instant payouts for freelancers in Nigeria and Kenya, live on Celo mainnet.
Announcing: mainnet launch + cash-out to mobile money (M-Pesa) this Thursday.
Facts: settles in about 5 seconds, fees under $0.01, non-custodial. Site ledgerly.app, X @ledgerlyapp.
Audience: designers & developers billing international clients — mostly not crypto-native.
Vibe: confident, warm, premium-fintech. Admire Wise and Linear. Avoid hype, coins, rockets, "to the moon".`;

const runner = await createRunner(); // honours AGENT_ENGINE
const renderer = new Renderer();
await runner.start();
try {
  const started = Date.now();
  const out = await runner.run({ taskId: `local-${type}`, type, brief });
  console.log(`agent done in ${((Date.now() - started) / 1000).toFixed(0)}s · session ${out.sessionId} · cost $${out.costUsd.toFixed(4)}`);
  console.log(JSON.stringify({ ...out.result, deliverable_markdown: undefined, assets: out.result.assets.map((a) => ({ ...a, html: `${a.html.length} chars` })) }, null, 2));
  console.log("\n" + out.result.deliverable_markdown);
  if (out.result.assets.length) {
    // Same path as production: layout QA → agent fix round if needed → render.
    const result = await produce({ runner, renderer }, `local-${type}`, type, out, 1);
    console.log("\nrendered:", (result.rendered ?? []).map((r) => `${paths.assets}/${r.file}`));
    console.log("quality notes:", result.quality_check.notes || "(none)");
  }
} finally {
  runner.stop();
  await renderer.close();
}
