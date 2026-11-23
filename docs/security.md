# Security

## Scope

THRESHOLD is a **client-side static web application**. It does not include a custom backend server, authentication, or database in this repository.

## Data handled

- **localStorage**: stores game settings and progress (e.g. unlocked levels, deaths, time). Data stays in the user’s browser.
- **No accounts, no network sync** to project servers (as shipped).
- **No analytics or tracking code** included in the repository (verify in deployed builds if you add any).

## Threat model (practical notes)

- Malicious browser extensions or compromised browsers can read/modify page content and `localStorage` like any web app.
- Loading third-party content is limited to what is bundled locally (`vendor/`, `assets/`) and standard browser APIs; no remote script loading beyond what `index.html` and ES module imports do from the same origin.
- If you host this on a domain you control, serve over **HTTPS**.

## Reporting vulnerabilities

Please use the process described in [`SECURITY.md`](../SECURITY.md) in the repository root.

## Hardening recommendations (if you fork/deploy)

- Add a Content Security Policy appropriate for your hosting setup (note: inline scripts are minimal; main logic is module scripts).
- Keep `three.js` vendored files updated deliberately (security fixes may require manual review due to size/vendor layout).
