# Deployment

THRESHOLD is a **static site** (HTML, CSS, JS modules, assets, vendored JS). No server-side rendering is required at runtime.

## General steps

1. Publish the repository contents (at minimum: `index.html`, `css/`, `js/`, `assets/`, `vendor/`, plus any docs you want public).
2. Configure the host to serve files with correct MIME types:
   - `.js` → `application/javascript`
   - `.mjs` → `application/javascript`
   - `.json` → `application/json`
   - `.wasm` → `application/wasm` (if added later)
   - `.woff2` → `font/woff2`
   - `.webp` → `image/webp`
   - `.hdr` → `application/octet-stream` or `image/vnd.radiance` (either is common; browsers usually still fetch)
   - `.png`, `.jpg` as appropriate
3. Use HTTPS in production (required for some browser APIs in practice; good hygiene).
4. Optional: set cache headers. For development the included `serve.py` sends `Cache-Control: no-store`; for production you may cache immutable assets longer and use hashed filenames only if you introduce a build step (not present today).

## GitHub Pages

Two common approaches:

- **Branch/folder:** publish from `main` with the site root set to the folder containing `index.html` (or use `/docs` if you reorganize). This repo currently has `index.html` at root, so you can deploy the repo root as the Pages source if your workflow copies files, or use a GitHub Action that uploads the directory.
- **GitHub Actions:** use `actions/upload-pages-artifact` pointing at the repo root (or a staging dir) and `actions/deploy-pages`. A Pages workflow can be added under `.github/workflows/` (not included by default in this repo).

If the site is served from a subpath (e.g. `https://user.github.io/threshold/`), absolute-root references in code would break; this project uses relative paths (`./vendor/...`, `css/style.css`, etc.) in the checked-in files, which is compatible with subpath hosting in most cases — verify after deploy.

## Other hosts

Netlify, Vercel (static), Cloudflare Pages, or any static CDN work. No environment variables are required.
