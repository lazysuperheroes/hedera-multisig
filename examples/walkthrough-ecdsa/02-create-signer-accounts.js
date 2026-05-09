#!/usr/bin/env node
/**
 * Walkthrough step 2 (ECDSA): create on-chain Hedera accounts for the
 * secp256k1 signing keys generated in step 1.
 *
 * Identical in behaviour to walkthrough-dapp's step 2 — `setKey()` on
 * AccountCreateTransaction accepts both Ed25519 and ECDSA public keys
 * transparently, and HashPack / Blade / Kabila bind WalletConnect
 * sessions the same way regardless of key type.
 *
 * One thing worth noting for ECDSA specifically: Hedera supports HIP-32
 * auto-account-creation when HBAR or tokens are sent to an "alias" (the
 * EVM-style address derived from the secp256k1 pubkey). We *don't* use
 * that path here, because:
 *   1. HashPack's import-private-key flow needs an explicit accountId
 *      on the wallet's mirror lookup. Auto-created alias accounts
 *      eventually appear in the mirror, but the timing is racy and the
 *      walkthrough should be deterministic.
 *   2. AccountCreateTransaction with `.setKey(ecdsaPublicKey)` produces
 *      an account whose `evm_address` field on the mirror matches the
 *      key's derived EVM address anyway, so we get the EVM-friendly
 *      properties without depending on HIP-32 timing.
 *
 * Cost: ~0.55 ℏ per account, ~1.65 ℏ total. Idempotent.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, PublicKey,
  AccountCreateTransaction, Hbar,
} = require('@hashgraph/sdk');
const chalk = require('chalk');
const MirrorNodeClient = require('../../shared/mirror-node-client');

const KEYS_FILE = path.join(__dirname, 'walkthrough-keys.json');
const SIGNER_ACCOUNTS_FILE = path.join(__dirname, 'walkthrough-signer-accounts.json');
const PER_SIGNER_BALANCE_HBAR = 0.5;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Create Hedera accounts for ECDSA signing keys ━━━\n'));

  if (!fs.existsSync(KEYS_FILE)) {
    fail(`${KEYS_FILE} not found. Run: node 01-generate-keys.js`);
  }

  const keysData = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const signers = Object.entries(keysData.keys);
  if (signers.length !== 3) {
    fail(`Expected 3 keys in walkthrough-keys.json, found ${signers.length}`);
  }

  for (const k of ['OPERATOR_ID', 'OPERATOR_KEY']) {
    if (!process.env[k]) fail(`Missing env var: ${k}.`);
  }

  if (fs.existsSync(SIGNER_ACCOUNTS_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(SIGNER_ACCOUNTS_FILE, 'utf8'));
      const allCreated = signers.every(([name]) => existing.accounts?.[name]?.accountId);
      if (allCreated) {
        console.log(chalk.yellow('⚠  Signer accounts already exist — skipping creation:'));
        for (const [name, acc] of Object.entries(existing.accounts)) {
          console.log(chalk.gray(`     ${name.padEnd(8)} ${acc.accountId}`));
        }
        console.log(chalk.gray('\n   Delete walkthrough-signer-accounts.json to re-create.\n'));
        console.log(chalk.bold.cyan('Next: node 03-create-threshold-account.js\n'));
        process.exit(0);
      }
    } catch {
      // Corrupt file — proceed with creation.
    }
  }

  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );

  // Mirror client used to fetch authoritative `evm_address` after
  // account creation. Locally deriving via `pubkey.toEvmAddress()`
  // happens to match for "we just created with setKey(ecdsaPubkey)"
  // but the canonical answer for an existing account is what the
  // mirror reports — that handles aliased accounts, key rotations,
  // and any future Hedera mechanics we don't yet anticipate.
  const mirror = new MirrorNodeClient(network);

  const accounts = {};
  for (const [name, { publicKey }] of signers) {
    const pub = PublicKey.fromString(publicKey);
    console.log(chalk.gray(`Creating account for ${name} (ECDSA pub: ${publicKey.slice(0, 28)}…)...`));
    const tx = new AccountCreateTransaction()
      .setKey(pub)
      .setInitialBalance(new Hbar(PER_SIGNER_BALANCE_HBAR))
      .setAccountMemo(`hedera-multisig walkthrough-ecdsa — signer account for ${name}`);
    const submit = await tx.execute(client);
    const receipt = await submit.getReceipt(client);
    const accountId = receipt.accountId.toString();

    // Fetch the mirror's `evm_address` for this freshly-created account.
    // The MirrorNodeClient's `_fetch` retries with backoff so brief
    // mirror-indexing lag is absorbed transparently. If the mirror is
    // genuinely unreachable, the helper falls back to long-zero — which
    // is wrong for ECDSA accounts, so we surface a warning rather than
    // silently writing the bad value.
    let evmAddress = null;
    try {
      evmAddress = await mirror.accountToEvmAddress(accountId);
      // Long-zero detection: if the mirror lookup actually fell back,
      // the address ends with the account number packed into the last
      // 9-12 hex chars and the leading bytes are zero. ECDSA accounts
      // never produce that pattern.
      if (/^0x0{20,}/.test(evmAddress)) {
        console.log(chalk.yellow(
          `  ⚠  Mirror lookup for ${name} fell back to long-zero (${evmAddress}).`
        ));
        console.log(chalk.yellow(
          `     This is wrong for an ECDSA account — mirror is likely indexing.`
        ));
        console.log(chalk.yellow(
          `     Re-run \`node 02-create-signer-accounts.js\` (it's idempotent — won't double-create) once mirror has caught up.`
        ));
        evmAddress = null;
      }
    } catch (err) {
      console.log(chalk.yellow(
        `  ⚠  Mirror EVM-address lookup failed for ${name}: ${err.message}`
      ));
    }

    accounts[name] = { accountId, publicKey, evmAddress };
    const evmLabel = evmAddress ? chalk.gray(`(EVM ${evmAddress})`) : chalk.yellow('(EVM not yet indexed)');
    console.log(chalk.green(`  ✅ ${name.padEnd(8)} ${accountId}`), evmLabel);
  }

  const out = {
    network,
    keyType: 'ECDSA_SECP256K1',
    note: 'Per-signer Hedera accounts (ECDSA-keyed). Each account uses the matching secp256k1 key from walkthrough-keys.json as its account-key. The 2-of-3 threshold account (created by 03-create-threshold-account.js) is the multi-sig treasury — these signer accounts exist solely as WalletConnect identities.',
    perSignerBalanceHbar: PER_SIGNER_BALANCE_HBAR,
    createdAt: new Date().toISOString(),
    accounts,
  };
  fs.writeFileSync(SIGNER_ACCOUNTS_FILE, JSON.stringify(out, null, 2));

  console.log(chalk.bold.green('\n✅ ECDSA signer accounts created on testnet:'));
  for (const [name, { accountId, evmAddress }] of Object.entries(accounts)) {
    console.log(`   ${name.padEnd(8)} ${accountId}`);
    console.log(`             https://hashscan.io/${network}/account/${accountId}`);
    if (evmAddress) {
      console.log(chalk.gray(`             EVM address: ${evmAddress}  (from mirror /api/v1/accounts/${accountId}.evm_address)`));
    } else {
      console.log(chalk.yellow(`             EVM address: pending mirror indexing — re-run this script to refresh`));
    }
  }
  console.log(chalk.gray(`\n   State saved: ${SIGNER_ACCOUNTS_FILE}`));
  console.log(chalk.gray('   You can now import alice/bob/carol private keys into HashPack —'));
  console.log(chalk.gray('   the wallet will detect the secp256k1 key type and find the matching'));
  console.log(chalk.gray('   accounts via mirror-node lookup (same flow we just used to fetch'));
  console.log(chalk.gray('   the canonical evm_address values above).'));

  console.log(chalk.bold.cyan('\nNext: node 03-create-threshold-account.js\n'));

  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
