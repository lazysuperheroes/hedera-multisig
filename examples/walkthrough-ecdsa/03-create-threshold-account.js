#!/usr/bin/env node
/**
 * Walkthrough step 3 (ECDSA): create the 2-of-3 threshold-key account
 * from three secp256k1 public keys.
 *
 * Identical to walkthrough-dapp's step 3 — `KeyList(publicKeys, threshold)`
 * is key-type agnostic. The mixed-type scenario (Ed25519 + ECDSA in the
 * same KeyList) is also supported by Hedera, but this walkthrough keeps
 * all three signers ECDSA so we can validate end-to-end.
 *
 * What gets validated downstream:
 *   - Signature collection wraps each ECDSA signature alongside the
 *     pubkey for KeyList membership lookup
 *   - Server-side cryptographic verification handles secp256k1 the
 *     same as Ed25519 (different curves, same `Transaction.addSignature`
 *     contract)
 *   - HashPack signs ECDSA-key-bound accounts via WalletConnect,
 *     emitting valid signatures against the multi-node bodyBytes
 *   - Mirror node confirms execution — the consensus layer accepts
 *     the threshold-met set of ECDSA sigs against the KeyList exactly
 *     as it would Ed25519
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, PublicKey,
  AccountCreateTransaction, KeyList, Hbar,
} = require('@hashgraph/sdk');
const chalk = require('chalk');

const KEYS_FILE = path.join(__dirname, 'walkthrough-keys.json');
const SIGNER_ACCOUNTS_FILE = path.join(__dirname, 'walkthrough-signer-accounts.json');
const STATE_FILE = path.join(__dirname, 'walkthrough-state.json');
const INITIAL_BALANCE_HBAR = 5;
const THRESHOLD = 2;

async function main() {
  console.log(chalk.bold.cyan(`\n━━━ Create ${THRESHOLD}-of-3 ECDSA threshold account ━━━\n`));

  if (!fs.existsSync(KEYS_FILE)) {
    fail(`${KEYS_FILE} not found. Run: node 01-generate-keys.js`);
  }

  const keysData = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const signers = Object.entries(keysData.keys);
  if (signers.length !== 3) {
    fail(`Expected 3 keys in walkthrough-keys.json, found ${signers.length}`);
  }

  let signerAccounts = null;
  if (fs.existsSync(SIGNER_ACCOUNTS_FILE)) {
    try {
      signerAccounts = JSON.parse(fs.readFileSync(SIGNER_ACCOUNTS_FILE, 'utf8')).accounts || null;
    } catch {
      signerAccounts = null;
    }
  }
  if (!signerAccounts) {
    console.log(chalk.yellow(
      '⚠  walkthrough-signer-accounts.json not found.\n' +
      '   The threshold account will still be created, but HashPack signing\n' +
      '   in step 5 needs on-chain accounts for the signing keys. Run\n' +
      '   `node 02-create-signer-accounts.js` first.\n'
    ));
  }

  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );

  const publicKeys = signers.map(([_, k]) => PublicKey.fromString(k.publicKey));
  const thresholdKey = new KeyList(publicKeys, THRESHOLD);

  console.log(chalk.gray(`Building ${THRESHOLD}-of-3 ECDSA threshold key from:`));
  for (const [name, { publicKey }] of signers) {
    const acct = signerAccounts && signerAccounts[name]?.accountId;
    const acctNote = acct ? chalk.cyan(`  ← signer account ${acct}`) : '';
    console.log(`  - ${name.padEnd(8)} ${publicKey.slice(0, 28)}…${acctNote}`);
  }

  console.log(chalk.gray(`\nSubmitting AccountCreateTransaction (initial balance: ${INITIAL_BALANCE_HBAR} ℏ)...`));
  const tx = new AccountCreateTransaction()
    .setKey(thresholdKey)
    .setInitialBalance(new Hbar(INITIAL_BALANCE_HBAR))
    .setAccountMemo(`hedera-multisig walkthrough-ecdsa — ${THRESHOLD}-of-3 threshold (secp256k1)`);

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);
  const newAccountId = receipt.accountId.toString();

  console.log(chalk.green(`\n✅ ECDSA threshold account created: ${chalk.bold(newAccountId)}`));
  console.log(`   Threshold: ${THRESHOLD} of ${publicKeys.length} (all secp256k1)`);
  console.log(`   Eligible signers: ${signers.map(([n]) => n).join(', ')}`);
  console.log(`   Initial balance: ${INITIAL_BALANCE_HBAR} ℏ`);
  console.log(`   View on HashScan: https://hashscan.io/${network}/account/${newAccountId}`);

  const state = {
    network,
    operatorId: process.env.OPERATOR_ID,
    keyType: 'ECDSA_SECP256K1',
    thresholdAccountId: newAccountId,
    threshold: THRESHOLD,
    publicKeys: signers.map(([_, k]) => k.publicKey),
    signers: signers.map(([name, k]) => ({
      name,
      publicKey: k.publicKey,
      evmAddress: k.evmAddress || null,
      accountId: signerAccounts?.[name]?.accountId || null,
    })),
    createdAt: new Date().toISOString(),
    transactionId: submit.transactionId.toString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(chalk.gray(`   State saved: ${STATE_FILE}`));

  console.log(chalk.bold.cyan('\nNext: start the coordinator server with --tunnel-provider ngrok (see README step 4).\n'));
  console.log(chalk.gray('Quick start:'));
  console.log(chalk.gray(`  npx hedera-multisig server -t ${THRESHOLD} -k "${state.publicKeys.join(',')}" \\`));
  console.log(chalk.gray(`    --port 3001 --tunnel-provider ngrok --timeout 0 \\`));
  console.log(chalk.gray(`    --allowed-origins https://testnet-multisig.lazysuperheroes.com\n`));

  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
