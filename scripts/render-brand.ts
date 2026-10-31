// Renders the Haatch brand kit (logo + banners) into brand/ using the platform's own renderer.
//   npx tsx scripts/render-brand.ts
import { writeFileSync } from "node:fs";
import { Renderer } from "../src/render/renderer.js";

const C = { bg: "#0A0B0D", ink: "#F4F5F0", muted: "#8B8F87", lime: "#C8FF3D", line: "rgba(244,245,240,.10)" };

// Mark: an egg whose top shell lifts open along a zigzag crack, releasing a spark.
const CRACK = "90,56 76,47 64,58 50,46 36,58 24,47 10,56";
const EGG = "M50 6C71 6 86 36 86 60C86 82 70 96 50 96C30 96 14 82 14 60C14 36 29 6 50 6Z";
const STAR = "M0-10C1.4-2.2 2.2-1.4 10 0C2.2 1.4 1.4 2.2 0 10C-1.4 2.2-2.2 1.4-10 0C-2.2-1.4-1.4-2.2 0-10Z";
export const mark = (shell = C.lime, spark = C.ink, id = "m") => `
<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'>
  <defs>
    <clipPath id='${id}t'><polygon points='0,0 100,0 100,56 ${CRACK} 0,56'/></clipPath>
    <clipPath id='${id}b'><polygon points='0,100 100,100 100,56 ${CRACK} 0,56'/></clipPath>
  </defs>
  <g transform='translate(9 13) scale(.84)'>
    <path d='${EGG}' fill='${shell}' clip-path='url(#${id}b)'/>
    <g transform='translate(0 -7) rotate(-14 14 56)'><path d='${EGG}' fill='${shell}' clip-path='url(#${id}t)'/></g>
    <path d='${STAR}' fill='${spark}' transform='translate(70 40) scale(.95)'/>
    <path d='${STAR}' fill='${spark}' opacity='.55' transform='translate(82 26) scale(.42)'/>
  </g>
</svg>`;

const FONTS = "<link href='https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap' rel='stylesheet'>";
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.55'/></svg>")`;

const page = (w: number, h: number, css: string, body: string) => `<!doctype html><html><head>${FONTS}<style>
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${C.bg};color:${C.ink};font-family:'Space Grotesk',system-ui,sans-serif}
.grain{position:absolute;inset:0;background-image:${GRAIN};opacity:.06;mix-blend-mode:overlay;pointer-events:none}
.word{font-weight:700;letter-spacing:-.045em;line-height:1}
.mono{font-family:'JetBrains Mono',monospace}
${css}</style></head><body>${body}<div class='grain'></div></body></html>`;

// ── 1. Logo: square mark (also the Telegram bot avatar)
const avatar = page(640, 640, `
.glow{position:absolute;inset:0;background:radial-gradient(360px 300px at 60% 38%,rgba(200,255,61,.16),transparent 70%)}
.m{position:absolute;left:130px;top:130px;width:380px;height:380px}`,
`<div class='glow'></div><div class='m'>${mark()}</div>`);

// ── 2. Logo: horizontal lockup
const lockup = page(1600, 600, `
.row{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:44px}
.m{width:250px;height:250px}.word{font-size:228px}`,
`<div class='row'><div class='m'>${mark()}</div><div class='word'>haatch</div></div>`);

