// Produces the 45s haatch demo ad (scripts/demo-video/script.md) as data/demo/haatch-demo.mp4.
//   npx tsx scripts/demo-video/make.ts
// Voiceover: ElevenLabs when ELEVENLABS_API_KEY is set (voice: ELEVENLABS_VOICE_ID), else macOS `say` as a
// timing placeholder. Visuals: rendered by haatch's own HTML→MP4 renderer, using real agent outputs.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Renderer } from "../../src/render/renderer.js";

const OUT = path.resolve("data/demo");
const VO_DIR = path.join(OUT, "vo");
mkdirSync(VO_DIR, { recursive: true });

// ── 1. Voiceover ────────────────────────────────────────────────────────────────
const LINES = [
  { id: "l1", scene: 1, text: "Look. You had the idea." },
  { id: "l2", scene: 1, text: "Then you spent nine days... picking a font." },
  { id: "l3", scene: 2, text: "Honestly? The market doesn't wait." },
  { id: "l4", scene: 2, text: "While you were nudging pixels, someone else shipped. Your users moved on." },
  { id: "l5", scene: 2, text: "That's not a design problem. It's a speed problem." },
  { id: "l6", scene: 3, text: "So... we built haatch." },
  { id: "l7", scene: 3, text: "Tell it what you're building, right in Telegram." },
  { id: "l8", scene: 3, text: "AI design agents, trained on what actually works in crypto, make your logo, your launch flyers, your X kit. In minutes." },
  { id: "l9", scene: 3, text: "Pay per task. Onchain. On Celo." },
  { id: "l10", scene: 4, text: "There are people who talk... and people who ship." },
  { id: "l11", scene: 4, text: "Ship today." },
] as const;

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB"; // ElevenLabs premade "Adam"; override freely
const engine = ELEVEN_KEY ? "elevenlabs" : "macos-say";
console.log(`voiceover engine: ${engine}`);

const duration = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

async function voice(id: string, text: string): Promise<string> {
  const wav = path.join(VO_DIR, `${id}.${engine}.wav`);
  if (existsSync(wav)) return wav; // cached
  if (ELEVEN_KEY) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.38, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    const mp3 = wav.replace(/\.wav$/, ".mp3");
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp3, "-ar", "44100", "-ac", "1", wav]);
  } else {
    const aiff = wav.replace(/\.wav$/, ".aiff");
    execFileSync("say", ["-v", "Daniel", "-r", "158", "-o", aiff, text]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "44100", "-ac", "1", wav]);
  }
  return wav;
}

const vo: { id: string; scene: number; file: string; start: number; dur: number }[] = [];
let t = 0.8;
for (const [i, line] of LINES.entries()) {
  const prev = LINES[i - 1];
  if (prev && prev.scene !== line.scene) t += line.scene === 3 ? 1.6 : 0.9; // scene breath; longer before the reveal
  if (line.id === "l11") t += 0.6; // the pause before "Ship today."
  const file = await voice(line.id, line.text);
  const dur = duration(file);
  vo.push({ id: line.id, scene: line.scene, file, start: t, dur });
  t += dur + 0.3;
}
const L = Object.fromEntries(vo.map((v) => [v.id, v]));
const S2 = L.l3.start - 0.5;
const S3 = L.l6.start - 1.3; // impact + logo reveal lands just before "So... we built haatch."
const S4 = L.l10.start - 0.6;
const T = Math.ceil((L.l11.start + L.l11.dur + 3.0) * 10) / 10;
console.log(`timeline: scene2 ${S2.toFixed(1)}s · scene3 ${S3.toFixed(1)}s · scene4 ${S4.toFixed(1)}s · total ${T}s`);

// ── 2. Visuals (HTML/CSS timeline → MP4 with haatch's renderer) ─────────────────
const dataUri = (f: string) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const IMG = {
  concepts: dataUri("data/assets/local-logo/concepts.png"),
  primary: dataUri("data/assets/local-logo/primary.png"),
  flyer: dataUri("docs/examples/flyer-x-post.png"),
};
const MARK = readFileSync("brand/haatch-mark.svg", "utf8");

