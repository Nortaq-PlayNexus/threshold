# Contributing

Thanks for your interest in THRESHOLD.

## Ground rules

- Be respectful (see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)).
- This is a small prototype; keep changes focused and explain intent in the PR.
- Do not commit secrets, API keys, or personal data.

## Development setup

1. Clone the repo.
2. Run a static server from the repo root (see [docs/development.md](docs/development.md)), e.g. `python3 serve.py`.
3. Test in at least one Chromium-based browser and note any WebGPU/WebGL2 differences if relevant.

## Making changes

- Prefer small, reviewable pull requests.
- If you change rendering, levels, or assets, include screenshots or a short screen recording note in the PR description when practical.
- Update `README.md` / `docs/` if behavior or run instructions change.
- Update `CHANGELOG.md` under **Unreleased** for user-visible changes.

## Reporting bugs

Use the GitHub issue template **Bug report**. Include browser, OS, GPU (if known), console errors, and steps to reproduce.

## Feature requests

Use the **Feature request** template. Describe the problem and why it fits the project’s scope (liminal exploration prototype).
