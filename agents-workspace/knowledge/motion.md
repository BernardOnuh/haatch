# Motion & Promo Video Craft (HTML/CSS → MP4)

Promo videos are **one HTML document animated with CSS `@keyframes` only**. The renderer advances the
animation timeline frame by frame and encodes an MP4 at 30fps. There is no audio. Design so that it
works muted, with on-screen text carrying the story.

## Technical rules
- Same rules as flyers: no JS, no external images, Google Fonts only, fixed `width/height` on html/body.
- **All motion must come from CSS animations.** CSS transitions won't play.

## The scene pattern (mandatory, or scenes pile on top of each other)
Every scene is an absolutely positioned container (`position:absolute; inset:0`) whose visibility is
controlled by **one keyframe animation that spans the whole video** (`animation-duration` = total
seconds, `animation-delay: 0`, `animation-fill-mode: both`). Express its on and off times as percentages.

```css
/* 15s video. Scene 2 is visible from 2s to 6s: 2/15=13.3%, 6/15=40% */
.scene { position:absolute; inset:0; opacity:0; }
.s1 { animation: s1 15s linear both; }
@keyframes s1 { 0%{opacity:1} 12%{opacity:1} 13.3%{opacity:0} 100%{opacity:0} }
.s2 { animation: s2 15s linear both; }
@keyframes s2 { 0%,13.3%{opacity:0} 14.6%{opacity:1} 38.6%{opacity:1} 40%{opacity:0} 100%{opacity:0} }
/* ...the last scene (end card) fades in and stays at opacity:1 through 100% */
```

- Scenes must **not overlap** in time except for a 0.2–0.3s crossfade. Only one scene's text is ever readable.
- **Inside** a scene, element entrances use their own short animations with absolute delays (seconds from
  video start), e.g. `.s2 .line1 { animation: rise .6s cubic-bezier(.2,.8,.2,1) 2.1s both }`. Entrances only;
  the scene container handles the exit.
- **Never put two animations on the same property of the same element** (e.g. an enter and an exit both
  animating `opacity`). The later one's fill overrides the earlier, and the element vanishes or never appears.
- Continuous background motion (drifting glows) lives in its own layer behind all scenes.
- Declare the total length in the asset's `duration_seconds` (10–20s recommended, max 30).
- Default format: **1080 × 1920 vertical** (Reels, TikTok, Shorts, X mobile). Use 1600 × 900 only if asked.

## Structure of a 15-second promo
| Time | Beat | Purpose |
|---|---|---|
| 0–2s | **Hook** | Pattern interrupt: a bold claim, a big number, or a provocative question. Must land muted |
| 2–6s | **Problem → promise** | One line of pain, one line of the product's answer |
| 6–11s | **Proof / product** | Product UI mock animating, 2–3 key features or stats appearing in sequence |
| 11–15s | **CTA** | Name or wordmark, a single CTA, URL or handle. Hold for 2s or more, fully still |

For 20–30s, add a second proof beat or a "how it works in 3 steps" beat.

## Kinetic typography that feels premium
- Entrances: `translateY(40px) → 0` with opacity, 500–700ms, `cubic-bezier(.2,.8,.2,1)` (ease-out-expo feel).
- Stagger lines or words by 80–150ms. Split headlines into `<span>`s so each word has its own delay.
- Mask reveals: wrap text in `overflow:hidden` and slide the inner span up from 100%.
- Numbers: animate scale (0.9→1) and opacity. Avoid fake counting (no JS).
- Keep text on screen long enough to read: about 0.3s per word, minimum 1.5s per line.
- One motion idea per scene. Don't animate everything at once.

## Background motion (subtle, continuous)
- Slowly drifting radial-gradient blobs (`transform: translate()` over 10–20s, infinite, alternate).
- Grain overlay held static. A gently rotating conic or linear gradient behind a product card.
- Fine grid panning very slowly for infrastructure brands.

## Product UI animation ideas
- A phone mock slides in, then an inner "screen" panel swaps (keyframed opacity or translate) to show a flow:
  connect → enter amount → confirmed ✓.
- Transaction confirmation: pill goes from "Pending…" to "Confirmed in 2s" (only if that number is real or a placeholder).
- A card stack fans out to show features.

## Ending frame
The final 2s must be a clean, static end card: wordmark, a single CTA line, and URL or handle. This frame doubles as the video's thumbnail.

## Avoid
Spinning 3D coins, glitch effects on every cut, strobe flashes (accessibility), more than 2 fonts,
or text smaller than 40px on 1080×1920.
