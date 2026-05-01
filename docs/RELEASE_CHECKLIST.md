# Release checklist — v2.1.0

This is the runbook for cutting the v2.1.0 release. Code-side prep is
done (Phases A–D complete, version bumped, CHANGELOG written, tests
green). The remaining steps require **your** hands because they
involve credentials (GPG, NPM_TOKEN), publishing (npm), and deployment
(Vercel) that I can't perform autonomously.

Follow in order. Each step has a verify-after command so you can
confirm it landed.

## 0. Pre-flight (already done — confirm only)

- [x] `package.json` version: `2.1.0` — `node -p "require('./package.json').version"`
- [x] `dapp/package.json` version: `2.1.0`
- [x] `engines.node`: `>=20.0.0`
- [x] `CHANGELOG.md` has a `## [2.1.0] - 2026-05-01` section at the top
- [x] Three CRITICALs closed (regression tests in `test/coordinator-authorization.test.js`, `test/reconnection-token.test.js`, `test/redis-session-store.test.js`)
- [x] `npm run test:unit` passes (84/84)
- [x] `npm run test:coverage:check` passes (gate at 45/35/55, actual ~50/39/60)
- [x] `npm audit --omit=dev --audit-level=high` exits 0
- [x] `dapp/` typechecks clean (`cd dapp && npx tsc --noEmit -p .`)

If any of these are red, stop and fix before proceeding.

## 1. Run the manual E2E walkthroughs (TESTING.md Scenarios 11 + 12)

You said you'd run these before publish. They cover the full happy
path on testnet:

```bash
# Scenario 11 — HBAR walkthrough (~30 min, ~6 ℏ)
cd examples/walkthrough-hbar
node 00-precheck.js
node 01-generate-keys.js
node 02-create-threshold-account.js
# … then start coordinator + dApp + 2 participants per README
node 06-verify-on-mirror.js <txId>

# Scenario 12 — contract walkthrough (~30 min, ~10 ℏ; requires Scenario 11's keys)
cd ../walkthrough-contract
node 00-precheck.js
node 01-create-demo-eoa.js
node 02-deploy-as-eoa.js
node 03-fund-contract.js
node 04-call-increment-as-eoa.js
node 05-convert-eoa-to-multisig.js
node 06-prove-eoa-rejected.js   # MUST exit 0
node 07-prepare-multisig-increment.js   # then ceremony via dApp /create
node 08-prepare-multisig-withdraw.js    # then ceremony via dApp /create
```

**Test all three injection paths during the contract ceremonies:**

- **Path A** — dApp `/create` "Build from form" tab (paste ABI from
  `Counter.json`, pick function, click Inject)
- **Path B** — dApp `/create` "Paste frozen TX" tab (paste base64 from
  `07-prepare-multisig-increment.js`)
- **Path C** — `npx hedera-multisig inject --connect "..." --base64-file
  multisig-increment-tx.json --coordinator-token "..."`

If any walkthrough fails, file an issue and stop the release.

## 2. Commit the release

I have NOT auto-committed. Stage + commit the working tree yourself:

```bash
# Survey what's changed
git status

# Stage everything (review the diff first if you're cautious)
git diff --stat
git add -A

# Commit with the conventional release shape
git commit -m "chore: release v2.1.0

Phase A: closed 3 CRITICALs (coordinator role, protobufjs CVE,
reconnection-token key binding), HIP-423 schedule flags, Redis parity,
deprecated decoder migration.

Phase B: 16 HIGH fixes — PIN opt-in in links, sessionStorage handoff,
origin-default deny, executeTransaction lock + execution-failed state,
SECURITY.md, hosted-vs-self-host docs, tunnel trust-model docs,
selectorVerified UI, ABI editor, mirror verification, plain-English
result codes, mirror retries, coordinator-token sweep, audit logging.

Phase C: 19 MEDIUMs — intent-vs-actual diff, release workflow with
provenance, Node 20+/24, dependabot, coverage gate, dApp ESLint,
healthz endpoint, NavBar lazy WalletConnect, polling jitter, README
rewrite, PolicyEngine known-limits, decoder fixtures, Promise.all
parallelism, metadata cross-check, history disclaimer, first-time
hints, tunnel detection banner, --quiet-secrets.

Phase D: HBAR + contract walkthroughs (with EOA→multi-sig migration
arc + negative test), Counter.sol with forge-compiled artifact,
ContractCreateFlow deploy script, three injection paths (dApp build,
dApp paste-base64, CLI inject), THRESHOLD_GUIDE.md, /learn route.

See CHANGELOG.md and docs/V2.1.0_PLAN.md for the full ledger."
```

**Important:** my CLAUDE.md says GPG-signed commits are required. If
your signing key isn't configured, `git commit` will fail — fix the GPG
config rather than passing `--no-gpg-sign`.

Verify:

```bash
git log --show-signature -1   # should show "Good signature from..."
```

## 3. Sign and push the tag

