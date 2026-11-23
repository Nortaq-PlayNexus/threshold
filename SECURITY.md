# Security policy

## Supported versions

This is an experimental prototype. Security fixes are applied to the latest code on `main` when feasible; tagged releases may not all receive backports.

| Version | Supported |
|---------|-----------|
| `main` | Yes |
| Tagged releases (e.g. 1.0.0) | Best effort |

## Reporting a vulnerability

**Please do not** open a public GitHub issue for security-sensitive reports.

Instead, use one of:

1. **GitHub private vulnerability reporting** (preferred if enabled for this repository): use the “Report a vulnerability” flow in the Security tab.
2. **Email/contact:** open a GitHub issue titled `[SECURITY CONTACT]` with no exploit details and ask for a private channel, or contact the maintainer via the GitHub profile (Nortaq-PlayNexus) if no other channel is listed.

Include:

- Description of the issue and impact
- Steps to reproduce or a proof of concept
- Affected URLs/files/versions (commit SHA or tag)

You will receive an acknowledgment when the maintainer has bandwidth; response times are not guaranteed for this side project.

## Scope notes

This project is a static client-side app. Issues in third-party vendored code (`vendor/three/`) should also be reported upstream when appropriate; mention it in your report.
