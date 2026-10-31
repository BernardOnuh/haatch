import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { env, paths } from "../config.js";
import type { DesignAsset, RenderedAsset } from "../workers/result-schema.js";

const FPS = 30;

/** Only Google Fonts may load; everything else (incl. internal URLs) is blocked — the HTML is LLM-written. */
const ALLOWED_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

/** Agents are told not to use JS; strip it anyway so a design can't run code in the renderer. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    // External images are blocked by the network filter; hide them instead of showing broken icons.
    .replace(/<head([^>]*)>/i, `<head$1><style>img:not([src^="data:"]){visibility:hidden}</style>`);
}

/**
 * Renders agent-designed HTML/CSS into real files with headless Chrome:
 *   image → PNG screenshot at the declared size
 *   video → MP4: pause every CSS animation, step the timeline frame by frame, pipe frames to ffmpeg
 */
export class Renderer {
  private browser?: Promise<Browser>;

  private getBrowser() {
    this.browser ??= puppeteer.launch({
      executablePath: env.CHROME_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--font-render-hinting=none"],
    });
    return this.browser;
  }

  async close() {
    if (this.browser) await (await this.browser).close();
  }

  /** Render all assets of a task into data/assets/<taskId>/ and return their file references. */
  async renderAll(taskId: string, assets: DesignAsset[], version = 1): Promise<RenderedAsset[]> {
    const dir = path.join(paths.assets, taskId);
    mkdirSync(dir, { recursive: true });
    const out: RenderedAsset[] = [];
    for (const asset of assets) {
      const suffix = version > 1 ? `-v${version}` : "";
      const ext = asset.kind === "video" ? "mp4" : "png";
      const file = `${taskId}/${asset.name}${suffix}.${ext}`;
      const started = Date.now();
      const bytes = asset.kind === "video" ? await this.renderVideo(asset) : await this.renderImage(asset);
      writeFileSync(path.join(paths.assets, file), bytes);
      // Keep the design source next to the render — for debugging and handing to a designer.
      writeFileSync(path.join(paths.assets, file.replace(/\.(png|mp4)$/, ".html")), sanitizeHtml(asset.html));
      console.log(`[render] ${file} ${asset.width}×${asset.height} ${(bytes.length / 1024).toFixed(0)}KB in ${Date.now() - started}ms`);
      out.push({ name: asset.name, kind: asset.kind, file, width: asset.width, height: asset.height });
    }
    return out;
  }

  /**
   * Layout QA for every asset. Returns human-readable problems the agent can fix:
   * text outside the canvas, and different text blocks overlapping each other.
   */
  async inspectAll(assets: DesignAsset[]): Promise<string[]> {
    const issues: string[] = [];
    for (const asset of assets) issues.push(...(await this.inspect(asset)).map((i) => `[${asset.name}] ${i}`));
    return issues;
  }

  /**
   * Images are checked at their final state. Videos are sampled every 0.5s, and a problem
   * only counts if it holds for 2+ consecutive samples: text sliding in from off-screen is
   * motion, text parked off-screen is a bug.
   */
  async inspect(asset: DesignAsset): Promise<string[]> {
    const page = await this.openPage(asset);
    try {
      const step = 0.5;
      const times = asset.kind === "video" ? Array.from({ length: Math.floor((asset.duration_seconds ?? 15) / step) + 1 }, (_, i) => i * step) : [null];
      const seen = new Map<string, number[]>(); // problem → sample indices
      for (const [i, t] of times.entries()) {
        for (const p of await page.evaluate(scanLayout, t, asset.width, asset.height)) seen.set(p, [...(seen.get(p) ?? []), i]);
      }
      const issues: string[] = [];
      for (const [problem, idx] of seen) {
        if (asset.kind === "image") {
          issues.push(problem);
          continue;
        }
        if (!idx.some((v, k) => k > 0 && idx[k - 1] === v - 1)) continue; // never persisted
        issues.push(`${times[idx[0]]}s–${times[idx[idx.length - 1]]}s: ${problem}`);
      }
      return issues;
    } finally {
      await page.close();
    }
  }

