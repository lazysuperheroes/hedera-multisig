#!/usr/bin/env node
/**
 * Walkthrough step 2 (dApp): create a 2-of-3 threshold-key account on testnet.
 *
 * Identical to `examples/walkthrough-hbar/02-create-threshold-account.js` —
 * duplicated here so this walkthrough is fully self-contained.
 *
 * Reads three public keys from walkthrough-keys.json (step 1), wraps them
 * in a `KeyList` with threshold = 2, and creates a new Hedera account
 * funded with 5 ℏ from the operator. Saves the new account ID and key
 * configuration to walkthrough-state.json so subsequent steps don't have
 * to ask.
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
const STATE_FILE = path.join(__dirname, 'walkthrough-state.json');
const INITIAL_BALANCE_HBAR = 5;
const THRESHOLD = 2;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Create 2-of-3 threshold account ━━━\n'));

  if (!fs.existsSync(KEYS_FILE)) {
    fail(`${KEYS_FILE} not found. Run: node 01-generate-keys.js`);
  }

  const keysData = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const signers = Object.entries(keysData.keys);
  if (signers.length !== 3) {
    fail(`Expected 3 keys in walkthrough-keys.json, found ${signers.length}`);
  }

  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );

  const publicKeys = signers.map(([_, k]) => PublicKey.fromString(k.publicKey));
  const thresholdKey = new KeyList(publicKeys, THRESHOLD);

  console.log(chalk.gray('Building 2-of-3 threshold key from:'));
  for (const [name, { publicKey }] of signers) {
    console.log(`  - ${name.padEnd(8)} ${publicKey.slice(0, 24)}…`);
  }

  console.log(chalk.gray(`\nSubmitting AccountCreateTransaction (initial balance: ${INITIAL_BALANCE_HBAR} ℏ)...`));
  const tx = new AccountCreateTransaction()
    .setKey(thresholdKey)
    .setInitialBalance(new Hbar(INITIAL_BALANCE_HBAR))
    .setAccountMemo('hedera-multisig walkthrough (dApp) — 2-of-3 threshold');

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);
  const newAccountId = receipt.accountId.toString();

  console.log(chalk.green(`\n✅ Threshold account created: ${chalk.bold(newAccountId)}`));
  console.log(`   Threshold: ${THRESHOLD} of ${publicKeys.length}`);
  console.log(`   Eligible keys: ${signers.map(([n]) => n).join(', ')}`);
  console.log(`   Initial balance: ${INITIAL_BALANCE_HBAR} ℏ`);
  console.log(`   View on HashScan: https://hashscan.io/${network}/account/${newAccountId}`);

  const state = {
    network,
    operatorId: process.env.OPERATOR_ID,
    thresholdAccountId: newAccountId,
    threshold: THRESHOLD,
    publicKeys: signers.map(([_, k]) => k.publicKey),
    signers: signers.map(([name, k]) => ({ name, publicKey: k.publicKey })),
    createdAt: new Date().toISOString(),
    transactionId: submit.transactionId.toString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(chalk.gray(`   State saved: ${STATE_FILE}`));

  console.log(chalk.bold.cyan('\nNext: start the coordinator server with --tunnel ngrok (see README step 3).\n'));
  console.log(chalk.gray('Quick start:'));
  console.log(chalk.gray(`  npx hedera-multisig server -t 2 -k "${state.publicKeys.join(',')}" \\`));
  console.log(chalk.gray(`    --port 3001 --tunnel ngrok \\`));
  console.log(chalk.gray(`    --allowed-origins https://testnet-multisig.lazysuperheroes.com\n`));

  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
