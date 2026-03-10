# Security Policy

## Scope

The following are considered security vulnerabilities in this project:

- **Encryption bypass** — weaknesses in content encryption or key derivation (`src/crypto.ts`) that allow reading encrypted entries without the correct secret
- **Authentication vulnerabilities** — flaws in the OAuth flow or session/cookie handling that allow unauthorized access
- **Authorization issues** — bugs that allow one user to read, modify, or delete another user's entries
- **Secrets exposure** — paths that cause `SERVER_ENCRYPTION_SECRET`, `COOKIE_SECRET`, or OAuth credentials to leak in responses, logs, or error messages

## Out of Scope

- Vulnerabilities in Cloudflare's infrastructure — report those directly to [Cloudflare](https://www.cloudflare.com/trust-hub/reporting-security-issues/)
- Issues that require the attacker to already have access to your Cloudflare account — at that point they control the Worker and KV namespace directly
- Misconfigurations caused by not following the deployment instructions (e.g. sharing your Worker URL with secrets embedded in it)

## Reporting a Vulnerability

Use **GitHub's private vulnerability reporting**: go to the Security tab of this repo and click **"Report a vulnerability"**. This keeps the disclosure private until a fix is ready and published.

Please do not open a public issue for security vulnerabilities.

> **Note for repo maintainer:** Private vulnerability reporting must be enabled in repo Settings → Security → "Private vulnerability reporting" (one-click toggle).

## Response Expectations

This is a maintainer-run project, not a dedicated security team. You can expect:

- **Acknowledgement** within a few days of the report
- **Patch and coordinated disclosure** within 30 days for confirmed, exploitable vulnerabilities
- Credit in the release notes if you'd like it

Thank you for helping keep this project secure.