  private async openPage(asset: DesignAsset): Promise<Page> {
    const page = await (await this.getBrowser()).newPage();
    await page.setViewport({ width: asset.width, height: asset.height, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("about:")) return req.continue();
      try {
        if (ALLOWED_HOSTS.has(new URL(url).hostname)) return req.continue();
      } catch {}
      return req.abort();
    });
    await page.setContent(sanitizeHtml(asset.html), { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    // esbuild/tsx wraps named functions in `__name(...)`; define it so evaluated helpers run in the page.
    await page.evaluate("globalThis.__name = globalThis.__name || ((f) => f)");
    return page;
  }

  async renderImage(asset: DesignAsset): Promise<Buffer> {
    const page = await this.openPage(asset);
    try {
      // Settle any entrance animations so the still shows the final composition.
      await page.evaluate(() => {
        for (const a of document.getAnimations()) {
          const end = a.effect?.getComputedTiming().endTime;
          a.pause();
          a.currentTime = typeof end === "number" && Number.isFinite(end) ? end : 0;
        }
      });
      return Buffer.from(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: asset.width, height: asset.height } }));
    } finally {
      await page.close();
    }
  }

  async renderVideo(asset: DesignAsset): Promise<Buffer> {
    const seconds = Math.min(30, Math.max(3, asset.duration_seconds ?? 15));
    const frames = Math.round(seconds * FPS);
    const tmp = path.join(paths.assets, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    const page = await this.openPage(asset);
    // Even dimensions are required by yuv420p.
    const ffmpeg = spawn(env.FFMPEG_PATH, [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      tmp,
    ]);
    let stderr = "";
    ffmpeg.stderr.on("data", (d) => (stderr += d));
    const done = new Promise<void>((resolve, reject) => {
      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`))));
    });

    try {
      await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
      for (let i = 0; i < frames; i++) {
        const t = (i / FPS) * 1000;
        await page.evaluate((ms) => document.getAnimations().forEach((a) => (a.currentTime = ms)), t);
        const frame = await page.screenshot({ type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: asset.width, height: asset.height } });
        if (!ffmpeg.stdin.write(frame)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
      }
      ffmpeg.stdin.end();
      await done;
      const bytes = readFileSync(tmp);
      rmSync(tmp, { force: true });
      return bytes;
    } catch (e) {
      ffmpeg.kill("SIGKILL");
      throw e;
    } finally {
      await page.close();
    }
  }
}

/**
 * Runs inside the page (must be self-contained). Moves every animation to time `t` seconds
 * (null = settled end state), then reports visible text that is off-canvas or overlapping.
 * Coordinates are rounded to 10px so a static problem produces the same message at every sample.
 */
function scanLayout(t: number | null, W: number, H: number): string[] {
  for (const a of document.getAnimations()) {
    a.pause();
    if (t === null) {
      const end = a.effect?.getComputedTiming().endTime;
      a.currentTime = typeof end === "number" && Number.isFinite(end) ? end : 0;
    } else {
      a.currentTime = t * 1000;
    }
  }
  type Box = { l: number; t: number; r: number; b: number };
  const meet = (a: Box, b: Box): Box => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const area = (a: Box) => Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t);
  const r10 = (n: number) => Math.round(n / 10) * 10;

  const items: { label: string; el: Element; box: Box }[] = [];
  const problems: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.trim();
    const el = n.parentElement;
    if (!text || !el) continue;

    // Effective opacity, visibility, and clipping by ancestors (e.g. mask-reveal wrappers).
    let opacity = 1;
    let hidden = false;
    let clip: Box = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
    for (let e: Element | null = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") {
        hidden = true;
        break;
      }
      opacity *= parseFloat(cs.opacity);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.clipPath !== "none") {
        const r = e.getBoundingClientRect();
        // A full-canvas clipping container (e.g. a scene wrapper) is the canvas edge itself, so
        // text cut off by it is still a bug. Smaller clips (mask-reveal wrappers) are intentional.
        if (r.width * r.height < 0.9 * W * H) clip = meet(clip, { l: r.left, t: r.top, r: r.right, b: r.bottom });
      }
    }
    if (hidden || opacity < 0.5) continue;

    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    const box = meet({ l: r.left, t: r.top, r: r.right, b: r.bottom }, clip);
    if (area(box) < 4) continue; // fully clipped → intentionally hidden

    const label = `"${text.slice(0, 40)}"`;
    if (box.l < -2 || box.t < -2 || box.r > W + 2 || box.b > H + 2) {
      problems.push(
        `text outside the ${W}×${H} canvas: ${label} spans x ${r10(box.l)}→${r10(box.r)}, y ${r10(box.t)}→${r10(box.b)}`,
      );
    }
    items.push({ label, el, box });
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const overlap = area(meet(a.box, b.box));
      if (overlap > 0.3 * Math.min(area(a.box), area(b.box))) {
        problems.push(`overlapping text: ${a.label} and ${b.label} cover each other`);
      }
    }
  }
  return problems;
}
