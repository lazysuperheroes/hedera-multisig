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

  const accounts = {};
  for (const [name, { publicKey, evmAddress }] of signers) {
    const pub = PublicKey.fromString(publicKey);
    console.log(chalk.gray(`Creating account for ${name} (ECDSA pub: ${publicKey.slice(0, 28)}…)...`));
    const tx = new AccountCreateTransaction()
      .setKey(pub)
      .setInitialBalance(new Hbar(PER_SIGNER_BALANCE_HBAR))
      .setAccountMemo(`hedera-multisig walkthrough-ecdsa — signer account for ${name}`);
    const submit = await tx.execute(client);
    const receipt = await submit.getReceipt(client);
    const accountId = receipt.accountId.toString();
    accounts[name] = { accountId, publicKey, evmAddress };
    console.log(chalk.green(`  ✅ ${name.padEnd(8)} ${accountId}`),
      chalk.gray(`(EVM ${evmAddress})`));
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
    console.log(chalk.gray(`             EVM address: ${evmAddress}`));
  }
  console.log(chalk.gray(`\n   State saved: ${SIGNER_ACCOUNTS_FILE}`));
  console.log(chalk.gray('   You can now import alice/bob/carol private keys into HashPack —'));
  console.log(chalk.gray('   the wallet will detect the secp256k1 key type and find the matching'));
  console.log(chalk.gray('   accounts via mirror-node lookup.'));

  console.log(chalk.bold.cyan('\nNext: node 03-create-threshold-account.js\n'));

  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