```bash
# Annotated, GPG-signed tag — required by CLAUDE.md
git tag -s v2.1.0 -m "Release v2.1.0 — security stabilization + scheduled-tx unlock + walkthroughs

See CHANGELOG.md § 2.1.0 for the full release notes."

# Verify the signature locally
git tag -v v2.1.0   # should show "Good signature"

# Push the commit and tag
git push origin main
git push origin v2.1.0
```

The tag push triggers `.github/workflows/release.yml`, which runs
tests, the production audit, and `npm publish --provenance` via OIDC.

## 4. Watch the release workflow

```bash
gh run watch
# or: gh run list --workflow=release.yml --limit 1
```

The workflow does (in order):

1. Verify the tag signature (warns if no GPG keys imported in CI; this
   is acceptable as long as you signed locally and your local
   `git tag -v v2.1.0` succeeded)
2. `npm ci`
3. `npm run test:unit`
4. `npm audit --omit=dev --audit-level=high`
5. `package.json` version matches tag (`2.1.0`)
6. `npm publish --provenance --access public`

If step 5 fails, you'll get `Tag version (X) does not match
package.json version (Y)` — re-tag after fixing.

## 5. Verify the npm publish

```bash
# The published version
npm view @lazysuperheroes/hedera-multisig@2.1.0 version

# Provenance attestation should be linked
npm view @lazysuperheroes/hedera-multisig@2.1.0 dist.attestations

# Smoke test: install in a temp dir
mkdir /tmp/multisig-smoke && cd /tmp/multisig-smoke
npm init -y >/dev/null
npm install @lazysuperheroes/hedera-multisig@2.1.0
node -e "const m = require('@lazysuperheroes/hedera-multisig'); console.log('Exports:', Object.keys(m).slice(0, 8).join(', '), '...'); console.log('Version:', m.version);"
```

The smoke-test should print `Version: 2.1.0` and a list of named
exports without crashing.

## 6. Deploy the dApp to Vercel (both projects)

The dApp is hosted on **two separate Vercel projects** that build from
the same repo:

- `multisig.lazysuperheroes.com` — mainnet (env: `NEXT_PUBLIC_DEFAULT_NETWORK=mainnet`)
- `testnet-multisig.lazysuperheroes.com` — testnet (env: `NEXT_PUBLIC_DEFAULT_NETWORK=testnet`)

If both are configured to auto-deploy from `main`, the `git push origin main`
in step 3 already kicked them off. Verify:

```bash
# In each Vercel project dashboard, the latest deployment should:
#   - have commit hash matching the v2.1.0 commit
#   - show "Ready" status
#   - serve the new /learn route
curl -sI https://multisig.lazysuperheroes.com/learn | head -3
curl -sI https://testnet-multisig.lazysuperheroes.com/learn | head -3
# Both should return HTTP 200
```

Manual smoke checks on each domain:

- [ ] Landing page loads; "How this works" reassurance card visible
- [ ] `/learn` renders both walkthrough cards
- [ ] `/join` page shows the tunnel/hosted detection banner when you
      paste a tunnel URL
- [ ] `/create` shows the Build/Paste tabs after coordinator AUTH
- [ ] Network tab: WalletConnect chunk does NOT load on `/` (verifies C8)

If a deployment fails or shows the wrong env, manually trigger a
deploy from the Vercel UI for that project.

## 7. Post-release announcements (optional but recommended)

- Update GitHub repo description / topics if needed
- Open a GitHub Release pointing at the tag
- Post in the Hedera Discord / forum thread (if you maintain one)
- Update any "shipped 2.0" external references

## 8. Cleanup

```bash
# Local artifacts from your walkthrough dry runs
rm -f examples/walkthrough-hbar/walkthrough-keys*.json
rm -f examples/walkthrough-hbar/walkthrough-state.json
rm -f examples/walkthrough-contract/demo-account-state.json
rm -f examples/walkthrough-contract/multisig-*-tx.json

# Clear local environment
unset HEDERA_MULTISIG_COORDINATOR_TOKEN  # if you set it during the dry run
```

## Rollback

If something is wrong and you need to unpublish:

```bash
# npm allows unpublishing within 72 hours of publish (older than that requires support ticket)
npm unpublish @lazysuperheroes/hedera-multisig@2.1.0

# Then republish a 2.1.1 with the fix — never reuse a version number
```

For Vercel, redeploy the previous main commit:

```bash
git revert HEAD   # creates a revert commit
git push origin main
```

## What I cannot do for you

- `git commit` — my CLAUDE.md instructions forbid me committing without explicit per-commit user authorization, and your project requires GPG signing which I can't drive
- `git tag -s` — same, plus I can't sign with your key
- `git push` — I can't push to a remote without explicit auth
- `npm publish` — same, plus this needs your NPM auth
- Vercel deployment — I have no Vercel credentials

These need you. Everything in `## 0. Pre-flight` and `## 1.` (the manual walkthroughs) are the only steps where I can pre-verify; the rest is yours.

---

*Last updated: 2026-05-01 — v2.1.0 release prep complete.*
