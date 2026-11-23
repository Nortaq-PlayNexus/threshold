# Development

## Prerequisites

- A modern browser with WebGPU recommended (Chrome/Edge). WebGL2 fallback exists but feature/perf parity is not guaranteed.
- A local static file server (ES modules and fetch for assets require HTTP in practice).

## Run locally

From the repo root:

```bash
python3 serve.py
```

Or:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Project layout

- `index.html` — entrypoint, import map, HUD/menu markup.
- `css/style.css` — UI and overlay styles.
- `js/` — game code (ES modules).
- `assets/` — textures, HDRI, images, fonts.
- `vendor/three/` — vendored Three.js r187 modules.

## Quality / debug URL params

- `?q=ultra|high|low`
- `?level=1..6&auto=1`
- `?unlock=1`

## Common tasks

- **Change a level:** edit files under `js/levels/`.
- **Tweak renderer/post FX:** `js/renderer.js` and related TSL usage in the codebase.
- **Update UI text/styles:** `index.html`, `css/style.css`, `js/ui.js`.

## Tests

There is currently **no automated test suite** configured (see root `package.json`). Manual testing in-browser is the primary verification method.

## Code style

No enforced linter/formatter is committed. Match the existing style (vanilla JS, ES modules, minimal dependencies).
