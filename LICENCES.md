# Captured sources (all CC0 1.0)

Fetched with curl on 2026-11-12 from ambientCG. ambientCG publishes every material under CC0 1.0 Universal
(public domain dedication): https://docs.ambientcg.com/license/ . No attribution is required; it is given here anyway.
Only the colour and displacement (height) maps are kept; normals are computed from the height in `tools/bake.py`.

| File | Source URL | Licence | Used for |
|---|---|---|---|
| `ambientcg/Paper001/Paper001_2K-JPG_Color.jpg`, `_Displacement.jpg` | https://ambientcg.com/view?id=Paper001 (download: https://ambientcg.com/get?file=Paper001_2K-JPG.zip) | CC0 1.0 | Kept stub and earlier stubs (uncoated, toothy), torn-edge fibre profile, ink grain |
| `ambientcg/Paper002/Paper002_2K-JPG_Color.jpg`, `_Displacement.jpg` | https://ambientcg.com/view?id=Paper002 (https://ambientcg.com/get?file=Paper002_2K-JPG.zip) | CC0 1.0 | The matte surface (dark and light grounds) |
| `ambientcg/Paper003/Paper003_2K-JPG_Displacement.jpg` | https://ambientcg.com/view?id=Paper003 (https://ambientcg.com/get?file=Paper003_2K-JPG.zip) | CC0 1.0 | Cockle of the vendor's leaf |
| `ambientcg/Paper004/Paper004_2K-JPG_Color.jpg`, `_Displacement.jpg` | https://ambientcg.com/view?id=Paper004 (https://ambientcg.com/get?file=Paper004_2K-JPG.zip) | CC0 1.0 | Ribbed binding tape |
| `ambientcg/Paper005/Paper005_2K-JPG_Color.jpg` | https://ambientcg.com/view?id=Paper005 (https://ambientcg.com/get?file=Paper005_2K-JPG.zip) | CC0 1.0 | Creases in the vendor's leaf (albedo only) |
| `ambientcg/Paper006/Paper006_2K-JPG_Color.jpg`, `_Displacement.jpg` | https://ambientcg.com/view?id=Paper006 (https://ambientcg.com/get?file=Paper006_2K-JPG.zip) | CC0 1.0 | Greyboard cover of the closed book |

Not found as CC0 or public domain: a scan of a torn perforation or a torn paper edge usable as an alpha mask
(a Wikimedia Commons search returned only CC BY / CC BY-SA edge scans, which are not allowed here).
The torn bridges are therefore drawn per bridge from multi-scale noise plus a line profile read from the Paper001 height scan.

Fonts: Besley and Schibsted Grotesk, SIL Open Font License 1.1, see `../../fonts/OFL-*.txt`.

## Round 2 (live scene, 2026-11-13)
No new downloads and no libraries. The live scene (`motion.js`) is raw WebGL2 written for this site; nothing is fetched from another host.
Every texture it uses is derived from the CC0 scans above by `tools/textures.py`:

| File | Made from | Licence |
|---|---|---|
| `../gl/paper.webp` | Paper001 colour and height (kept stock), Paper003 height (leaf stock) | CC0 1.0 (derived) |
| `../edge/edge-strip.webp` | Paper001 height line profiles plus seeded multi-scale noise (torn-bridge contour, fibre core, loose fibres) | CC0 1.0 (derived) |
| `../ground.webp` | Paper002 colour and height (the matte ground) | CC0 1.0 (derived) |
| `../poster-*.webp`, `../day-*.webp` | Frames of the live scene itself, captured by `tools/record.py` and packed by `tools/posters.py` | CC0 1.0 (derived) |

Still not found as CC0 or public domain: a captured torn-perforation edge. `assets/edge/edge-strip.webp` is the drop-in slot for one.

## Round 3 (one pad, bound at the top, 2026-11-13)
No new downloads and no libraries. The scene (`motion.js`) is still raw WebGL2 written for this site and fetches nothing from another host.

