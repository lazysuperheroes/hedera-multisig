#!/usr/bin/env node
/**
 * Walkthrough step 1 (contract): create the demo EOA account.
 *
 * The contract walkthrough's narrative arc is:
 *   start as a single-key (EOA) account → deploy + interact → convert to
 *   2-of-3 multi-sig → prove the EOA can no longer act → multi-sig
 *   ceremonies replace the EOA's old powers.
 *
 * This script creates a fresh Hedera account whose key is `alice`'s single
 * Ed25519 key. The operator funds it with 40 ℏ — sized to comfortably
 * cover the entire downstream walkthrough:
 *
 *   - 02-deploy-as-eoa.js: ContractCreateFlow (FileCreate + FileAppend +
 *     ContractCreate with 800k gas). Observed cost: ~13 ℏ on a busy
 *     testnet day; this is by far the dominant expense.
 *   - 03-fund-contract.js: 2 ℏ moved demo → contract.
 *   - 04 / 07 / 08 multi-sig ceremonies: small per-tx fees (~0.05 ℏ each).
 *
 * Earlier versions used 8 ℏ (~9 ℏ short on a real run) and 20 ℏ (only
 * 7 ℏ headroom after the deploy). 40 ℏ gives the demo account plenty
 * of room to absorb pricing volatility without forcing a manual top-up
 * mid-walkthrough, and still costs the operator nothing real (testnet).
 *
 * Saves demo-account-state.json so subsequent steps can pick up the new
 * account ID.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, PublicKey,
  AccountCreateTransaction, Hbar,
} = require('@hashgraph/sdk');
const chalk = require('chalk');

const KEYS_FILE = path.resolve(__dirname, 'walkthrough-keys.json');
const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const INITIAL_BALANCE_HBAR = 40;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Create demo EOA (single-sig with alice key) ━━━\n'));

  const keysData = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const aliceKey = keysData.keys.alice;
  if (!aliceKey) fail('No alice key found in walkthrough-keys.json. Run `node setup-keys.js`.');

  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );

  const alicePub = PublicKey.fromString(aliceKey.publicKey);
  console.log(chalk.gray(`Demo account key (alice): ${alicePub.toString().slice(0, 24)}…`));
  console.log(chalk.gray(`Initial balance: ${INITIAL_BALANCE_HBAR} ℏ (paid by operator)`));

  const tx = new AccountCreateTransaction()
    .setKey(alicePub) // Single key — this is the EOA stage
    .setInitialBalance(new Hbar(INITIAL_BALANCE_HBAR))
    .setAccountMemo('hedera-multisig walkthrough — demo EOA (will be converted to 2-of-3)');

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);
  const demoAccountId = receipt.accountId.toString();

  console.log(chalk.green(`\n✅ Demo EOA created: ${chalk.bold(demoAccountId)}`));
  console.log(`   Single-key (alice). This account currently has the same security as a personal wallet.`);
  console.log(`   View on HashScan: https://hashscan.io/${network}/account/${demoAccountId}`);

  const state = {
    network,
    demoAccountId,
    initialKey: 'alice',
    initialKeyPublic: aliceKey.publicKey,
    initialKeyPrivate: aliceKey.privateKey,
    convertedToMultisigAt: null, // populated by 05-convert-eoa-to-multisig.js
    contractId: null,            // populated by 02-deploy-as-eoa.js
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(chalk.gray(`   State: ${STATE_FILE}`));

  console.log(chalk.bold.cyan('\nNext: node 02-deploy-as-eoa.js\n'));
  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
