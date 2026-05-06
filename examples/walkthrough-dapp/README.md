# Walkthrough: coordinated signing via the public testnet dApp

> **What you'll demonstrate:** an end-to-end 2-of-3 multi-sig HBAR
> transfer using the publicly hosted dApp at
> [`testnet-multisig.lazysuperheroes.com`](https://testnet-multisig.lazysuperheroes.com)
> — the coordinator runs locally with a public tunnel, and participants
> sign via HashPack (or any other WalletConnect-compatible Hedera
> wallet) in their own browser. No local dApp install required.

This walkthrough is the "real-deployment" companion to
[`../walkthrough-hbar/`](../walkthrough-hbar/). Same protocol, same keys,
same verification — what changes is **where the participants sign**:

| | `walkthrough-hbar` | `walkthrough-dapp` (this) |
|---|---|---|
| Coordinator | local CLI server | local CLI server **with `--tunnel ngrok`** |
| dApp instance | local `npm run dev` on `localhost:3000` | hosted `testnet-multisig.lazysuperheroes.com` |
| Coordinator transport | `ws://localhost:3001` | `wss://*.ngrok.io` (public, auto-issued) |
| Participant signing | both via CLI | **mixed: alice in HashPack (web), bob via CLI** |
| Wallet setup | none (encrypted key file) | import alice's key into HashPack once |

Two things are intentional here that don't appear in the HBAR
walkthrough:

1. **HTTPS dApp ⇒ WSS coordinator.** The hosted dApp at `testnet-multisig.lazysuperheroes.com`
   runs in your browser over HTTPS, which means it can only connect to
   a coordinator over WSS. The simplest way to get a WSS URL on a local
   dev machine is `--tunnel ngrok` — this is the gotcha that an
   "alternative subsection" inside `walkthrough-hbar` would have hidden.
2. **Hybrid signing — one wallet, one CLI.** Driving two HashPack
   sessions through WalletConnect inside the 120-second window is
   fiddly and frustrating. The realistic team pattern is one signer in
   a wallet, one on a CLI. This walkthrough shows both modes
   completing the same ceremony — they're protocol-equivalent.

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
3. **An ngrok auth token** — free tier is fine. Sign up at
   [`ngrok.com`](https://ngrok.com), copy the token from your dashboard,
   and either run `ngrok config add-authtoken <token>` once, or export
   `NGROK_AUTH_TOKEN=<token>` so the coordinator picks it up.
4. **HashPack browser extension** installed
   ([`hashpack.app`](https://www.hashpack.app)) and configured for
   testnet. Any WalletConnect-compatible Hedera wallet (Blade, Kabila,
   etc.) works the same way — instructions below use HashPack as the
   reference; substitute your wallet's "import private key" flow if
   you prefer something else.

> **Already ran `walkthrough-hbar`?** You can copy both the keys **and the
> threshold account** across — that lets you skip steps 1 and 2 entirely
> and jump straight to starting the coordinator (step 3):
> ```bash
> cp ../walkthrough-hbar/walkthrough-keys.* .
> cp ../walkthrough-hbar/walkthrough-state.json .
> ```
> The state file records `thresholdAccountId`, threshold, and public keys —
> everything step 3's `--keys` flag and step 4's "From" field need. Either
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
| `walkthrough-keys.json` | Plaintext index of all three keys. **Used for wallet imports in step 4** — you'll copy each signer's `privateKey` field into HashPack. |

```
✓ alice    302a300506032b6570032100…
✓ bob      302a300506032b657003210…
✓ carol    302a300506032b6570032100…
```

---

## Step 2: Create a 2-of-3 threshold-key account

```bash
node 02-create-threshold-account.js
```

Wraps the three public keys in a `KeyList` with threshold = 2 and
creates a fresh Hedera account funded with 5 ℏ from the operator. This
account is the multi-sig treasury — the "From" address for the transfer
in step 4.

State written: `walkthrough-state.json` with `thresholdAccountId`,
threshold, public keys, signer labels.

```
✅ Threshold account created: 0.0.7654321
   Threshold: 2 of 3
   Eligible keys: alice, bob, carol
   Initial balance: 5 ℏ
```

---

## Step 3: Start the coordinator with a public tunnel

The coordinator is the WebSocket server that holds session state.
Participants connect to it; **the dApp at
`testnet-multisig.lazysuperheroes.com` is a static UI that connects to
your coordinator** — Vercel does not host a coordinator process. So you
run the coordinator on your machine, and `--tunnel ngrok` exposes it as
a public WSS URL the hosted dApp can reach.

In **terminal 1**, with the public keys from step 2:

```bash
npx hedera-multisig server \
  -t 2 \
  -k "$(node -p "require('./walkthrough-state.json').publicKeys.join(',')")" \
  --port 3001 \
  --tunnel ngrok \
  --allowed-origins https://testnet-multisig.lazysuperheroes.com
```

The server prints:

- **Public WSS URL** — something like `wss://abc123.ngrok-free.app`. The
  dApp connects to this.
- **Session ID**, **PIN**, **coordinator token**, **HMSC connection
  string** (`hmsc:eyJz…`). Save these — you'll paste the connection
  string into the dApp in step 4.

> **About `--allowed-origins`.** The coordinator denies browser
> connections by default unless you list which origins may connect —
> otherwise any web page you visit could attempt to connect. We allow
> the public testnet dApp; `localhost:3000` is unnecessary because we
> aren't running the dApp locally. CLI participants don't send an
> `Origin` header and aren't affected.
>
> **Mainnet variant:** if you want to demo against
> [`multisig.lazysuperheroes.com`](https://multisig.lazysuperheroes.com)
> instead, set `HEDERA_NETWORK=mainnet` in `.env` and pass
> `--allowed-origins https://multisig.lazysuperheroes.com`. This
> walkthrough's scripts use whichever network is configured.

Leave terminal 1 running.

---

## Step 4: Connect as the coordinator and inject the transaction

1. Open [`testnet-multisig.lazysuperheroes.com/create`](https://testnet-multisig.lazysuperheroes.com/create)
   in your browser.
2. Paste the **HMSC connection string** (`hmsc:eyJz…`) from terminal 1
   into the connect form. The dApp reads server URL + session ID + PIN
   from the string. Provide the **coordinator token** when prompted.
3. The form switches to **Build & Inject**. Build a small HBAR transfer
   FROM your threshold account (the multi-sig treasury — see
   `walkthrough-state.json` for the ID) TO any recipient (e.g. your
   operator account):
   - **From:** `<thresholdAccountId>` from step 2
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

## Step 5: Two participants sign — one via HashPack, one via CLI

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

### 5a. Import alice's key into HashPack (one-time)

Open HashPack → **Settings** → **Add Account** → **Import existing
account** → **Private key**. Paste alice's key:

```bash
node -p "require('./walkthrough-keys.json').keys.alice.privateKey"
# 302e020100300506032b657004220420…
```

HashPack will derive the public key, query the mirror node, and offer
to attach the threshold account if it can find an account with a
matching key. Decline that prompt — we just need the key in the wallet
so it's available to sign with. **Label it `alice (multisig
walkthrough)`** so it's obvious which one to pick later.

> **Other wallets.** Blade (Settings → Import Account → Private Key)
> and Kabila work the same way. Any WalletConnect v2 + Hedera-capable
> wallet is fine. The dApp's
> [`docs/WALLETCONNECT.md`](../../docs/WALLETCONNECT.md) has the
> compatibility matrix. Instructions below use HashPack as the
> reference.

### 5b. Alice joins and signs from the dApp

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

### 5c. Bob joins and signs from the CLI

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

## Step 6: Verify on the mirror node

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
  --tunnel ngrok                                                                  ↑ stays here  keyfile
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
step 5a + 5b for bob:

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

The walkthrough leaves three local artifacts and one on-chain account:

```bash
# 1. Local files (gitignored — safe to leave, but delete to be tidy):
rm walkthrough-keys.* walkthrough-state.json

# 2. Stop the coordinator (Ctrl+C in terminal 1).

# 3. (Optional) Sweep the threshold account's remaining HBAR back to
#    the operator with one more multi-sig ceremony — same shape as
#    step 4, but transferring whatever balance remains. Or leave it;
#    testnet HBAR is free.

# 4. (Optional) Remove the imported alice key from HashPack:
#    HashPack → Settings → manage account → "alice (multisig walkthrough)" → Remove.
#    Bob's CLI key never entered any wallet — nothing to clean up there.
```

---

## Troubleshooting

**`testnet-multisig.lazysuperheroes.com` "Failed to connect to coordinator"** —
the dApp is HTTPS and the coordinator must be reachable over WSS. Verify
the URL in `/create` starts with `wss://`, not `ws://`. If you're using
`--tunnel ngrok`, the server prints the WSS URL on startup — make sure
that's what you pasted.

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
`/create` tab and restart from step 4. The hybrid flow (one wallet,
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