let css = "";
let n = 0;
/** An element visible from t0 to t1 (seconds), with a rise-in entrance. One animation spans the whole video. */
const win = (t0: number, t1 = T + 1, rise = 26) => {
  const name = `w${n++}`;
  const p = (s: number) => `${Math.min(100, Math.max(0, (s / T) * 100)).toFixed(3)}%`;
  const fadeOut = t1 > T ? "" : `${p(t1 - 0.3)}{opacity:1;transform:none} ${p(t1)},100%{opacity:0;transform:none}`;
  css += `.${name}{animation:${name} ${T}s linear both}
@keyframes ${name}{0%,${p(t0)}{opacity:0;transform:translateY(${rise}px);animation-timing-function:cubic-bezier(.2,.8,.2,1)} ${p(t0 + 0.55)}{opacity:1;transform:none} ${fadeOut || "100%{opacity:1;transform:none}"}}\n`;
  return name;
};
const at = (s: number) => `${(s / T) * 100}%`;

const html = `<!doctype html><html><head>
<link href='https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap' rel='stylesheet'>
<style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#07080a;color:#f4f5f0;font-family:'Space Grotesk',sans-serif}
.mono{font-family:'JetBrains Mono',monospace}
.scene{position:absolute;inset:0;opacity:0}
.grain{position:absolute;inset:0;opacity:.07;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}

/* scene windows */
.s1{animation:s1 ${T}s linear both}@keyframes s1{0%{opacity:1}${at(S2 - 0.3)}{opacity:1}${at(S2)},100%{opacity:0}}
.s2{animation:s2 ${T}s linear both}@keyframes s2{0%,${at(S2 - 0.3)}{opacity:0}${at(S2)}{opacity:1}${at(S3 - 0.05)}{opacity:1}${at(S3)},100%{opacity:0}}
.s3{animation:s3 ${T}s linear both}@keyframes s3{0%,${at(S3 - 0.01)}{opacity:0}${at(S3)}{opacity:1}${at(S4 - 0.3)}{opacity:1}${at(S4)},100%{opacity:0}}
.s4{animation:s4 ${T}s linear both}@keyframes s4{0%,${at(S4 - 0.3)}{opacity:0}${at(S4)},100%{opacity:1}}

/* scene 1: the pain */
.s1 .bg{position:absolute;inset:0;background:radial-gradient(900px 600px at 40% 45%,rgba(60,90,160,.18),transparent 70%)}
.win{position:absolute;left:180px;top:170px;width:1080px;height:700px;border-radius:18px;background:#10131a;border:1px solid rgba(255,255,255,.08);box-shadow:0 40px 90px rgba(0,0,0,.6);overflow:hidden}
.bar{height:44px;display:flex;align-items:center;gap:8px;padding:0 18px;border-bottom:1px solid rgba(255,255,255,.06);color:#7d8596;font-size:15px}
.dot{width:12px;height:12px;border-radius:50%;background:#2a2f3a}
.layers{position:absolute;left:0;top:44px;bottom:0;width:250px;border-right:1px solid rgba(255,255,255,.06);padding:18px;box-sizing:border-box;font-size:15px;color:#8a92a3;line-height:2.1}
.layers b{color:#c9cfdb;font-weight:500}
.canvas{position:absolute;left:250px;right:0;top:44px;bottom:0;background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:24px 24px}
.wip{position:absolute;left:290px;top:180px;width:240px;height:240px;border:2px dashed rgba(255,255,255,.18);border-radius:24px;display:grid;place-items:center;font-size:150px;font-weight:700;color:rgba(255,255,255,.14)}
.cursor{position:absolute;left:470px;top:330px;width:30px;animation:jit 1.4s ease-in-out infinite}
@keyframes jit{0%,100%{transform:translate(0,0)}50%{transform:translate(4px,1px)}}
.clock{position:absolute;right:170px;top:210px;text-align:right}
.clock .tm{font-size:150px;font-weight:700;letter-spacing:-.04em;color:#dfe5f2}
.clock .tm i{font-style:normal;animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}
.clock .am{font-size:26px;color:#6e7789;letter-spacing:.3em}
.cap{position:absolute;left:180px;bottom:110px;font-size:34px;letter-spacing:.22em;color:#9aa3b5}

/* scene 2: the brutal truth */
.s2 .bg{position:absolute;inset:0;background:radial-gradient(900px 700px at 70% 40%,rgba(200,40,40,.16),transparent 70%)}
.cal{position:absolute;left:200px;top:200px;width:380px;height:440px;border-radius:26px;background:#14161b;border:1px solid rgba(255,255,255,.08);overflow:hidden;text-align:center}
.cal .hd{background:#c43c3c;color:#fff;font-size:30px;letter-spacing:.25em;padding:20px 0}
.cal .num{position:absolute;left:0;right:0;top:130px;font-size:220px;font-weight:700;letter-spacing:-.05em}
.toasts{position:absolute;left:700px;top:210px;width:1000px}
.toast{display:flex;gap:22px;align-items:center;background:#15171d;border:1px solid rgba(255,255,255,.08);border-left:5px solid #e04848;border-radius:18px;padding:26px 30px;margin-bottom:24px;font-size:34px}
.toast small{display:block;font-size:20px;color:#7d8596;margin-top:6px;font-family:'JetBrains Mono',monospace}
.big{position:absolute;left:200px;bottom:120px;font-size:84px;font-weight:700;letter-spacing:-.035em}
.big2{position:absolute;left:200px;bottom:120px;font-size:84px;font-weight:700;letter-spacing:-.035em;color:#ff6a5a}

/* scene 3: the solution */
.flash{position:absolute;inset:0;background:#f4f5f0;animation:flash ${T}s linear both}
@keyframes flash{0%,${at(S3 - 0.01)}{opacity:0}${at(S3)}{opacity:1}${at(S3 + 0.35)},100%{opacity:0}}
.s3 .bg{position:absolute;inset:0;background:radial-gradient(1000px 700px at 65% 45%,rgba(200,255,61,.12),transparent 70%)}
.reveal{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px}
.reveal .m{width:300px;height:300px}.reveal .w{font-size:150px;font-weight:700;letter-spacing:-.045em}
.phone{position:absolute;left:160px;top:70px;width:560px;height:940px;border-radius:52px;background:#0f1013;border:2px solid rgba(255,255,255,.1);box-shadow:0 50px 100px rgba(0,0,0,.6);overflow:hidden}
.phone .top{height:110px;display:flex;align-items:center;gap:16px;padding:0 28px;border-bottom:1px solid rgba(255,255,255,.07)}
.phone .av{width:58px;height:58px;border-radius:50%;background:#0a0b0d;display:grid;place-items:center}.phone .av svg{width:40px;height:40px}
.phone .nm{font-size:28px;font-weight:700}.phone .nm small{display:block;font-size:18px;color:#7d8596;font-weight:400}
.msgs{position:absolute;left:22px;right:22px;top:130px}
.msg{max-width:84%;padding:16px 20px;border-radius:22px;font-size:23px;line-height:1.35;margin-bottom:16px}
.me{margin-left:auto;background:#a68e66;color:#16130d;border-bottom-right-radius:6px}
.bot{background:#1d1f24;border-bottom-left-radius:6px}
.btn{margin-top:12px;background:#2a2d33;border-radius:14px;padding:12px;text-align:center;color:#d8c08d;font-weight:500}
.pic{width:100%;border-radius:14px;display:block;margin-top:4px}
.show{position:absolute;left:800px;top:150px;width:980px;height:780px}
.shot{position:absolute;border-radius:18px;box-shadow:0 40px 90px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.08)}
.k1{left:0;top:0;width:860px}
.k2{left:420px;top:150px;width:520px}
.k3{left:60px;top:360px;width:640px}
.tag{position:absolute;right:140px;top:70px;font-size:24px;letter-spacing:.2em;color:#c8ff3d}
.min{position:absolute;right:140px;bottom:110px;font-size:60px;font-weight:700;letter-spacing:-.03em}
.min span{color:#c8ff3d}
.chip{position:absolute;left:800px;bottom:36px;font-size:24px;background:rgba(200,255,61,.1);border:1px solid rgba(200,255,61,.4);color:#c8ff3d;border-radius:99px;padding:14px 24px}

/* scene 4: the close */
.s4 .bg{position:absolute;inset:0;background:radial-gradient(1100px 700px at 50% 40%,rgba(200,255,61,.13),transparent 70%)}
.chart{position:absolute;left:160px;right:160px;top:560px;height:380px}
.chart path{stroke:#c8ff3d;stroke-width:7;fill:none;stroke-linecap:round;stroke-dasharray:2400;animation:draw ${T}s linear both}
@keyframes draw{0%,${at(S4)}{stroke-dashoffset:2400;animation-timing-function:cubic-bezier(.4,0,.2,1)}${at(S4 + 2.6)},100%{stroke-dashoffset:0}}
.talk{position:absolute;left:0;right:0;top:250px;text-align:center;font-size:96px;font-weight:700;letter-spacing:-.04em;color:#8b8f87}
.ship{position:absolute;left:0;right:0;top:370px;text-align:center;font-size:96px;font-weight:700;letter-spacing:-.04em;color:#c8ff3d}
.end{position:absolute;inset:0;background:#07080a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px}
.end .lk{display:flex;align-items:center;gap:30px}.end .lk .m{width:150px;height:150px}.end .lk .w{font-size:150px;font-weight:700;letter-spacing:-.045em}
.end .tl{font-size:58px;font-weight:700;letter-spacing:-.03em}.end .tl span{color:#c8ff3d}
.end .url{font-size:32px;color:#c8ff3d;letter-spacing:.06em}
.end .ft{font-size:22px;color:#8b8f87;letter-spacing:.2em;margin-top:30px}
${"__WIN_CSS__"}
</style></head><body>

<div class='scene s1'><div class='bg'></div>
  <div class='win'>
    <div class='bar'><span class='dot'></span><span class='dot'></span><span class='dot'></span>&nbsp;&nbsp;<span class='mono'>brand_v14_FINAL_final.fig</span></div>
    <div class='layers mono'><b>Layers</b><br>logo_final_v14<br>logo_FINAL_final<br>logo_use_this_one<br>font_test_37<br>font_test_38<br>colors_again</div>
    <div class='canvas'><div class='wip'>?</div>
      <svg class='cursor' viewBox='0 0 24 24'><path d='M3 2l7 19 2.5-7.5L20 11z' fill='#fff' stroke='#000' stroke-width='1'/></svg></div>
  </div>
  <div class='clock mono'><div class='tm'>02<i>:</i>47</div><div class='am'>AM · STILL BRANDING</div></div>
  <div class='cap mono ${win(L.l2.start)}'>DAY 9 OF "BRANDING"</div>
</div>

<div class='scene s2'><div class='bg'></div>
  <div class='cal'><div class='hd mono'>DAY</div>
    <div class='num ${win(S2 + 0.1, L.l4.start)}'>9</div>
    <div class='num ${win(L.l4.start, L.l4.start + 1.6)}'>14</div>
    <div class='num ${win(L.l4.start + 1.6, S3)}' style='color:#ff6a5a'>21</div>
  </div>
  <div class='toasts'>
    <div class='toast ${win(L.l4.start + 0.2)}'>🚀<div>A competitor launched on mainnet<small>while you were picking fonts</small></div></div>
    <div class='toast ${win(L.l4.start + 1.5)}'>📉<div>Waitlist: 3 signups this week<small>your launch keeps slipping</small></div></div>
    <div class='toast ${win(L.l4.start + 2.8)}'>👋<div>Your beta users moved to another app<small>they didn't wait</small></div></div>
  </div>
  <div class='big ${win(L.l3.start, L.l5.start)}'>THE MARKET DOESN'T WAIT.</div>
  <div class='big2 ${win(L.l5.start + 1.3)}'>IT'S A SPEED PROBLEM.</div>
</div>

<div class='scene s3'><div class='bg'></div>
  <div class='reveal ${win(S3 + 0.15, L.l7.start - 0.1, 0)}'><div class='m'>${MARK}</div><div class='w'>haatch</div></div>
  <div class='phone ${win(L.l7.start - 0.2)}'>
    <div class='top'><div class='av'>${MARK}</div><div class='nm'>haatch<small>bot</small></div></div>
    <div class='msgs'>
      <div class='msg me ${win(L.l7.start + 0.2)}'>I need a logo for my project. Name is Unhinged Finance — degen DeFi on Celo</div>
      <div class='msg bot ${win(L.l7.start + 1.6)}'>Bold name. Let's give it a mark that reads at avatar size.<div class='btn'>🎨 Start: Logo design · free</div></div>
      <div class='msg bot ${win(L.l8.start + 0.4)}'>🤖 An agent has started on your logo design.</div>
      <div class='msg bot ${win(L.l8.start + 2.4)}'><img class='pic' src='${IMG.concepts}'></div>
    </div>
  </div>
  <div class='tag mono ${win(L.l8.start + 0.8)}'>LOGO · FLYERS · X KIT · CAMPAIGN COPY</div>
  <div class='show'>
    <img class='shot k1 ${win(L.l8.start + 2.6)}' src='${IMG.concepts}'>
    <img class='shot k2 ${win(L.l8.start + 4.2)}' src='${IMG.primary}'>
    <img class='shot k3 ${win(L.l8.start + 5.8)}' src='${IMG.flyer}'>
  </div>
  <div class='min ${win(L.l8.start + L.l8.dur - 1.2)}'>MINUTES, <span>NOT WEEKS.</span></div>
  <div class='chip mono ${win(L.l9.start)}'>✅ Paid via x402 · USDC on Celo · settled onchain</div>
</div>
<div class='flash'></div>

<div class='scene s4'><div class='bg'></div>
  <svg class='chart' viewBox='0 0 1600 420' preserveAspectRatio='none'><path d='M0 400 C 300 390, 480 360, 640 300 S 980 190, 1180 120 S 1480 30, 1600 10'/></svg>
  <div class='talk ${win(L.l10.start, L.l11.start - 0.4)}'>PEOPLE WHO TALK.</div>
  <div class='ship ${win(L.l10.start + 1.7, L.l11.start - 0.4)}'>PEOPLE WHO SHIP.</div>
  <div class='end ${win(L.l11.start - 0.35, T + 1, 0)}'>
    <div class='lk'><div class='m'>${MARK}</div><div class='w'>haatch</div></div>
    <div class='tl'>Brand in minutes. <span>Ship today.</span></div>
    <div class='url mono'>t.me/haatchedbot</div>
    <div class='ft mono'>AI DESIGN AGENTS · BUILT ON CELO · PAID WITH x402</div>
  </div>
</div>
<div class='grain'></div>
</body></html>`;

