// Produces the haatch demo ad as data/demo/haatch-demo.mp4. Built for watch-through:
// 1s hook, progress bar, open loop, fast cuts, live stopwatch, hard contrast, sound design.
//   npx tsx scripts/demo-video/make.ts
// Voiceover: ElevenLabs when ELEVENLABS_API_KEY is set (voice: ELEVENLABS_VOICE_ID), else macOS `say` as a
// timing placeholder. Visuals: rendered by haatch's own HTML→MP4 renderer, using real agent outputs.
import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Renderer } from "../../src/render/renderer.js";

const OUT = path.resolve("data/demo");
const VO_DIR = path.join(OUT, "vo");
mkdirSync(VO_DIR, { recursive: true });

// ── 1. Voiceover ────────────────────────────────────────────────────────────────
// `gap` = silence before the line (seconds). Short gaps keep the pace; the long one is the open loop.
// tone: "boom" = booming, punchy emphasis · "low" = low, close, conspiratorial · "normal" = confident read.
// CAPS mark the word to hit; ElevenLabs stresses them.
const LINES = [
  { id: "h1", gap: 0.4, tone: "boom", text: "YOUR launch... is ALREADY late." },
  { id: "p1", gap: 0.6, tone: "boom", text: "Nine DAYS... on a logo." },
  { id: "p2", gap: 0.35, tone: "boom", text: "Three WEEKS on a brand." },
  { id: "p3", gap: 0.55, tone: "low", text: "Meanwhile..." },
  { id: "t1", gap: 0.25, tone: "low", text: "someone else shipped." },
  { id: "t2", gap: 0.55, tone: "boom", text: "Your users? GONE." },
  { id: "o1", gap: 1.3, tone: "low", text: "What if it took... minutes?" },
  { id: "r1", gap: 1.0, tone: "boom", text: "This... is haatch." },
  { id: "r2", gap: 0.4, tone: "normal", text: "Tell it what you're building." },
  { id: "r3", gap: 0.3, tone: "normal", text: "AI agents — trained on what actually works in crypto — design your logo, your launch flyers, your X kit." },
  { id: "r4", gap: 0.35, tone: "normal", text: "Delivered in minutes. Paid onchain, on Celo." },
  { id: "c1", gap: 0.6, tone: "low", text: "Nine days..." },
  { id: "c2", gap: 0.3, tone: "boom", text: "or THREE minutes." },
  { id: "f1", gap: 0.6, tone: "boom", text: "The market doesn't wait. Neither should YOU." },
  { id: "f2", gap: 0.75, tone: "boom", text: "Ship. Today." },
] as const;
type Tone = (typeof LINES)[number]["tone"];

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const BRIAN = "nPczCjzI2devNBz1zQrb"; // free default voice; used when the configured voice needs a paid plan
let VOICE_ID = process.env.ELEVENLABS_VOICE_ID || BRIAN;
const engine = ELEVEN_KEY ? "elevenlabs" : "macos-say";
console.log(`voiceover engine: ${engine}${ELEVEN_KEY ? ` (voice ${VOICE_ID})` : " — placeholder; set ELEVENLABS_API_KEY for the real voice"}`);

const duration = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

/** Per-tone delivery. Big contrast between boom and low is what makes it feel performed, not generated. */
const TONE_SETTINGS: Record<Tone, object> = {
  boom: { stability: 0.32, similarity_boost: 0.85, style: 0.6, use_speaker_boost: true, speed: 0.92 },
  low: { stability: 0.7, similarity_boost: 0.8, style: 0.1, use_speaker_boost: false, speed: 0.88 },
  normal: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true, speed: 0.96 },
};
/** Per-tone mixing: booms hit hard; low lines sit quieter, warmer, closer. */
const TONE_FX: Record<Tone, string> = {
  boom: "volume=1.15,acompressor=threshold=0.15:ratio=4:attack=5:release=120",
  low: "volume=0.62,lowpass=f=6500,equalizer=f=180:t=q:w=1:g=3",
  normal: "volume=1.0",
};

