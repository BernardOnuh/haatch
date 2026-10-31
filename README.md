# Startup Task Agents: web3 creative studio

Web3 and blockchain projects hire AI agents for **promo flyers, motion promo videos, and campaign copy**.
They pay per task in **USA₮ on Celo** through **x402**, and **OpenCode** worker agents do the work. Built for
Celo "Agents on Open Rails" (USA₮ + x402 track).

## How the design work happens

1. **Web3 knowledge base** (`agents-workspace/knowledge/*.md`): curated playbooks covering core rules and a
   noise filter, sector playbooks (DeFi, L1/L2, payments, NFT, GameFi, DePIN, AI × crypto, RWA, DAOs),
   visual system, motion craft, and copy. `src/knowledge` injects the relevant files as system context on
   every agent call, so output stays crypto-native instead of generic. Edit the markdown to tune the studio;
   no restart is needed.
2. **`web3-designer` agent** designs flyers and videos as self-contained HTML/CSS (a code agent's strength).
3. **Renderer** (`src/render/renderer.ts`, headless Chrome + ffmpeg) produces the real files:
   flyers → **PNG** (one per format), videos → **MP4** (the CSS animation timeline is stepped frame by
   frame at 30fps). Scripts are stripped, and the network is blocked except for Google Fonts.
4. Telegram delivers inline previews, playable video, full-resolution PNGs, and a written brief
   (concept, palette, copy, captions, storyboard). Replying to the delivery triggers a revision with a re-render.

Iterate on prompts or the knowledge base with `npm run test-worker -- flyer` or `npm run test-worker -- promo_video`.

## Architecture

```
 Startup (Telegram)                 Other agents (HTTP, x402-native)
        │                                   │
        ▼                                   ▼
┌──────────────────────── Backend (this repo, Node/TS) ────────────────────────┐
│  bot/telegram.ts      http/server.ts (Hono)                                  │
│        │  quote ──────▶ POST /api/tasks/:id/pay  ◀── x402 paymentMiddleware   │
│        │                     │ verify → claim task → settle (Celo facilitator)│
│        │                     ▼                                                │
│        │            payments/x402.ts  afterSettle hook  (status: paid)        │
│        │                     │  onTaskPaid → orchestrator.enqueue(taskId)     │
│        │                     ▼                                                │
│        │            orchestrator/   DB-backed queue, CAS state machine        │
│        │                     │                                                │
│        ◀── deliver ── workers/opencode-runner.ts ──HTTP──┐                    │
└──────────────────────────────────────────────────────────┼────────────────────┘
                                                           ▼
                               opencode serve  (agents-workspace/)
                               └─ .opencode/agent/brand-strategist.md
```

**Layer split**
- **Backend (payment + orchestration)** owns money, state, and customers. It never generates content.
- **OpenCode workers** own the content. They never see payment data or keys, and run with file edits
  and shell denied. They return JSON that matches a contract (`src/workers/result-schema.ts`), and the
  backend validates it before delivery.

## Handoff: "payment successful" → "OpenCode agent starts working"

1. Telegram user sends a brief → task row `quoted` with a fixed atomic price → bot sends the pay link.
2. The pay page (`/pay/:id`) signs an EIP-3009 authorization with the user's wallet and `POST`s
   `/api/tasks/:id/pay` with the x402 payment header.
3. The x402 middleware **verifies** the signature with the Celo facilitator, then runs the route handler.
   The handler moves the task from `quoted` to `settling` (compare-and-set), so a second concurrent
   payment gets 409 and is never settled.
4. The middleware **settles** the payment. The facilitator submits the USA₮ transfer on Celo and pays the gas.
5. The `afterSettle` hook records `tx_hash` and `payer`, moves the task from `settling` to `paid`, and calls `orchestrator.enqueue()`.
6. The orchestrator moves the task from `paid` to `running` (CAS, so exactly one worker runs it). The bot posts
   "Payment confirmed + receipt, agent started". The runner then opens an OpenCode session and prompts the agent.
7. The output is validated (with one repair round if it's invalid) and the task moves to `completed`. The bot sends the summary, a `.md` file,
   and the receipt, and the task moves to `delivered`.

**Crash safety:** the DB is the queue. On boot and every 60 seconds, the backend re-queues `paid` tasks,
resets `running` tasks, retries delivery of `completed` tasks, and releases stale `settling` tasks.

## Setup

```bash
npm install
cp .env.example .env         # fill in X402_API_KEY, PAY_TO_ADDRESS, TELEGRAM_BOT_TOKEN, PUBLIC_URL
opencode auth login          # give OpenCode credentials for OPENCODE_MODEL's provider
npm run test-worker -- brand_voice   # iterate on the agent prompt, no payment needed
npm run dev                  # HTTP + bot + workers (spawns `opencode serve` unless OPENCODE_URL is set)
```

- **x402 key:** https://x402.celo.org → connect wallet → Create API key.
- **Testnet first:** with `X402_NETWORK=testnet`, payments use Celo Sepolia USDC (faucet.circle.com). Set
  `mainnet` to charge in **USA₮** (`0xD2ab3C9A…F771`, 6 decimals).
- **PUBLIC_URL:** Telegram buttons need https. In dev, use `cloudflared tunnel --url http://localhost:3000`.
- **E2E API test:** `BUYER_PRIVATE_KEY=0x… npm run test-pay -- $PUBLIC_URL`.
- **ERC-8004:** once deployed, run `REGISTRAR_PRIVATE_KEY=0x… npm run register-agent`, then set `AGENT_ID`.
  The registration file is served at `/.well-known/agent-registration.json`.

## Adding a service (e.g. community engagement)

1. Write `agents-workspace/.opencode/agent/community-manager.md` with the same output contract.
2. Add a `CATALOG` entry in `src/catalog.ts` with `agent: "community-manager"`.
