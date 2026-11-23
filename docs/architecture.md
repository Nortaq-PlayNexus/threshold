# Architecture

## Overview

THRESHOLD is a static, client-side web application: ES modules loaded directly by the browser via an import map (`index.html`). There is no application bundler in the runtime path; `vendor/three/` ships prebuilt Three.js ESM files (r187).

## Boot flow (high level)

1. `index.html` loads `css/style.css` and defines an import map for `three`, `three/webgpu`, `three/tsl`, and `three/addons/*` pointing at `./vendor/three/...`.
2. `js/main.js` initializes `Renderer` (`js/renderer.js`), sets up input/player, applies settings from `localStorage`, and wires menu UI (`js/ui.js`).
3. Levels live in `js/levels/l1_lobby.js` … `js/levels/l6_hill.js`, selected by menu or URL params (`?level=…`).

## Key modules

| Module | Role |
|--------|------|
| `renderer.js` | `WebGPURenderer` init, fallback behavior, quality tiers, post-processing pipeline (GTAO/TRAA/FXAA paths per tier, bloom, custom TSL grade). |
| `world.js`, `cellworld.js` | Grid/cell world construction helpers. |
| `player.js`, `input.js` | Movement, look, pointer lock, interaction state. |
| `entities.js`, `props.js` | Level entities and props. |
| `water.js` | Water rendering helpers (reflections/caustics integration as implemented). |
| `audio.js` | Procedural Web Audio graph, spatialization, reverb/filters. |
| `assets.js` | Texture/model loading helpers and progress reporting. |

## Rendering notes

- Materials use **TSL** (`three/tsl`) patterns consistent with Three.js r187 WebGPU direction.
- Heavy lighting in Level 1 uses **Clustered Forward+** (`ClusteredLighting`) for many point lights.
- Quality presets (`ultra` / `high` / `low`) are exposed via settings UI and `?q=` URL param.

## Data & persistence

- `localStorage` keys (observed): `threshold.settings`, `threshold.save` (see `main.js`).  
- No network backend, no accounts, no telemetry in the repository code (as shipped).

## Assets

- PBR textures and images under `assets/` (ambientCG CC0, Poly Haven CC0 HDRI, local fonts, AI-generated images noted in README).  
- `vendor/three/` contains Three.js and many addons; not all files are necessarily imported by the game.

## Limitations (architectural)

- No build-time type checking or bundling in this repo; errors surface at runtime in the browser.
- Browser support depends on WebGPU/WebGL2 capabilities and driver behavior.