async function voice(id: string, text: string, tone: Tone, previous?: string, next?: string): Promise<string> {
  const VOICE_SETTINGS = TONE_SETTINGS[tone];
  const key = createHash("sha1").update(`${engine}|${VOICE_ID}|${JSON.stringify(VOICE_SETTINGS)}|${previous}|${text}|${next}`).digest("hex").slice(0, 10);
  const wav = path.join(VO_DIR, `${id}-${key}.wav`);
  if (existsSync(wav)) return wav; // cached per engine + voice + text
  if (ELEVEN_KEY) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: VOICE_SETTINGS,
        // Lines are generated separately; giving the neighbours keeps intonation flowing like one take.
        ...(previous ? { previous_text: previous } : {}),
        ...(next ? { next_text: next } : {}),
      }),
    });
    if (res.status === 402 && VOICE_ID !== BRIAN) {
      console.warn(`[voice] ${VOICE_ID} needs a paid ElevenLabs plan via API — falling back to the free "Brian" voice.`);
      VOICE_ID = BRIAN;
      return voice(id, text, tone, previous, next);
    }
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    const mp3 = wav.replace(/\.wav$/, ".mp3");
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp3, "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse", "-ar", "44100", "-ac", "1", wav]);
  } else {
    const aiff = wav.replace(/\.wav$/, ".aiff");
    execFileSync("say", ["-v", "Daniel", "-r", "168", "-o", aiff, text]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "44100", "-ac", "1", wav]);
  }
  return wav;
}

const vo: { id: string; file: string; start: number; dur: number; end: number; tone: Tone }[] = [];
let t = 0;
for (const [i, line] of LINES.entries()) {
  t += line.gap;
  const file = await voice(line.id, line.text, line.tone, LINES[i - 1]?.text, LINES[i + 1]?.text);
  const dur = duration(file);
  vo.push({ id: line.id, file, start: t, dur, end: t + dur, tone: line.tone });
  t += dur;
}
const L = Object.fromEntries(vo.map((v) => [v.id, v])) as Record<(typeof LINES)[number]["id"], (typeof vo)[number]>;

// Segment boundaries
const B = L.p1.start - 0.15; // pain
const C = L.t1.start - 0.1; // brutal truth
const D = L.t2.end + 0.35; // black + silence + open loop
const DROP = L.r1.start - 0.45; // the reveal
const F = L.c1.start - 0.3; // contrast
const G = L.f1.start - 0.25; // close
const END = L.f2.start - 0.15; // end card
const T = Math.ceil((L.f2.end + 2.8) * 10) / 10;
console.log(`timeline: hook→${B.toFixed(1)} pain→${C.toFixed(1)} truth→${D.toFixed(1)} loop→${DROP.toFixed(1)} reveal→${F.toFixed(1)} contrast→${G.toFixed(1)} close · total ${T}s`);

// ── 2. Visuals (HTML/CSS timeline → MP4 with haatch's renderer) ─────────────────
const dataUri = (f: string) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const IMG = {
  concepts: dataUri("data/assets/local-logo/concepts.png"),
  primary: dataUri("data/assets/local-logo/primary.png"),
  flyer: dataUri("docs/examples/flyer-x-post.png"),
};
const MARK = readFileSync("brand/haatch-mark.svg", "utf8");
const pct = (s: number) => `${Math.min(100, Math.max(0, (s / T) * 100)).toFixed(3)}%`;

let css = "";
let n = 0;
/**
 * Element visible from t0 to t1. kind: "rise" (fade up), "slam" (scales down hard from big), "pop" (scale up).
 * One animation spans the whole video, so the renderer's frame stepping lands every state exactly.
 */