const finalHtml = html.replace("__WIN_CSS__", css);
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

// ── 3. Music bed (synthesized) + mix ────────────────────────────────────────────
const bed = path.join(OUT, "bed.wav");
const dark = `0.10*sin(2*PI*55*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.06*sin(2*PI*82.41*t)+0.20*exp(-55*mod(t,1))*sin(2*PI*1600*t)*lt(t,${S3})`;
const boom = `0.9*exp(-3.5*(t-${S3}))*sin(2*PI*(48-14*(t-${S3}))*(t-${S3}))*gte(t,${S3})`;
const pulse = `gte(t,${S3 + 0.6})*(0.30*exp(-9*mod(t,0.5))*sin(2*PI*52*mod(t,0.5)) + 0.045*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.55+0.45*sin(2*PI*2*t)))`;
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "lavfi", "-i", `aevalsrc='(${dark})*lt(t,${S3})+${boom}+${pulse}':s=44100:d=${T}`,
  "-af", `afade=t=in:d=1.5,afade=t=out:st=${T - 2.5}:d=2.5,volume=0.8`,
  bed,
]);

const inputs = ["-i", silent, "-i", bed, ...vo.flatMap((v) => ["-i", v.file])];
const voChains = vo.map((v, i) => `[${i + 2}:a]adelay=${Math.round(v.start * 1000)}|${Math.round(v.start * 1000)},apad[v${i}]`).join(";");
const voMix = `${vo.map((_, i) => `[v${i}]`).join("")}amix=inputs=${vo.length}:normalize=0:duration=longest,volume=1.6[vo]`;
const filter = `${voChains};${voMix};[vo]asplit[vo1][vo2];[1:a][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];[duck][vo2]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5[a]`;
const final = path.join(OUT, "haatch-demo.mp4");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", ...inputs,
  "-filter_complex", filter,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(T), "-movflags", "+faststart",
  final,
]);
console.log(`\n✅ ${final}  (${T}s, voice: ${engine})`);