| File | Made from | Licence |
|---|---|---|
| `../edge/edge-strip-gen.webp` (in use for the top perforation) | `demo/lh4/gen/edges/r6_g31_grey_{bot,top}_s631.png`, `r6_g32_grey_{bot,top}_s632.png`, `r6_g33_grey_{bot,top}_s633.png`, packed by `tools/edge_from_gen.py` (alpha from the black background, cut at hole centres, resampled to the strip format) | Generated output, see below |
| `../edge/edge-strip.webp` (fallback, loaded only if the generated strip is missing) | Round 2's code-made strip (CC0 Paper001 profiles plus seeded noise) | CC0 1.0 (derived) |
| `../poster-*.webp`, `../day-041{6,7}*.webp` | Frames of the live scene itself (`tools/record.py posters`, `tools/posters.py`) | CC0 1.0 (derived) plus the generated strip |

Generated strips, copied from `demo/lh4/gen/LICENCES.md` (checked there on 2026-11-13 against the Hugging Face model pages):

| Part | Model id | Revision (commit) | Licence | URL |
|---|---|---|---|---|
| Image model | `stabilityai/stable-diffusion-xl-base-1.0` | `462165984030d82259a11f4367a4eed129e94a7b` | CreativeML Open RAIL++-M | https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0 |
| VAE (fp16 fix) | `madebyollin/sdxl-vae-fp16-fix` | `207b116dae70ace3637169f1ddd2434b91b3a8cd` | MIT | https://huggingface.co/madebyollin/sdxl-vae-fp16-fix |

The licence claims no rights in generated output and puts no limit on commercial use of output; the use restrictions in its Attachment A
apply to how output is used, and a paper-edge texture on a website is well outside them. The strip geometry (holes, tear line) is code-made
(`demo/lh4/gen/scripts/`, written for LH4, no third-party licence); SDXL supplied only the paper look. Not legal advice.
Note for the lane lead: this is the one asset on the site that is not CC0, MIT or OFL. If RAIL++-M output is not acceptable under this job's
rules, delete `edge-strip-gen.webp`: the scene falls back to the code-made strip by itself (one 404 in the console), or re-point `EDGES` in `motion.js`.

## Round 4 (re-staged tear, one light, 2026-11-13)
No new downloads, no new sources and no libraries. Changes to derived files only:

| File | Change | Licence |
|---|---|---|
| `../ground.webp` | Round 3's tile (CC0 Paper002, `tools/textures.py`) with its contrast cut to 45% around its mean, so the ground reads fine and matte | CC0 1.0 (derived) |
| `../edge/edge-strip-gen.webp` | Re-packed by `tools/edge_from_gen.py` from the same three generated pairs (`r6_g31/g32/g33_grey`): 15 segments of 4 to 9 holes taken from random places in the three strips, alternate pieces mirrored, so the visible run never repeats | Generated output, as recorded in round 3 |
| `../poster-*.webp`, `../day-041{6,7}*.webp` | Re-captured from the round 4 scene (`tools/record.py posters`, `tools/posters.py`) | CC0 1.0 (derived) plus the generated strip |

## Round 5 (the sheet tears free and falls, 2026-11-13)
No new downloads, no new sources and no libraries. The word-box map that keeps the print whole while the sheet lifts is drawn in code
at load time (`motion.js`), not shipped. Changes to derived files only:

| File | Change | Licence |
|---|---|---|
| `../poster-*.webp` | Re-captured from the round 5 scene (shorter pad, new grey sheet, steeper key light) by `tools/record.py posters` and `tools/posters.py` | CC0 1.0 (derived) plus the generated strip |
| `../day-0416*.webp`, `../day-0417*.webp` | Re-captured as torn-off leaves at the hero sheet's scale (1160 x 1400 desk, 900 x 1086 phone) with a curled corner | CC0 1.0 (derived) plus the generated strip |