const win = (t0: number, t1 = T + 1, kind: "rise" | "slam" | "pop" | "fade" | "cut" = "rise") => {
  const name = `w${n++}`;
  if (kind === "cut") {
    // Hard cut in and out: for rapid-fire flips where any fade would overlap.
    css += `.${name}{animation:${name} ${T}s step-end both}@keyframes ${name}{0%{opacity:0} ${pct(t0)}{opacity:1} ${pct(t1)},100%{opacity:0}}\n`;
    return name;
  }
  const from = { rise: "translateY(30px)", slam: "scale(1.9)", pop: "scale(.6)", fade: "none" }[kind];
  const inDur = kind === "slam" ? 0.16 : kind === "pop" ? 0.28 : 0.45;
  const ease = kind === "slam" ? "cubic-bezier(.2,.9,.3,1)" : "cubic-bezier(.2,.8,.2,1)";
  const out = t1 > T ? `100%{opacity:1;transform:none}` : `${pct(t1 - 0.12)}{opacity:1;transform:none} ${pct(t1)},100%{opacity:0;transform:none}`;
  css += `.${name}{animation:${name} ${T}s linear both}@keyframes ${name}{0%,${pct(t0)}{opacity:0;transform:${from};animation-timing-function:${ease}} ${pct(t0 + inDur)}{opacity:1;transform:none} ${out}}\n`;
  return name;
};
/** Camera shake on a wrapper for ~0.35s starting at t. */
const shakes: number[] = [];
const shakeCss = () => {
  const frames: string[] = ["0%{transform:none}"];
  for (const s of shakes) {
    const offs = [[18, -10], [-16, 12], [12, 8], [-9, -7], [6, 4], [-3, 2], [0, 0]];
    frames.push(`${pct(s - 0.01)}{transform:none}`);
    offs.forEach(([x, y], i) => frames.push(`${pct(s + i * 0.05)}{transform:translate(${x}px,${y}px) scale(1.02)}`));
  }
  frames.push("100%{transform:none}");
  return `.cam{position:absolute;inset:0;animation:cam ${T}s linear both}@keyframes cam{${frames.join(" ")}}\n`;
};
/** White/red flashes at given times. */
const flashes: { t: number; color: string }[] = [];
const flashCss = () =>
  flashes
    .map((f, i) => `.fl${i}{position:absolute;inset:0;background:${f.color};pointer-events:none;animation:fl${i} ${T}s linear both}@keyframes fl${i}{0%,${pct(f.t - 0.01)}{opacity:0} ${pct(f.t)}{opacity:.95} ${pct(f.t + 0.28)},100%{opacity:0}}`)
    .join("\n");
const hit = (time: number, color?: string, shake = true) => {
  if (shake) shakes.push(time);
  if (color) flashes.push({ t: time, color });
  hits.push(time);
};
const hits: number[] = [];

// Live stopwatch during the demo: 00:00 → 03:12 (a real logo run takes ~2.5–4 min).
const swStart = L.r2.start - 0.2;
const swEnd = L.r4.end;
const STEPS = 16;
const stopwatch = Array.from({ length: STEPS }, (_, i) => {
  const t0 = swStart + ((swEnd - swStart) * i) / STEPS;
  const t1 = i === STEPS - 1 ? F : swStart + ((swEnd - swStart) * (i + 1)) / STEPS;
  const secs = Math.round((192 * i) / (STEPS - 1));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `<span class='sw ${win(t0, t1, "fade")}'>${mm}:${ss}</span>`;
}).join("");

// Hook words
hit(L.h1.start + 0.05, undefined);
hit(L.h1.start + L.h1.dur * 0.45, undefined);
hit(L.h1.end - 0.35, "#ff2a2a");
hit(L.p1.start, undefined);
hit(L.p2.start, undefined);
hit(L.t1.start + 0.05, "#ff2a2a");
hit(L.t2.end - 0.45, "#ff2a2a");
hit(DROP, "#f4f5f0");
hit(L.r3.start + L.r3.dur * 0.35, undefined, false);
hit(L.r3.start + L.r3.dur * 0.6, undefined, false);
hit(L.r3.start + L.r3.dur * 0.82, undefined, false);
hit(L.c2.start, "#c8ff3d");
hit(END, undefined);

