# Encrypted key files: patterns and recipes

This guide is the canonical reference for **`EncryptedFileProvider`** —
how to create, load, rotate, and use encrypted private-key files with
this library, both as a CLI consumer and as a programmatic library
consumer.

If you ran the walkthroughs and want to know "what is this
`*.encrypted` file and how do I make my own?" — start here.

## Table of contents

1. [What an encrypted key file is](#what-an-encrypted-key-file-is)
2. [Creating one](#creating-one)
3. [Loading one (CLI)](#loading-one-cli)
4. [Loading one (library)](#loading-one-library)
5. [Multiple keys per file](#multiple-keys-per-file)
6. [Rotating a passphrase](#rotating-a-passphrase)
7. [Recipes](#recipes)
8. [Failure modes](#failure-modes)
9. [What this format is **not**](#what-this-format-is-not)

---

## What an encrypted key file is

A JSON file that stores one or more Hedera private keys, encrypted at
rest with a passphrase. Format:

```json
{
  "version": "1.0",
  "algorithm": "aes-256-gcm",
  "kdf": "pbkdf2",
  "kdfParams": {
    "iterations": 100000,
    "salt": "<hex>",
    "digest": "sha256"
  },
  "iv": "<hex>",
  "authTag": "<hex>",
  "encrypted": "<hex of ciphertext>",
  "metadata": {
    "created": "2026-05-01T...",
    "keyCount": 1,
    "description": "..."
  }
}
```

Properties:

- **AES-256-GCM authenticated encryption.** The `authTag` makes
  tampering detectable — corrupt the ciphertext and decryption fails
  loudly.
- **PBKDF2 key derivation.** 100,000 iterations (current floor for
  reasonable safety; not Argon2 — see [What this format is **not**](#what-this-format-is-not)).
- **Random salt and IV per file.** Identical key material under the
  same passphrase produces different ciphertext.
- **Restricted file permissions on Unix.** `chmod 600` is set
  automatically on creation (Windows: no equivalent set; rely on
  per-user filesystem ACLs).

The provider class lives at `keyManagement/EncryptedFileProvider.js`.

## Creating one

### Programmatic

```js
const EncryptedFileProvider = require('@lazysuperheroes/hedera-multisig/keyManagement/EncryptedFileProvider');
const { PrivateKey } = require('@hashgraph/sdk');

const priv = PrivateKey.generateED25519();

EncryptedFileProvider.createEncryptedFile(
  [priv.toString()],                // array of one or more private keys
  'your-strong-passphrase-here',    // ≥12 chars (enforced)
  './alice.encrypted',              // output path
  { description: 'Alice signing key' }  // optional metadata
);
```

The static helper validates the keys before encrypting (`PrivateKey.fromString`
must succeed) and refuses passphrases shorter than 12 characters.

### Generate a strong passphrase

```js
const pass = EncryptedFileProvider.generatePassphrase(20);
// e.g. "Kf3@xq...20-chars-using-rejection-sampling"
```

`generatePassphrase` uses crypto-randomness with rejection sampling to
avoid modulo bias. **Save this somewhere safe** — losing it makes the
file unrecoverable.

### CLI

The bundled CLI doesn't have a one-shot "create encrypted file" command
in v2.1.0 (planned for v2.2). For now, use the programmatic helper or
write a small script — see [Recipes](#recipes) below.

## Loading one (CLI)

Every CLI command that needs a signing key accepts `--keyfile <path>`
and `--passphrase <pass>`. Examples:

```bash
# Join a signing session
npx hedera-multisig participant \
  --connect "hmsc:..." \
  --label alice \
  --keyfile ./alice.encrypted \
  --passphrase your-strong-passphrase-here

# Sign a scheduled transaction
npx hedera-multisig schedule sign \
  --schedule-id 0.0.12345 \
  --keyfile ./alice.encrypted \
  --passphrase your-strong-passphrase-here

# Sign offline / air-gapped
npx hedera-multisig sign \
  --transaction-file ./tx.b64 \
  --keyfile ./alice.encrypted \
  --passphrase your-strong-passphrase-here
```

If you omit `--passphrase`, you'll be prompted interactively (with no
echo). Useful for human ceremonies; not useful for automation.

> **`--passphrase` exposes the passphrase to your shell history and
> process list.** For automation, source it from a secrets manager
> (Vault, AWS Secrets Manager, GitHub Actions encrypted secrets) and
> pass via env: `HEDERA_MULTISIG_PASSPHRASE=$(...)` then read it inside
> a wrapper script. The CLI does not currently read a passphrase env
> var directly — that's a v2.2 enhancement.

## Loading one (library)

```js
const EncryptedFileProvider = require('@lazysuperheroes/hedera-multisig/keyManagement/EncryptedFileProvider');

// Pre-supplied passphrase (no prompt)
const provider = new EncryptedFileProvider('./alice.encrypted', {
  passphrase: process.env.MY_PASSPHRASE,
});
const keys = await provider.getKeys();
// keys is Array<PrivateKey> — Hedera SDK PrivateKey objects, ready to use

// Interactive prompt (testnet / one-off use)
const provider2 = new EncryptedFileProvider('./alice.encrypted');
// .getKeys() will prompt on stdin if passphrase wasn't supplied
const keys2 = await provider2.getKeys();
```

Returned `keys` is an array because the file can hold multiple keys
(see [Multiple keys per file](#multiple-keys-per-file)). For a
single-key file, use `keys[0]`.

### Use as a `KeyProvider`

`EncryptedFileProvider` extends the abstract `KeyProvider` interface,
so it plugs directly into orchestrator workflows:

```js
const { WorkflowOrchestrator } = require('@lazysuperheroes/hedera-multisig');

const result = await orchestrator.execute(transaction, {
  workflow: 'interactive',
  keyProviders: [
    new EncryptedFileProvider('./alice.encrypted', { passphrase: '...' }),
    new EncryptedFileProvider('./bob.encrypted',   { passphrase: '...' }),
  ],
  threshold: 2,
});
```

Or as the `--keyfile` source for the CLI participant flow you've
already seen in the walkthroughs.

### `KeyProvider.sign(txBytes)` opaque-signer interface

If you need to keep keys completely opaque (HSM, MPC, hardware wallet),
extend `KeyProvider` and implement `sign(transactionBytes)` directly
without exposing keys. `EncryptedFileProvider` is the file-backed
implementation; nothing about the interface assumes plaintext key
exposure.

## Multiple keys per file

The format supports multiple keys in one file:

```js
EncryptedFileProvider.createEncryptedFile(
  [
    aliceKey.toString(),
    bobKey.toString(),
    carolKey.toString(),
  ],
  'shared-passphrase',
  './team.encrypted',
  { description: 'Team multi-sig keys' }
);

// On load:
const keys = await provider.getKeys();  // Array of 3 PrivateKey objects
```

This is convenient for **single-operator multi-sig** (one person who
holds all the keys for a 3-of-5 treasury, e.g. for emergency recovery)
or for **walkthrough / demo setups** where one person creates all the
keys.

It is **not appropriate for production team multi-sig**, where the
whole point is that no single person holds all the keys. Each signer
should have their own encrypted file with their own passphrase, on
their own device.

## Rotating a passphrase

There is no in-place rotation today. To rotate:

```js
// 1. Decrypt with old passphrase
const oldProvider = new EncryptedFileProvider('./alice.encrypted', {
  passphrase: oldPassphrase,
});
const keys = await oldProvider.getKeys();
const keyStrings = keys.map(k => k.toString());

// 2. Re-encrypt with new passphrase
EncryptedFileProvider.createEncryptedFile(
  keyStrings,
  newPassphrase,
  './alice.encrypted.new',
);

// 3. Atomically replace
const fs = require('fs');
fs.renameSync('./alice.encrypted.new', './alice.encrypted');
```

If you have multiple keys per file and only want to rotate the
passphrase (not the keys), this is the only safe path.

## Recipes

### Recipe 1: bulk-create encrypted files for a team

```js
#!/usr/bin/env node
const { PrivateKey } = require('@hashgraph/sdk');
const EncryptedFileProvider = require('@lazysuperheroes/hedera-multisig/keyManagement/EncryptedFileProvider');

const team = ['alice', 'bob', 'carol'];
const passphrase = process.env.PASSPHRASE || EncryptedFileProvider.generatePassphrase(24);

console.log(`Passphrase (record this): ${passphrase}`);

for (const name of team) {
  const priv = PrivateKey.generateED25519();
  EncryptedFileProvider.createEncryptedFile(
    [priv.toString()],
    passphrase,
    `./team-${name}.encrypted`,
    { description: `Team key for ${name}` }
  );
  console.log(`${name}: ${priv.publicKey.toString()}`);
}
```

### Recipe 2: load a key in an agent's startup

```js
const EncryptedFileProvider = require('@lazysuperheroes/hedera-multisig/keyManagement/EncryptedFileProvider');
const { AgentSigningClient } = require('@lazysuperheroes/hedera-multisig/client');

async function startAgent() {
  // Pull passphrase from a secrets manager at startup
  const passphrase = await fetchFromVault('multisig/agent-passphrase');

  const provider = new EncryptedFileProvider('./agent.encrypted', { passphrase });
  const keys = await provider.getKeys();

  const agent = new AgentSigningClient({ keyProvider: provider, /* ... */ });
  await agent.connect(/* ... */);
}
```

The provider is loaded once at startup; subsequent `agent.sign()` calls
delegate to its `sign(transactionBytes)` method. **Plaintext key
material lives in process memory only between `getKeys()` and the next
GC.** If your threat model excludes process-memory dumps (most
operational threat models do), this is the canonical agent shape.

### Recipe 3: verify a passphrase without decrypting fully

```js
const ok = EncryptedFileProvider.verifyPassphrase('./alice.encrypted', candidate);
// true if candidate decrypts the file; false otherwise (without throwing)
```

Useful for "are you sure you want to use this old file?" prompts in
your own UI.

### Recipe 4: read metadata without the passphrase

```js
const meta = EncryptedFileProvider.getFileMetadata('./alice.encrypted');
// { version, algorithm, kdf, iterations, keyCount, created, description }
```

Lets you check "how many keys are in this file?" or "when was this
created?" without prompting for a passphrase.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Incorrect passphrase or corrupted file` | Wrong passphrase, **or** file was modified after encryption | Re-enter passphrase. If still failing, the file is corrupt — restore from backup. |
| `Passphrase must be at least 12 characters` | You passed a passphrase < 12 chars to `createEncryptedFile` | Use a longer passphrase. The 12-char minimum is enforced for security; don't try to bypass it. |
| `Encrypted key file not found: ...` | Path is wrong, or you forgot to run the create step | Check the path; `ls` the directory. |
| `Invalid encrypted file: missing version` (or other format errors) | Not a v1.0 encrypted file — could be a JSON file with the wrong shape | Recreate the file. If migrating from a different format, decrypt with the original tool first. |
| `Decrypted keys are invalid: ...` | Decryption succeeded but the contents aren't valid Hedera private keys (e.g., file was wrong type) | Recreate the file with valid `PrivateKey` strings. |
| Process appears to hang on load | Interactive passphrase prompt in a non-TTY environment | Pass `--passphrase` (CLI) or `{ passphrase, promptIfMissing: false }` (library). |

## What this format is **not**

- **Not a wallet.** It doesn't generate addresses, manage multiple
  accounts, or speak any wallet protocol. It's a glorified encrypted
  blob of `PrivateKey` strings.
- **Not Argon2 / scrypt.** PBKDF2-SHA256 with 100k iterations is the
  current implementation. Acceptable for offline-attack resistance on
  a strong passphrase; less resistant than memory-hard KDFs against a
  determined attacker with custom hardware. v2.x retains PBKDF2 for
  Node-stdlib compatibility; a future major may introduce Argon2 with
  a versioned format.
- **Not a key-management system.** No backup orchestration, no rotation
  workflows, no distributed key generation. For those, use a real KMS
  (Vault, AWS KMS, hardware HSM) and have your code load keys from
  there into a `KeyProvider` subclass.
- **Not appropriate for the highest-value mainnet treasuries.** For
  $1M+ accounts, hardware-wallet-backed signing or HSM-based
  signing is the appropriate posture. `EncryptedFileProvider` is the
  middle tier: better than `EnvKeyProvider` (env-var plaintext),
  weaker than HSM. Pick based on your threat model.

See [`docs/SECURITY_ARCHITECTURE.md`](SECURITY_ARCHITECTURE.md) for the
broader threat model.

---

## See also

- [`keyManagement/KeyProvider.js`](../keyManagement/KeyProvider.js) — abstract base class with `sign(txBytes)` interface
- [`keyManagement/EncryptedFileProvider.js`](../keyManagement/EncryptedFileProvider.js) — the file-backed implementation
- [`docs/THRESHOLD_GUIDE.md`](THRESHOLD_GUIDE.md) — choosing M-of-N
- [`docs/AGENT_INTEGRATION.md`](AGENT_INTEGRATION.md) — agent-signed automation, including key loading
- [`examples/walkthrough-hbar/01-generate-keys.js`](../examples/walkthrough-hbar/01-generate-keys.js) — minimal real example using `createEncryptedFile`
