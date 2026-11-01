# Web3 Logo Craft

A web3 logo lives mostly at **tiny sizes**: an X/Telegram avatar (a 40px circle), a token icon in a wallet list,
a favicon, a chain-explorer badge. Design for 32px first, then for big.

## What makes a strong web3 mark
- **One idea, reduced to geometry.** A single memorable shape built from circles, squares, and clean angles, drawn on a grid.
- **Meaning from the name or product, not from "blockchain".** Unhinged → a door coming off its hinge. Ledger → stacked
  lines. Bridge → an arc. Use metaphor, initials, or a character, never generic crypto symbols.
- **Works in one color.** It must survive as solid white on black and solid black on white. Color and gradients come second.
- **Fits a circle crop.** Avatars are circular, so keep the mark's important parts inside the central ~70%.
- **Ownable silhouette.** Squint test: is it recognisable as a blurry blob? If it looks like 50 other DeFi logos, start again.

## Noise filter for logos (never)
Hexagons-with-nodes, interlocking chain links, generic coins with a letter, padlocks, globes, rockets, moons, lightning
bolts as the whole idea, glowing 3D spheres, swooshes, gradient blobs with no form, letter-in-a-circle with nothing else.

## Types to choose from (pick one per concept)
| Type | When it fits | Example idea |
|---|---|---|
| **Abstract mark** | Protocols, infra, L1/L2 | Interlocking geometric forms suggesting flow or layers |
| **Lettermark / monogram** | Short names, finance | Initials built from one consistent stroke system |
| **Pictorial / metaphor** | Consumer apps, memorable names | The object the name evokes, simplified to 3–5 shapes |
| **Mascot / character** | Memecoins, NFT, GameFi, community | A simple face or character, flat, strong outline |
| **Wordmark only** | Distinctive names, premium brands | Custom-feeling type with one modified letter |

## Wordmark rules
- One family (Google Fonts) with a confident weight. Tracking between **-0.02em and -0.04em, never tighter**: letters must
  never touch or overlap, especially in heavy weights at large sizes. Check pairs like "ng", "ed", and "hi".
- Customise **one** detail (a cut, a joined pair, a replaced letter) rather than decorating everything.
- Lowercase reads friendly and modern; uppercase reads institutional and strong. Choose deliberately.

## SVG construction (strict)
- `viewBox="0 0 100 100"` for the mark. Use only `path`, `circle`, `rect`, `polygon`, `g`, and gradients, with fills not strokes where possible.
- No text in the mark's SVG (fonts aren't embedded). The wordmark is set in HTML next to it.
- No raster images, no filters except an optional subtle gradient. Keep it under ~4 KB.
- Use exact, round coordinates on a grid. Optical balance matters more than mathematical centring.

## Color
- 1 primary brand color plus neutrals. Pick by sector (see sector playbooks) and by audience, and give hex values.
- Always show: primary on dark, primary on light, and solid monochrome.
