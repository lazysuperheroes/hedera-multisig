#!/usr/bin/env node
/**
 * Walkthrough step 3 (agent): create the 2-of-2 threshold-key account.
 *
 * Reads the two public keys from `walkthrough-keys.json` (step 1) —
 * alice and the agent — and wraps them in a `KeyList` with
 * threshold = 2. The resulting account is the multi-sig treasury;
 * any transfer FROM it requires both alice's signature AND the
 * agent's signature.
 *
 * The agent's signature is automated, gated by a PolicyEngine. So in
 * practice the threshold becomes "alice approves AND the policy
 * approves". Either party can refuse to sign and the ceremony
 * aborts. That's the whole point of agent-based co-signing.
 *
 * Step 2 created on-chain Hedera accounts for alice + agent. Those
 * are independent of the threshold account and exist so wallet
 * tooling can resolve "this key belongs to that account". The
 * threshold account uses the SAME public keys as its `KeyList`
 * members.
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
  console.log(chalk.bold.cyan(`\n━━━ Create ${THRESHOLD}-of-2 threshold account (alice + agent) ━━━\n`));

  if (!fs.existsSync(KEYS_FILE)) {
    fail(`${KEYS_FILE} not found. Run: node 01-generate-keys.js`);
  }

  const keysData = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const signers = Object.entries(keysData.keys);
  if (signers.length !== 2) {
    fail(`Expected 2 keys in walkthrough-keys.json (alice + agent), found ${signers.length}`);
  }

  // Optional: read per-signer Hedera account IDs from step 2. The
  // threshold KeyList only needs public keys, but stamping the
  // accountIds into state makes the README's "alice signs in HashPack
  // via 0.0.X" references unambiguous.
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

  console.log(chalk.gray(`Building ${THRESHOLD}-of-${publicKeys.length} threshold key from:`));
  for (const [name, { publicKey }] of signers) {
    const acct = signerAccounts && signerAccounts[name]?.accountId;
    const acctNote = acct ? chalk.cyan(`  ← signer account ${acct}`) : '';
    console.log(`  - ${name.padEnd(8)} ${publicKey.slice(0, 24)}…${acctNote}`);
  }

  console.log(chalk.gray(`\nSubmitting AccountCreateTransaction (initial balance: ${INITIAL_BALANCE_HBAR} ℏ)...`));
  const tx = new AccountCreateTransaction()
    .setKey(thresholdKey)
    .setInitialBalance(new Hbar(INITIAL_BALANCE_HBAR))
    .setAccountMemo(`hedera-multisig walkthrough (agent) — ${THRESHOLD}-of-${publicKeys.length} threshold`);

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);
  const newAccountId = receipt.accountId.toString();

  console.log(chalk.green(`\n✅ Threshold account created: ${chalk.bold(newAccountId)}`));
  console.log(`   Threshold: ${THRESHOLD} of ${publicKeys.length}`);
  console.log(`   Eligible signers: ${signers.map(([n]) => n).join(', ')}`);
  console.log(`   Initial balance: ${INITIAL_BALANCE_HBAR} ℏ`);
  console.log(`   View on HashScan: https://hashscan.io/${network}/account/${newAccountId}`);

  const state = {
    network,
    operatorId: process.env.OPERATOR_ID,
    thresholdAccountId: newAccountId,
    threshold: THRESHOLD,
    publicKeys: signers.map(([_, k]) => k.publicKey),
    signers: signers.map(([name, k]) => ({
      name,
      publicKey: k.publicKey,
      // Cross-reference to step 2's per-signer Hedera account IDs.
      // Null until 02-create-signer-accounts.js has run.
      accountId: signerAccounts?.[name]?.accountId || null,
    })),
    createdAt: new Date().toISOString(),
    transactionId: submit.transactionId.toString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(chalk.gray(`   State saved: ${STATE_FILE}`));

  console.log(chalk.bold.cyan('\nNext: start the coordinator server (see README step 4).\n'));
  console.log(chalk.gray('Quick start (CLI-only, no tunnel — agent runs locally):'));
  console.log(chalk.gray(`  npx hedera-multisig server -t ${THRESHOLD} -k "${state.publicKeys.join(',')}" \\`));
  console.log(chalk.gray(`    --port 3001 --no-tunnel --timeout 0\n`));

  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