// ── 3. Banner: X / Twitter header 1500×500 (bottom-left is covered by the profile photo on X)
const deliverableCards = (scale = 1) => `
<div class='cards' style='transform:scale(${scale});transform-origin:right center'>
  <div class='card c1'>
    <div class='mono k'>FLYER · 1080×1350</div>
    <div class='ct'>Mainnet<br><span>is live.</span></div>
    <div class='pill mono'>● live on celo</div>
  </div>
  <div class='card c2'>
    <div class='mono k'>PROMO · 0:15</div>
    <div class='play'><svg viewBox='0 0 24 24'><path d='M8 5v14l11-7z' fill='${C.bg}'/></svg></div>
    <div class='bar'><i></i></div>
  </div>
  <div class='card c3'>
    <div class='mono k'>CAMPAIGN · 30D</div>
    <div class='ln w1'></div><div class='ln w2'></div><div class='ln w3'></div><div class='ln w2'></div>
    <div class='chip mono'>$TICKER</div>
  </div>
</div>`;
const cardsCss = `
.cards{position:absolute;right:60px;top:0;bottom:0;width:650px}
.card{position:absolute;width:250px;height:312px;border-radius:22px;background:#15171B;border:1px solid ${C.line};box-shadow:0 30px 60px rgba(0,0,0,.45);padding:22px;box-sizing:border-box;overflow:hidden}
.k{font-size:12px;letter-spacing:.14em;color:${C.muted}}
.c1{left:0;top:110px;transform:rotate(-8deg);background:linear-gradient(160deg,#1B1F12,#121410)}
.c1 .ct{font-size:44px;font-weight:700;letter-spacing:-.04em;line-height:.98;margin-top:70px}.c1 .ct span{color:${C.lime}}
.pill{position:absolute;left:22px;bottom:22px;font-size:12px;color:${C.lime};border:1px solid rgba(200,255,61,.35);border-radius:99px;padding:6px 11px}
.c2{left:215px;top:86px;z-index:2;background:radial-gradient(220px 200px at 50% 40%,rgba(200,255,61,.22),transparent 70%),#15171B}
.play{position:absolute;left:50%;top:46%;width:74px;height:74px;margin:-37px 0 0 -37px;border-radius:50%;background:${C.lime};display:grid;place-items:center}
.play svg{width:34px;height:34px;margin-left:4px}
.bar{position:absolute;left:22px;right:22px;bottom:26px;height:5px;border-radius:9px;background:rgba(244,245,240,.12)}.bar i{display:block;width:62%;height:100%;border-radius:9px;background:${C.lime}}
.c3{left:400px;top:122px;transform:rotate(8deg);padding-left:78px}
.ln{height:10px;border-radius:6px;background:rgba(244,245,240,.13);margin-top:16px}.ln:first-of-type{margin-top:44px}
.w1{width:88%}.w2{width:70%}.w3{width:80%}
.chip{position:absolute;right:22px;bottom:22px;font-size:13px;color:${C.bg};background:${C.ink};border-radius:8px;padding:6px 10px}`;

const xHeader = page(1500, 500, `
.glow{position:absolute;inset:0;background:radial-gradient(520px 380px at 74% 50%,rgba(200,255,61,.13),transparent 70%),radial-gradient(500px 300px at 10% 0%,rgba(244,245,240,.05),transparent 70%)}
.copy{position:absolute;left:290px;top:118px;width:560px}
.brand{display:flex;align-items:center;gap:16px}.brand .m{width:58px;height:58px}.brand .word{font-size:54px}
h1{margin:30px 0 0;font-size:56px;font-weight:700;letter-spacing:-.04em;line-height:1.02}
h1 span{color:${C.lime}}
.sub{margin-top:20px;font-size:21px;color:${C.muted};line-height:1.4}
${cardsCss}`,
`<div class='glow'></div>
<div class='copy'>
  <div class='brand'><div class='m'>${mark()}</div><div class='word'>haatch</div></div>
  <h1>Your web3 launch,<br><span>designed on demand.</span></h1>
  <div class='sub'>Flyers · promo videos · campaign copy by AI agents.<br>Pay per task in USA₮ on Celo.</div>
</div>
${deliverableCards(0.92)}`);

