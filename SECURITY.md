# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `@lazysuperheroes/hedera-multisig`,
please report it privately so we can address it before public disclosure.

**Email:** `stowerling@duck.com` with subject prefix `[hedera-multisig SECURITY]`

Please include:
- A description of the issue and its potential impact
- Steps to reproduce (or a proof-of-concept)
- Affected versions, OS / Node version, and component (CLI, server, dApp, agent SDK)
- Whether you believe the issue is exploitable in production deployments
  (Vercel-hosted dApp + self-hosted coordinator) or only in specific configurations

We aim to acknowledge receipt within **3 business days** and provide a remediation
timeline within **10 business days**. For critical vulnerabilities (CVSS ≥ 9.0,
remote code execution, key-material exposure, or signature forgery) we will
prioritize a fix and coordinate disclosure with the reporter.

If you have a fix or workaround, please include it. Credit will be given in the
release notes unless you prefer to remain anonymous.

## Scope

In scope:
- The npm package `@lazysuperheroes/hedera-multisig` (CLI, library, server, client, agent SDK)
- The dApp at `multisig.lazysuperheroes.com` and `testnet-multisig.lazysuperheroes.com`
- Documentation that describes a security property the code does not actually enforce

Out of scope:
- Vulnerabilities in third-party tunnel providers (ngrok, localtunnel) — report to those projects
- Vulnerabilities in the Hedera consensus or mirror node — report to Hedera
- Issues that require physical access to a signer's machine
- Social engineering of session coordinators or participants

## Audit & Maturity Status

**This project has not been independently audited.** It is a community-maintained
library released under MIT license without warranty.

We have done extensive internal review (multi-agent code analysis, CVE patching,
post-AUTH role enforcement, timing-safe credential comparisons, server-side
signature verification, public-key eligibility binding to reconnection tokens)
but external assurance is recommended before using this library to control
mainnet treasury value above your personal risk tolerance.

**Recommendation:**
- Testnet: use freely
- Mainnet: review the threat model in `docs/SECURITY_ARCHITECTURE.md`, run a
  small test ceremony first, and consider contracting a security audit if the
  treasury value is significant
- For high-value mainnet deployments, prefer the offline / air-gapped workflow
  over the networked workflow, and run your own coordinator (do not rely on a
  publicly hosted one)

## Supported Versions

| Version | Status |
|---|---|
| 2.1.x | Currently maintained — security fixes land here |
| 2.0.x | Superseded — upgrade to 2.1.x. Critical-only patches considered for 90 days from 2.1.0 release date. |
| < 2.0 | Unsupported |

## Known Trust Boundaries

- **Private keys never leave the signer's device.** The coordinator and the
  WebSocket server only see frozen transaction bytes and signatures. If you
  observe behavior contradicting this, please report it as a critical issue.
- **The hosted dApp is a static UI.** Vercel does not host a coordinator
  WebSocket process. Coordinator state always lives on a server you (or another
  coordinator) run. Compromise of the Vercel-served bundle would be in scope
  (supply-chain attack) and would warrant immediate disclosure.
- **Tunnel providers can observe traffic patterns and metadata.** When using
  `--tunnel` (ngrok / localtunnel) the third-party service relays your WebSocket
  traffic. Use `--tls-cert` for direct WSS where possible, or restrict tunnel
  use to ceremonies whose existence is not itself sensitive.
- **The agent PolicyEngine is advisory.** `RateLimitRule` and `TimeWindowRule`
  trust the local clock and reset on process restart. Do not rely on them as
  the sole defense-in-depth layer for high-value automated signing.

## Change History

| Date | Note |
|---|---|
| 2026-05-01 | Initial security policy published with v2.1.0 release. |