const html = `<!doctype html><html><head>
<link href='https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap' rel='stylesheet'>
<style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#050506;color:#f4f5f0;font-family:'Space Grotesk',sans-serif}
.mono{font-family:'JetBrains Mono',monospace}
.ab{position:absolute}.c{left:0;right:0;text-align:center}
.grain{position:absolute;inset:0;opacity:.08;mix-blend-mode:overlay;pointer-events:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.75))}
.huge{font-weight:700;letter-spacing:-.05em;line-height:.9}
.red{color:#ff3b30}.lime{color:#c8ff3d}.dim{color:#6f7480}
.glitch{text-shadow:-6px 0 rgba(255,0,60,.75),6px 0 rgba(0,220,255,.6)}
/* progress bar: the viewer always sees how far along they are */
.prog{position:absolute;left:0;top:0;height:6px;background:#c8ff3d;box-shadow:0 0 18px rgba(200,255,61,.7);animation:prog ${T}s linear both;z-index:50}
@keyframes prog{from{width:0}to{width:1920px}}
/* heartbeat red vignette during pain/truth */
.pulse{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 35%,rgba(170,0,0,.55));animation:pulse ${T}s linear both}
@keyframes pulse{0%,${pct(B)}{opacity:0} ${Array.from({ length: Math.floor((D - B) / 0.85) }, (_, i) => { const s = B + i * 0.85; return `${pct(s)}{opacity:.25} ${pct(s + 0.1)}{opacity:1} ${pct(s + 0.45)}{opacity:.3}`; }).join(" ")} ${pct(D)},100%{opacity:0}}
/* stopwatch */
.swbox{position:absolute;right:120px;top:70px;text-align:right}
.swl{font-size:22px;letter-spacing:.3em;color:#8b8f87}
.swt{position:relative;height:120px;width:330px;margin-left:auto}
.sw{position:absolute;right:0;top:0;font-size:110px;font-weight:700;letter-spacing:-.03em;color:#c8ff3d;font-family:'JetBrains Mono',monospace}
/* demo */
.phone{position:absolute;left:150px;top:150px;width:540px;height:880px;border-radius:52px;background:#0f1013;border:2px solid rgba(255,255,255,.12);box-shadow:0 50px 120px rgba(0,0,0,.7);overflow:hidden}
.phone .top{height:104px;display:flex;align-items:center;gap:16px;padding:0 28px;border-bottom:1px solid rgba(255,255,255,.07)}
.phone .av{width:56px;height:56px;border-radius:50%;background:#0a0b0d;display:grid;place-items:center}.phone .av svg{width:40px;height:40px}
.phone .nm{font-size:28px;font-weight:700}.phone .nm small{display:block;font-size:18px;color:#7d8596;font-weight:400}
.msgs{position:absolute;left:22px;right:22px;top:124px}
.msg{max-width:86%;padding:16px 20px;border-radius:22px;font-size:24px;line-height:1.35;margin-bottom:16px}
.me{margin-left:auto;background:#a68e66;color:#16130d;border-bottom-right-radius:6px}
.bot{background:#1d1f24;border-bottom-left-radius:6px}
.btn{margin-top:12px;background:#2a2d33;border-radius:14px;padding:12px;text-align:center;color:#d8c08d;font-weight:500}
.shot{position:absolute;border-radius:18px;box-shadow:0 40px 100px rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.1)}
.k1{left:780px;top:250px;width:900px}
.k2{left:1180px;top:380px;width:560px}
.k3{left:820px;top:560px;width:680px}
.word{position:absolute;right:120px;font-size:120px;font-weight:700;letter-spacing:-.04em;text-shadow:0 10px 40px rgba(0,0,0,.8)}
.chip{position:absolute;left:780px;bottom:50px;font-size:26px;background:rgba(200,255,61,.12);border:1px solid rgba(200,255,61,.5);color:#c8ff3d;border-radius:99px;padding:14px 26px}
.endc{position:absolute;inset:0;background:#050506;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px}
.endc .lk{display:flex;align-items:center;gap:30px}.endc .lk .m{width:160px;height:160px}.endc .lk .w{font-size:160px;font-weight:700;letter-spacing:-.045em}
${"__CSS__"}
</style></head><body>
<div class='cam'>

<!-- A. HOOK -->
<div class='ab c huge ${win(L.h1.start + 0.05, B, "slam")}' style='top:170px;font-size:180px'>YOUR LAUNCH</div>
<div class='ab c huge ${win(L.h1.start + L.h1.dur * 0.45, B, "slam")}' style='top:390px;font-size:180px'>IS ALREADY</div>
<div class='ab c huge red glitch ${win(L.h1.end - 0.35, B, "slam")}' style='top:610px;font-size:260px'>LATE.</div>

<!-- B. PAIN -->
<div class='pulse'></div>
<div class='ab ${win(B, L.p2.start)}' style='left:0;right:0;top:0;bottom:0'>
  <div class='ab mono dim' style='left:160px;top:200px;font-size:30px;line-height:2.1'>logo_final_v14.fig<br>logo_FINAL_final.fig<br>logo_use_this_one.fig<br>font_test_37<br>font_test_38</div>
  <div class='ab huge ${win(L.p1.start, L.p2.start, "slam")}' style='right:160px;top:250px;font-size:300px;text-align:right'>9 DAYS</div>
  <div class='ab dim ${win(L.p1.start + 0.35, L.p2.start)}' style='right:170px;top:600px;font-size:64px'>on a logo.</div>
</div>
<div class='ab ${win(L.p2.start, L.p3.start, "fade")}' style='left:0;right:0;top:0;bottom:0'>
  ${[3, 6, 9, 12, 15, 18, 21].map((d, i) => `<div class='ab huge dim ${win(L.p2.start + i * 0.13, L.p2.start + (i + 1) * 0.13, "cut")}' style='left:160px;top:230px;font-size:380px'>${String(d).padStart(2, "0")}</div>`).join("")}
  <div class='ab huge ${win(L.p2.start, L.p3.start, "slam")}' style='right:160px;top:250px;font-size:250px;text-align:right'>3 WEEKS</div>
  <div class='ab dim ${win(L.p2.start + 0.35, L.p3.start)}' style='right:170px;top:560px;font-size:64px'>on a brand.</div>
</div>
<div class='ab c ${win(L.p3.start, C, "fade")}' style='top:300px'>
  <div class='huge mono' style='font-size:220px;color:#dfe5f2'>02:47<span style='font-size:70px;color:#6f7480'> AM</span></div>
  <div class='dim' style='font-size:48px;letter-spacing:.3em;margin-top:70px'>MEANWHILE…</div>
</div>

<!-- C. BRUTAL TRUTH -->
<div class='ab c ${win(L.t1.start, L.t2.start - 0.05, "slam")}' style='top:300px'>
  <div style='display:inline-block;background:#15171d;border:2px solid #ff3b30;border-radius:28px;padding:44px 60px;text-align:left;box-shadow:0 30px 90px rgba(255,40,40,.25)'>
    <div class='mono red' style='font-size:26px;letter-spacing:.2em'>● JUST NOW</div>
    <div style='font-size:76px;font-weight:700;letter-spacing:-.03em;margin-top:10px'>🚀 A competitor shipped.</div>
    <div class='dim' style='font-size:34px;margin-top:8px'>Mainnet live. Their launch thread is trending.</div>
  </div>
</div>
<div class='ab c huge ${win(L.t2.start, D, "slam")}' style='top:250px;font-size:200px'>YOUR USERS?</div>
<div class='ab c huge red glitch ${win(L.t2.end - 0.45, D, "slam")}' style='top:500px;font-size:300px'>GONE.</div>

<!-- D. BLACK + OPEN LOOP -->
<div class='ab c ${win(L.o1.start, DROP - 0.05, "fade")}' style='top:470px;font-size:64px;letter-spacing:-.01em;color:#cfd3cc'>What if it took… <span class='lime'>minutes?</span></div>

<!-- E. REVEAL + LIVE DEMO -->
<div class='ab ${win(DROP, F, "fade")}' style='inset:0;background:radial-gradient(1100px 760px at 60% 45%,rgba(200,255,61,.16),transparent 70%)'></div>
<div class='ab c ${win(DROP + 0.05, L.r2.start - 0.05, "pop")}' style='top:260px'>
  <div style='width:330px;height:330px;margin:0 auto'>${MARK}</div>
  <div class='huge' style='font-size:190px;margin-top:10px'>haatch</div>
</div>
<div class='phone ${win(L.r2.start - 0.1, F)}'>
  <div class='top'><div class='av'>${MARK}</div><div class='nm'>haatch<small>bot</small></div></div>
  <div class='msgs'>
    <div class='msg me ${win(L.r2.start + 0.1, F)}'>I need a logo for my project. Unhinged Finance — degen DeFi on Celo</div>
    <div class='msg bot ${win(L.r2.end - 0.2, F)}'>Bold name. Let's give it a mark that reads at avatar size.<div class='btn'>🎨 Start: Logo design · 1.00 USA₮</div></div>
    <div class='msg bot ${win(L.r3.start + 0.3, F)}'>🤖 Agent started on your logo…</div>
  </div>
</div>
<div class='swbox ${win(L.r2.start - 0.2, F, "fade")}'><div class='swl mono'>⏱ TIME TO BRAND</div><div class='swt'>${stopwatch}</div></div>
<img class='shot k1 ${win(L.r3.start + L.r3.dur * 0.35, F, "slam")}' src='${IMG.concepts}'>
<img class='shot k2 ${win(L.r3.start + L.r3.dur * 0.6, F, "slam")}' src='${IMG.primary}'>
<img class='shot k3 ${win(L.r3.start + L.r3.dur * 0.82, F, "slam")}' src='${IMG.flyer}'>
<div class='word ${win(L.r3.start + L.r3.dur * 0.35, L.r3.start + L.r3.dur * 0.6 - 0.05, "slam")}' style='top:840px'>LOGO.</div>
<div class='word lime ${win(L.r3.start + L.r3.dur * 0.6, L.r3.start + L.r3.dur * 0.82 - 0.05, "slam")}' style='top:840px'>FLYERS.</div>
<div class='word ${win(L.r3.start + L.r3.dur * 0.82, L.r4.start - 0.05, "slam")}' style='top:840px'>X KIT.</div>
<div class='word lime ${win(L.r4.start, F, "slam")}' style='top:840px'>MINUTES.</div>
<div class='chip mono ${win(L.r4.start + L.r4.dur * 0.45, F, "pop")}'>✅ Paid via x402 · USA₮ on Celo · settled onchain</div>

<!-- F. CONTRAST -->
<div class='ab ${win(F, G, "fade")}' style='inset:0'>
  <div class='ab' style='left:0;top:0;bottom:0;width:960px;background:#120708'></div>
  <div class='ab' style='right:0;top:0;bottom:0;width:960px;background:#0b1003'></div>
  <div class='ab c' style='left:0;width:960px;top:300px'><div class='dim mono' style='font-size:28px;letter-spacing:.3em'>THE OLD WAY</div>
    <div class='huge red' style='font-size:230px;margin-top:80px;position:relative;display:inline-block'>9 DAYS
      <div class='${win(L.c2.start, G, "fade")}' style='position:absolute;left:-20px;right:-20px;top:52%;height:16px;background:#f4f5f0;transform-origin:left'></div></div></div>
  <div class='ab c ${win(L.c2.start, G, "slam")}' style='left:960px;width:960px;top:300px'><div class='lime mono' style='font-size:28px;letter-spacing:.3em'>WITH HAATCH</div>
    <div class='huge lime' style='font-size:230px;margin-top:80px'>3 MIN</div></div>
</div>

<!-- G. CLOSE -->
<div class='ab c huge ${win(G, END, "slam")}' style='top:300px;font-size:130px'>THE MARKET DOESN'T WAIT.</div>
<div class='ab c huge lime ${win(L.f1.start + L.f1.dur * 0.55, END, "slam")}' style='top:500px;font-size:130px'>NEITHER SHOULD YOU.</div>
<div class='endc ${win(END, T + 1, "pop")}'>
  <div class='lk'><div class='m'>${MARK}</div><div class='w'>haatch</div></div>
  <div class='huge' style='font-size:96px'>Ship <span class='lime'>today.</span></div>
  <div class='mono lime' style='font-size:40px'>t.me/haatchedbot</div>
  <div class='mono dim' style='font-size:22px;letter-spacing:.25em;margin-top:24px'>AI DESIGN AGENTS · BUILT ON CELO · PAID WITH x402</div>
</div>
</div>
${flashes.map((_, i) => `<div class='fl${i}'></div>`).join("")}
<div class='vig'></div><div class='grain'></div><div class='prog'></div>
</body></html>`;

