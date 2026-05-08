# Walkthrough: coordinated signing via the public testnet dApp

> **What you'll demonstrate:** an end-to-end 2-of-3 multi-sig HBAR
> transfer using the publicly hosted dApp at
> [`testnet-multisig.lazysuperheroes.com`](https://testnet-multisig.lazysuperheroes.com)
> — the coordinator runs locally with a public tunnel, and participants
> sign via HashPack (or any other WalletConnect-compatible Hedera
> wallet) in their own browser. No local dApp install required.
>
> **One extra setup step vs. the all-CLI walkthroughs.** HashPack
> signs via Hedera *accounts*, not raw keys — so before alice can sign
> in HashPack we have to create on-chain accounts for the alice / bob
> / carol keys we just generated. That's step 2 below; ~1.65 ℏ total
> from your operator. The threshold account (step 3) is unchanged —
> still 2-of-3 across alice/bob/carol, no operator-as-signer compromise.

**You will not run a local dApp.** The hosted instance at
`testnet-multisig.lazysuperheroes.com` is the dApp, full stop — it
runs in alice's browser as a static client. The only thing on your
machine is the coordinator (a small WebSocket server), exposed as a
public WSS URL via ngrok so the hosted dApp can reach it.

What runs where:

| Component | Where it runs | What it does |
|---|---|---|
| **Coordinator** (`npx hedera-multisig server --tunnel-provider ngrok`) | Your machine, terminal 1 | WebSocket server. Holds session state, broadcasts the frozen tx, collects signatures, executes when threshold is met. |
| **dApp UI** (`/create`, `/join`) | Hosted: `testnet-multisig.lazysuperheroes.com` | Static browser client. Connects to your coordinator's public WSS URL. No install, no Vercel coordinator process. |
| **HashPack** (alice's signer) | Browser extension on alice's machine | Holds alice's private key (imported from `walkthrough-keys.json`). Step 2 creates an on-chain account for that key so HashPack's mirror lookup succeeds; the wallet binds the WalletConnect session to that account, then signs the multi-sig tx with alice's key. |
| **CLI participant** (bob's signer) | Your machine, terminal 3 | Holds bob's encrypted key file in memory, signs locally, submits over the same WebSocket. Carol sits out — that's the point of a 2-of-3 threshold. |

Two things are intentional here:

1. **HTTPS dApp ⇒ WSS coordinator.** The hosted dApp runs over HTTPS,
   which means it can only connect to the coordinator over WSS — a
   plain `ws://localhost:3001` would be blocked as mixed content.
   `--tunnel-provider ngrok` is the simplest way to expose your coordinator as
   a public WSS URL.
2. **Hybrid signing — one wallet, one CLI.** Driving two HashPack
   sessions through WalletConnect inside the 120-second window is
   fiddly and frustrating. The realistic team pattern is one signer
   in a wallet, one on a CLI on a hardened signing machine. This
   walkthrough shows both modes completing the same ceremony —
   they're protocol-equivalent. (If you're set on demoing all-web,
   the variant is at the bottom.)

> **Want to compare against an all-local stack?** See
> [`../walkthrough-hbar/`](../walkthrough-hbar/) — same protocol, but
> coordinator and dApp and signers all run on the same machine. Useful
> for offline / air-gapped development; not what this walkthrough is
> about.

Roughly 30 minutes end-to-end. Fully self-contained — generate keys
here, or copy them across from `walkthrough-hbar` if you've already got
them.

---

## Prerequisites

1. **Operator credentials** in the project root `.env`
   (`OPERATOR_ID`, `OPERATOR_KEY`, `HEDERA_NETWORK=testnet`). See
   [`START_HERE.md`](../../START_HERE.md) if you don't have a testnet
   account yet — `portal.hedera.com` gives you 10,000 testnet ℏ for
   free.
2. **Node 20+** and `npx` on your `$PATH`.
3. **An ngrok auth token** — free tier is fine, no credit card.
   - Sign up at [`dashboard.ngrok.com/signup`](https://dashboard.ngrok.com/signup).
   - Copy the token at
     [`dashboard.ngrok.com/get-started/your-authtoken`](https://dashboard.ngrok.com/get-started/your-authtoken).
   - Add it to the project root `.env` as `NGROK_AUTH_TOKEN=<token>`.
     The coordinator picks it up automatically (it walks up from cwd
     looking for the nearest `.env`, so running from this subdirectory
     finds the repo-root file).
   - **Nothing else.** No `ngrok` CLI install, no separate
     `ngrok config add-authtoken` step. Pre-existing tokens from older
     versions of these docs will keep working — if a token is rejected,
     rotate it from the dashboard link above.
4. **HashPack browser extension** installed
   ([`hashpack.app`](https://www.hashpack.app)) and configured for
   testnet. Any WalletConnect-compatible Hedera wallet (Blade, Kabila,
   etc.) works the same way — instructions below use HashPack as the
   reference; substitute your wallet's "import private key" flow if
   you prefer something else.

> **Already ran `walkthrough-hbar`?** You can copy the keys and the
> existing threshold account across, which lets you skip step 1 (key
> generation) and step 3 (threshold creation) — but you still need to
> run step 2, because walkthrough-hbar didn't create on-chain accounts
> for the signer keys:
> ```bash
> cp ../walkthrough-hbar/walkthrough-keys.* .
> cp ../walkthrough-hbar/walkthrough-state.json .
> node 02-create-signer-accounts.js   # required even if you copied state
> ```
> The signer-account creation will populate
> `walkthrough-signer-accounts.json` separately, and the on-chain
> threshold account from walkthrough-hbar continues to work unchanged
> (its KeyList already contains alice/bob/carol's pubkeys). Either
> path works; the from-scratch flow is below.

---

## Step 1: Generate three signing keys

```bash
cd examples/walkthrough-dapp
node 01-generate-keys.js
```

Produces:

| File | What |
|---|---|
| `walkthrough-keys.alice.encrypted` (and `.bob`, `.carol`) | AES-256-GCM encrypted single-key files. Passphrase: `walkthrough-test`. |
| `walkthrough-keys.json` | Plaintext index of all three keys. **Used for wallet imports in step 6** — you'll copy each signer's `privateKey` field into HashPack. |

```
✓ alice    302a300506032b6570032100…
✓ bob      302a300506032b657003210…
✓ carol    302a300506032b6570032100…
```

---

## Step 2: Create on-chain accounts for the signing keys

```bash
node 02-create-signer-accounts.js
```

This is the step that's specific to the dApp/HashPack walkthrough.
HashPack signs via a Hedera *account*, not a raw key — its
import-private-key flow derives the public key, queries the mirror
node for an account whose key matches, and binds the WalletConnect
session to that account. **The keys we just generated have no
matching accounts**, so the wallet would refuse to import them.

This script creates three on-chain Hedera accounts (one per signer)
with each signer's key as that account's account-key. ~1.65 ℏ total
from the operator (~0.55 each). The accounts exist solely for
WalletConnect identity — they do not pay ceremony fees, they're not
the multi-sig treasury, and they hold a 0.5 ℏ balance only to make
the wallet's mirror lookup more reliable.

Output:

```
✅ Signer accounts created on testnet:
   alice    0.0.8901234  https://hashscan.io/testnet/account/0.0.8901234
   bob      0.0.8901235  https://hashscan.io/testnet/account/0.0.8901235
   carol    0.0.8901236  https://hashscan.io/testnet/account/0.0.8901236
```

State written: `walkthrough-signer-accounts.json` (gitignored). Step 3
will cross-reference this so `walkthrough-state.json` ends up listing
each signer's pubkey + accountId in one place.

> **Idempotent.** Re-running this script when
> `walkthrough-signer-accounts.json` already exists is a no-op. Delete
> the file to force re-creation.
>
> **Production note.** Real treasuries have each signer create their
> own account on their own machine — the operator doesn't pre-create
> accounts on behalf of signers. We do it here for testnet
> convenience; for production, give each participant the
> `01-generate-keys.js` output for their slot only and have them
> create their own funded account.

---

## Step 3: Create the 2-of-3 threshold-key account

```bash
node 03-create-threshold-account.js
```

Wraps the three public keys in a `KeyList` with threshold = 2 and
creates a fresh Hedera account funded with 5 ℏ from the operator. This
account is the multi-sig treasury — the "From" address for the
transfer in step 5.

State written: `walkthrough-state.json` with `thresholdAccountId`,
threshold, and a `signers` array that pairs each name with its
publicKey **and** the on-chain accountId from step 2.

```
✅ Threshold account created: 0.0.7654321
   Threshold: 2 of 3
   Eligible signers: alice, bob, carol
   Initial balance: 5 ℏ
```

---

## Step 4: Start the coordinator with a public tunnel

The coordinator is the WebSocket server that holds session state.
Participants connect to it; **the dApp at
`testnet-multisig.lazysuperheroes.com` is a static UI that connects to
your coordinator** — Vercel does not host a coordinator process. So you
run the coordinator on your machine, and `--tunnel-provider ngrok` exposes it as
a public WSS URL the hosted dApp can reach.

In **terminal 1**, with the public keys from step 3:

```bash
npx hedera-multisig server \
  -t 2 \
  -k "$(node -p "require('./walkthrough-state.json').publicKeys.join(',')")" \
  --port 3001 \
  --tunnel-provider ngrok \
  --allowed-origins https://testnet-multisig.lazysuperheroes.com
```

The server prints:

- **Public WSS URL** — something like `wss://abc123.ngrok-free.app`. The
  dApp connects to this.
- **Session ID**, **PIN**, **coordinator token**, **HMSC connection
  string** (`hmsc:eyJz…`). Save these — you'll paste the connection
  string into the dApp in step 5.

> **About `--allowed-origins`.** The coordinator denies browser
> connections by default unless you explicitly list which origins may
> connect — otherwise any web page you visit could attempt to connect
> to your coordinator. We allow the hosted testnet dApp's origin and
> nothing else. CLI participants (terminal 3, below) don't send an
> `Origin` header and aren't affected by this flag.
>
> **Mainnet variant:** if you want to demo against
> [`multisig.lazysuperheroes.com`](https://multisig.lazysuperheroes.com)
> instead, set `HEDERA_NETWORK=mainnet` in `.env` and pass
> `--allowed-origins https://multisig.lazysuperheroes.com`. This
> walkthrough's scripts use whichever network is configured.

Leave terminal 1 running.

---

## Step 5: Connect as the coordinator and inject the transaction

1. Open [`testnet-multisig.lazysuperheroes.com/create`](https://testnet-multisig.lazysuperheroes.com/create)
   in your browser.
2. Paste the **HMSC connection string** (`hmsc:eyJz…`) from terminal 1
   into the connect form. The dApp reads server URL + session ID + PIN
   from the string. Provide the **coordinator token** when prompted.
3. The form switches to **Build & Inject**. Build a small HBAR transfer
   FROM your threshold account (the multi-sig treasury — see
   `walkthrough-state.json` for the ID) TO any recipient (e.g. your
   operator account):
   - **From:** `<thresholdAccountId>` from step 3
   - **To:** your operator ID (or any other testnet account)
   - **Amount:** `0.5` (or any positive value the threshold balance covers)
4. (Optional) Open the **Node freeze strategy** advanced panel — the
   default is a random subset of 6 nodes, which you'll see reflected in
   the size estimator. For 3 signers + 6-node freeze, expect ~3 KB —
   well under Hedera's 6 KB cap.
5. Click **Build & inject transaction**. The dApp freezes the
   transaction client-side, sends it to the coordinator over WSS, and
   the coordinator broadcasts it to participants. **A 120-second
   countdown starts now.**

---

## Step 6: Two participants sign — one via HashPack, one via CLI

This is the **point** of this walkthrough: a single multi-sig ceremony
satisfied by **mixed-mode signers**. Alice signs from her browser
through HashPack; Bob signs from a terminal via the CLI participant.
Both signatures hit the same coordinator over the same WSS tunnel and
land on the same transaction. The protocol doesn't care how a
participant got there — only that an eligible public key produced a
valid signature.

> **Why not both via the dApp?** Driving two HashPack sessions through
> WalletConnect inside the 120-second window is fiddly — wallet popups
> stack, mobile pairing flows time out, and one misclick burns the
> ceremony. The hybrid pattern is *more honest* about how a real team
> typically signs: one operator at their desk in a wallet, another on
> a CLI on a hardened signing machine. If you want to demo all-web,
> the all-HashPack variant is at the bottom — but do the hybrid first.

### 6a. Import alice's key into HashPack (one-time)

Open HashPack → **Settings** → **Add Account** → **Import existing
account** → **Private key**. Paste alice's key (and grab her account
ID from step 2's output for cross-reference):

```bash
node -p "require('./walkthrough-keys.json').keys.alice.privateKey"
# 302e020100300506032b657004220420…

node -p "require('./walkthrough-signer-accounts.json').accounts.alice.accountId"
# 0.0.8901234   ← what HashPack should bind to
```

HashPack will derive the public key, query the mirror node, and find
alice's signer account from step 2 (because that account's
`account-key` IS alice's public key). **Accept** the prompt to attach
that account, and label it `alice (multisig walkthrough)` so it's
obvious which one to pick during signing. The wallet is now bound to
alice's `0.0.X` account; HashPack uses it as the WalletConnect identity
when alice signs.

> **Why step 2 matters here.** Without an on-chain account whose key
> matches alice's, HashPack can't bind a WalletConnect session to
> alice — there's no `accountId` for the SDK to put on the
> transaction, so signing fails silently or the wallet refuses to
> import in the first place. Step 2 created that account; this step
> just connects the wallet to it.

> **Other wallets.** Blade (Settings → Import Account → Private Key)
> and Kabila work the same way. Any WalletConnect v2 + Hedera-capable
> wallet is fine. The dApp's
> [`docs/WALLETCONNECT.md`](../../docs/WALLETCONNECT.md) has the
> compatibility matrix. Instructions below use HashPack as the
> reference.

### 6b. Alice joins and signs from the dApp

Open [`testnet-multisig.lazysuperheroes.com/join`](https://testnet-multisig.lazysuperheroes.com/join)
in a **new browser tab** (or, more realistically, have alice open it
on her own laptop). Paste the HMSC connection string. The dApp opens
a WalletConnect modal; choose HashPack and select the **alice
(multisig walkthrough)** account.

The dApp:

1. Fetches the frozen transaction from the coordinator.
2. Decodes it locally and renders the verified details (From / To /
   amount / fee / 120s countdown).
3. Prompts alice to approve. On click, HashPack pops up showing the
   same details — alice signs there.
4. Submits alice's signature to the coordinator over WSS.

The coordinator's session monitor and the `/create` tab both reflect
**alice → signed**, `1 / 2 collected`. The 120s clock is still
ticking — keep moving.

### 6c. Bob joins and signs from the CLI

In **terminal 3**, run the CLI participant pointed at bob's encrypted
key file. Use the HMSC connection string from terminal 1's server
output (the same one you pasted into the dApp):

```bash
npx hedera-multisig participant \
  --connect "$(... HMSC string from terminal 1 ...)" \
  --label bob \
  --keyfile ./walkthrough-keys.bob.encrypted \
  --passphrase walkthrough-test
```

The CLI:

1. Connects over WSS to the same coordinator (no Origin header, so
   `--allowed-origins` doesn't apply to it).
2. Decrypts bob's key into memory (never written to disk decrypted,
   never sent over the wire).
3. Receives the in-flight transaction, prints the verified details
   the same way the dApp rendered them for alice.
4. Prompts you to type `YES` (all caps) to approve.

Type `YES`. The CLI signs against the multi-node bodyBytes, submits
the signature array, and the coordinator marks **bob → signed**.
Threshold met (2 of 3). The coordinator submits the fully-signed
transaction to Hedera, polls the mirror node, and the `/create` tab
shows **completed** with the final transaction ID.

> **Plaintext alternative for bob.** If you'd rather not deal with
> the encrypted-file flow:
> ```bash
> npx hedera-multisig participant \
>   --connect "..." --label bob \
>   -k "$(node -p "require('./walkthrough-keys.json').keys.bob.privateKey")"
> ```
> `-k` is marked DEPRECATED for production (visible in process lists +
> shell history), but it's a valid testnet path. The encrypted flow is
> the production-recommended pattern — see
> [`docs/ENCRYPTED_KEYS_GUIDE.md`](../../docs/ENCRYPTED_KEYS_GUIDE.md).

Carol does not need to sign — that's the point of 2-of-3.

---

## Step 7: Verify on the mirror node

```bash
node 06-verify-on-mirror.js TRANSACTION_ID_FROM_STEP_5
```

The mirror node confirms the transfer landed and shows the consensus
timestamp + fee + transfers list:

```
✅ Mirror confirmed:
   Result: SUCCESS
   Consensus: 1764452239.277675395
   Fee paid: 53872 tinybars
   Transfers (3):
     0.0.7654321  -50000000 tinybars  ← threshold account debited
     0.0.OPERATOR  +50000000 tinybars  ← recipient credited
     0.0.NODE        +53872 tinybars  ← node fee
```

That's the multi-sig ceremony: alice signed in a browser wallet, bob
signed at a terminal, the network accepted the two signatures against
the 2-of-3 KeyList, and the recipient received the HBAR. **No private
key ever left its origin** — alice's stayed in HashPack, bob's stayed
in the encrypted key file in memory. Only frozen transaction bytes and
signatures travelled the WebSocket.

---

## Architecture recap

```
Terminal 1                  Browser tab A             Browser tab B          HashPack          Terminal 3
(coordinator)               (coordinator UI)          (alice's signing UI)   (alice's keys)    (bob's CLI)
──────────                  ──────────────────        ──────────────────     ──────────────    ──────────
npx multisig server                                                          alice's privkey   bob's encrypted
  --tunnel-provider ngrok                                                                  ↑ stays here  keyfile
       ↓                                                                                            ↑ stays here
   wss://abc.ngrok        ←→ /create                                                              decrypt → memory
                              build + inject ↘                                                       ↑
                                              broadcast TRANSACTION_RECEIVED ↘                       ↓
                                                                    /join → decode → review        sign(bodyBytes)
                                                                       ↓                              ↓
                                                                    WalletConnect → HashPack         submit signature
                                                                       ↓                              ↓
                                                                    sign(bodyBytes)            wss://abc.ngrok
                                                                       ↓                              ↑
                                                                    submit signature            (same coordinator)
                                                                       ↓                              ↓
                                                                  wss://abc.ngrok ←──────────────────┘
                                                                       ↓
                                                                  threshold met → execute → mirror confirm
                                                                       ↓
                                                                  /create + Terminal 3 both show: completed
```

The hosted dApp is **a static client**. It runs in alice's browser. It
holds no session state, sees no private keys, and has no privileges
the protocol doesn't grant. The CLI participant is the same shape: it
holds bob's key in memory, signs locally, and submits the signature
over the same WebSocket. From the coordinator's view, it can't tell
which signer came from which transport.

---

## Variant: all-web (alice AND bob in HashPack)

If you want to demo two-WalletConnect signing — fair, it's the
"everyone has a wallet" path some real teams will follow — repeat
step 6a + 6b for bob:

```bash
node -p "require('./walkthrough-keys.json').keys.bob.privateKey"
```

Import bob's key into HashPack, label it `bob (multisig walkthrough)`,
open `/join` in **another fresh browser tab**, paste the connection
string, pick the bob account in the WalletConnect modal, approve in
HashPack.

Two practical notes from doing this:

- HashPack only signs with one account at a time. To switch from alice
  to bob between the two tabs, you'll need to either disconnect alice's
  WalletConnect session in HashPack first, or run bob's tab in a
  different browser profile / private window so HashPack treats it as
  a fresh client.
- **120 seconds is tight.** If you're driving both wallets yourself,
  practice the click sequence once before starting the timer (`/join`
  → WalletConnect modal → pick account → review tx → approve →
  HashPack popup → sign). The clock starts at inject; if you flub the
  pairing on the second wallet you'll watch it expire and have to
  re-inject.

The hybrid flow above (one wallet, one CLI) sidesteps both problems
and is the recommended demo path.

---

## Cleanup

The walkthrough leaves four on-chain accounts (the threshold + three
signer accounts) and a few local files:

```bash
# 1. Local files (gitignored — safe to leave, but delete to be tidy):
rm walkthrough-keys.* walkthrough-state.json walkthrough-signer-accounts.json

# 2. Stop the coordinator (Ctrl+C in terminal 1).

# 3. (Optional) Sweep the threshold account's remaining HBAR back to
#    the operator with one more multi-sig ceremony — same shape as
#    step 5, but transferring whatever balance remains. Or leave it;
#    testnet HBAR is free.

# 4. (Optional) The signer accounts (alice/bob/carol on-chain accounts
#    from step 2) hold ~0.5 ℏ each in unused balance. Testnet HBAR is
#    free so this is fine to leave — they'll get garbage-collected
#    eventually. To sweep deliberately, run an HBAR transfer from each
#    account using its single key (the corresponding signer's
#    plaintext key from walkthrough-keys.json). Not a multi-sig
#    ceremony — these accounts are single-key.

# 5. (Optional) Remove the imported alice key from HashPack:
#    HashPack → Settings → manage account → "alice (multisig walkthrough)" → Remove.
#    Bob's CLI key never entered any wallet — nothing to clean up there.
```

---

## Troubleshooting

**`testnet-multisig.lazysuperheroes.com` "Failed to connect to coordinator"** —
the dApp is HTTPS and the coordinator must be reachable over WSS. Verify
the URL in `/create` starts with `wss://`, not `ws://`. If you're using
`--tunnel-provider ngrok`, the server prints the WSS URL on startup — make sure
that's what you pasted.

**`ngrok failed (ERR_NGROK_107): … authtoken … is invalid`** — your
`NGROK_AUTH_TOKEN` was rejected by ngrok's server. Common causes: the
token was rotated, the team account it belonged to revoked your access,
or the credential was explicitly revoked. Get a fresh token at
https://dashboard.ngrok.com/get-started/your-authtoken and replace the
value in `.env`. (No separate `ngrok config add-authtoken` step needed —
the coordinator passes the token to the SDK directly.)

**`ngrok failed (ERR_NGROK_105): … does not look like a proper ngrok
authtoken`** — the value in `NGROK_AUTH_TOKEN` is malformed (truncated,
extra whitespace, accidentally wrapped in quotes). Re-copy from the
dashboard.

**`ngrok failed (ERR_NGROK_4018): tunnel session limit reached`** — the
free tier allows one active tunnel per account. Kill any other ngrok
sessions at https://dashboard.ngrok.com/agents and retry, or upgrade.

**`NGROK_AUTH_TOKEN environment variable is not set`** — your `.env`
doesn't have the token, or the CLI isn't loading the right `.env`. The
server prints `Loaded .env: <path>` in the startup banner; verify it's
the file that contains your `NGROK_AUTH_TOKEN`. Free token at
https://dashboard.ngrok.com/get-started/your-authtoken.

**Want to bypass the embedded tunnel entirely?** You can run a tunnel
yourself in another terminal and pass its URL via `--tunnel-url`:
```bash
# Terminal A
npx ngrok http 3001
# (copy the printed https URL)

# Terminal B
npx hedera-multisig server \
  -t 2 -k "$(node -p "require('./walkthrough-state.json').publicKeys.join(',')")" \
  --port 3001 --tunnel-url wss://<copied>.ngrok-free.app \
  --timeout 0 \
  --allowed-origins https://testnet-multisig.lazysuperheroes.com
```
This is the escape hatch for environments where the SDK can't open
outbound connections from inside Node (corporate proxy, etc.).

**`Rejected browser connection: no allowedOrigins configured`** in
the server log — you forgot `--allowed-origins
https://testnet-multisig.lazysuperheroes.com`. Restart the server with
the flag.

**HashPack popup never appears** — make sure HashPack is unlocked and
on testnet (top-right network toggle). Some wallets cache stale
WalletConnect sessions; disconnect from any prior session in the
wallet's connections panel and retry the `/join` flow.

**`Public key is not eligible to sign this transaction`** — the key
imported into HashPack doesn't match alice / bob / carol's public key
from `walkthrough-keys.json`. Re-import the correct key, or check the
public-key fingerprint in `/join` matches a row in `walkthrough-state.json`.

**Transaction expired (120-second window)** — this walkthrough adds
wallet UI hops on top of the CLI flow, so 120s is tight if you fumble
the WalletConnect pairing or stop to read prompts. If it expires, the
coordinator stays alive — click **"Build another transaction"** in the
`/create` tab and restart from step 5. The hybrid flow (one wallet,
one CLI) is much harder to time-out than the all-web variant. For
windows of hours-to-days instead of 120s, see `walkthrough-scheduled`
(coming next — async signing via HIP-423 long-window scheduled
transactions).

**CLI participant says `key is no longer eligible`** — bob's encrypted
key file's public key doesn't match an entry in `walkthrough-state.json`'s
`publicKeys` list. Most often this happens when you regenerate keys in
walkthrough-dapp without recreating the threshold account, or vice
versa. Run `node 01-generate-keys.js` and `node 02-create-threshold-account.js`
in sequence so the keyfile and the on-chain threshold key match.

---

## Coming next: `walkthrough-scheduled`

The 120s constraint is the dominant pain point above. **Scheduled
transactions** (HIP-423) relax it to up to 62 days — each signer signs
on their own time, the network executes when threshold is met. We're
shipping a `walkthrough-scheduled/` walkthrough that demonstrates the
async flow end-to-end. Same hosted-dApp signing path, no countdown,
cross-timezone friendly.