// ── 4. Banner: wide cover 1920×1080 (hackathon submission, Telegram, link previews)
const cover = page(1920, 1080, `
.grid{position:absolute;inset:0;background-image:radial-gradient(rgba(244,245,240,.09) 1px,transparent 1px);background-size:32px 32px;-webkit-mask-image:radial-gradient(900px 600px at 70% 50%,#000,transparent 75%)}
.glow{position:absolute;inset:0;background:radial-gradient(760px 560px at 72% 50%,rgba(200,255,61,.14),transparent 70%)}
.copy{position:absolute;left:150px;top:230px;width:980px}
.brand{display:flex;align-items:center;gap:22px}.brand .m{width:96px;height:96px}.brand .word{font-size:92px}
h1{margin:56px 0 0;font-size:84px;font-weight:700;letter-spacing:-.045em;line-height:.98}
h1 span{color:${C.lime}}
.sub{margin-top:34px;font-size:30px;color:${C.muted};line-height:1.4;width:720px}
.tags{display:flex;gap:14px;margin-top:46px}
.tag{font-size:20px;border:1px solid ${C.line};border-radius:99px;padding:11px 20px;color:${C.ink}}
.foot{position:absolute;left:150px;right:150px;bottom:84px;display:flex;justify-content:space-between;font-size:18px;letter-spacing:.12em;color:${C.muted};border-top:1px solid ${C.line};padding-top:28px}
.foot b{color:${C.lime};font-weight:500}
.cardwrap{position:absolute;right:130px;top:250px;width:650px;height:520px}
${cardsCss.replace(".cards{position:absolute;right:60px;top:0;bottom:0;width:650px}", ".cards{position:absolute;inset:0}")}`,
`<div class='grid'></div><div class='glow'></div>
<div class='copy'>
  <div class='brand'><div class='m'>${mark()}</div><div class='word'>haatch</div></div>
  <h1>Your web3 launch,<br><span>designed on demand.</span></h1>
  <div class='sub'>AI design agents trained on what works in crypto. Brief them in Telegram, get flyers, videos and copy back in minutes.</div>
  <div class='tags'><div class='tag'>Promo flyers</div><div class='tag'>Motion videos</div><div class='tag'>Campaign copy</div></div>
</div>
<div class='cardwrap'>${deliverableCards(1.1)}</div>
<div class='foot mono'><span><b>●</b> PAY PER TASK · USA₮ ON CELO · x402</span><span>@HAATCHEDBOT</span></div>`);

// ── 5. Telegram description picture 640×360 (shown above "What can this bot do?")
const tgDescription = page(640, 360, `
.glow{position:absolute;inset:0;background:radial-gradient(300px 220px at 50% 34%,rgba(200,255,61,.16),transparent 70%)}
.col{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.brand{display:flex;align-items:center;gap:14px}.brand .m{width:64px;height:64px}.brand .word{font-size:58px}
h1{margin:22px 0 0;font-size:30px;font-weight:700;letter-spacing:-.03em;line-height:1.1}
h1 span{color:${C.lime}}
.tags{display:flex;gap:8px;margin-top:20px}
.tag{font-size:13px;border:1px solid ${C.line};border-radius:99px;padding:6px 12px;color:${C.muted}}`,
`<div class='glow'></div>
<div class='col'>
  <div class='brand'><div class='m'>${mark()}</div><div class='word'>haatch</div></div>
  <h1>Your web3 launch, <span>designed on demand.</span></h1>
  <div class='tags mono'><div class='tag'>FLYERS</div><div class='tag'>PROMO VIDEOS</div><div class='tag'>COPY</div></div>
</div>`);

const r = new Renderer();
try {
  const jobs = [
    { name: "haatch-telegram-description", width: 640, height: 360, html: tgDescription },
    { name: "haatch-avatar", width: 640, height: 640, html: avatar },
    { name: "haatch-logo-lockup", width: 1600, height: 600, html: lockup },
    { name: "haatch-x-header", width: 1500, height: 500, html: xHeader },
    { name: "haatch-cover", width: 1920, height: 1080, html: cover },
  ];
  for (const j of jobs) {
    const asset = { ...j, kind: "image" as const };
    const issues = await r.inspect(asset); // same layout QA the agents get
    writeFileSync(`brand/${j.name}.png`, await r.renderImage(asset));
    console.log(`brand/${j.name}.png ${j.width}×${j.height}${issues.length ? `  QA: ${issues.join("; ")}` : "  QA ok"}`);
  }
  // Vector masters (transparent background).
  writeFileSync("brand/haatch-mark.svg", mark().trim());
  writeFileSync("brand/haatch-mark-mono-dark.svg", mark(C.bg, "#ffffff", "d").trim());
  console.log("brand/haatch-mark.svg, brand/haatch-mark-mono-dark.svg");
} finally {
  await r.close();
}