const finalHtml = html.replace("__CSS__", css + shakeCss() + flashCss());
writeFileSync(path.join(OUT, "demo.html"), finalHtml);

const renderer = new Renderer();
const started = Date.now();
const asset = { name: "demo", kind: "video" as const, width: 1920, height: 1080, duration_seconds: T, html: finalHtml };
const issues = await renderer.inspect(asset);
if (issues.length) console.warn("layout QA:", issues);
const silent = path.join(OUT, "video-silent.mp4");
writeFileSync(silent, await renderer.renderVideo(asset, 120));
await renderer.close();
console.log(`video rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`);

// ── 3. Sound design (synthesized) + mix ─────────────────────────────────────────
const g = (a: number, b: number) => `gte(t,${a.toFixed(3)})*lt(t,${b.toFixed(3)})`;
const heartbeats = Array.from({ length: Math.floor((D - B) / 0.85) }, (_, i) => B + i * 0.85);
const heart = heartbeats
  .map((s) => `0.55*exp(-18*(t-${s.toFixed(3)}))*sin(2*PI*48*(t-${s.toFixed(3)}))*gte(t,${s.toFixed(3)})+0.35*exp(-18*(t-${(s + 0.22).toFixed(3)}))*sin(2*PI*44*(t-${(s + 0.22).toFixed(3)}))*gte(t,${(s + 0.22).toFixed(3)})`)
  .join("+");
const drone = `(0.07*sin(2*PI*55*t)+0.05*sin(2*PI*58.3*t))*${g(0, D)}`;
const tick = `0.18*exp(-70*mod(t,0.5))*sin(2*PI*2400*t)*${g(L.p3.start, D)}`;
const riser = `0.22*pow((t-${L.o1.start.toFixed(3)})/${(DROP - L.o1.start).toFixed(3)},2)*(sin(2*PI*(200+900*(t-${L.o1.start.toFixed(3)})/${(DROP - L.o1.start).toFixed(3)})*t)+0.6*(random(0)*2-1))*${g(L.o1.start, DROP - 0.12)}`;
const hitsExpr = hits
  .map((s) => `(0.85*exp(-7*(t-${s.toFixed(3)}))*sin(2*PI*(52-18*(t-${s.toFixed(3)}))*(t-${s.toFixed(3)}))+0.35*exp(-25*(t-${s.toFixed(3)}))*(random(0)*2-1))*gte(t,${s.toFixed(3)})`)
  .join("+");
const beat = 60 / 128;
const drive = `(0.42*exp(-10*mod(t-${DROP.toFixed(3)},${beat.toFixed(4)}))*sin(2*PI*(58-30*mod(t-${DROP.toFixed(3)},${beat.toFixed(4)}))*mod(t-${DROP.toFixed(3)},${beat.toFixed(4)})) + 0.06*exp(-40*mod(t-${(DROP + beat / 2).toFixed(3)},${beat.toFixed(4)}))*(random(0)*2-1) + 0.045*(sin(2*PI*110*t)+sin(2*PI*164.81*t)+sin(2*PI*220*t)+sin(2*PI*277.18*t))*(0.6+0.4*sin(2*PI*${(1 / beat).toFixed(3)}*t)))*${g(DROP + 0.05, END + 0.2)}`;
const outro = `0.05*(sin(2*PI*110*t)+sin(2*PI*164.81*t)+sin(2*PI*277.18*t))*${g(END, T)}`;
const bed = path.join(OUT, "bed.wav");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "lavfi", "-i", `aevalsrc='${[drone, heart, tick, riser, hitsExpr, drive, outro].join("+")}':s=44100:d=${T}`,
  "-af", `alimiter=limit=0.9,afade=t=out:st=${T - 2}:d=2`,
  bed,
]);

const inputs = ["-i", silent, "-i", bed, ...vo.flatMap((v) => ["-i", v.file])];
const voChains = vo.map((v, i) => `[${i + 2}:a]${TONE_FX[v.tone]},adelay=${Math.round(v.start * 1000)}|${Math.round(v.start * 1000)},apad[v${i}]`).join(";");
const voMix = `${vo.map((_, i) => `[v${i}]`).join("")}amix=inputs=${vo.length}:normalize=0:duration=longest,highpass=f=75,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=0.1:ratio=3:attack=8:release=150,aecho=0.85:0.6:28|47:0.07|0.04,volume=1.7[vo]`;
const filter = `${voChains};${voMix};[vo]asplit[vo1][vo2];[1:a][vo1]sidechaincompress=threshold=0.04:ratio=5:attack=15:release=300[duck];[duck][vo2]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.2[a]`;
const final = path.join(OUT, "haatch-demo.mp4");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", ...inputs,
  "-filter_complex", filter,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", String(T), "-movflags", "+faststart",
  final,
]);
console.log(`\n✅ ${final}  (${T}s, voice: ${engine}${ELEVEN_KEY ? ` / ${VOICE_ID === BRIAN ? "Brian" : VOICE_ID}` : ""})`);
