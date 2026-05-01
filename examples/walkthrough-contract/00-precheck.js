#!/usr/bin/env node
/**
 * Walkthrough step 0 (contract): prerequisite check.
 *
 * The contract walkthrough builds on the HBAR walkthrough — it reuses the
 * three signing keys generated there (alice/bob/carol) for the multi-sig
 * stages. Verifies env, operator balance, and that the HBAR walkthrough
 * key file exists.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { Client, AccountId, PrivateKey, AccountBalanceQuery } = require('@hashgraph/sdk');
const chalk = require('chalk');

const HBAR_KEYS_FILE = path.resolve(__dirname, '..', 'walkthrough-hbar', 'walkthrough-keys.json');
const MIN_BALANCE_HBAR = 10; // need this for: demo account funding, contract deploy gas, contract balance, fees

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Walkthrough precheck (contract) ━━━\n'));

  for (const k of ['OPERATOR_ID', 'OPERATOR_KEY']) {
    if (!process.env[k]) fail(`Missing env var: ${k}. See examples/walkthrough-hbar/README.md prerequisites.`);
  }
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  console.log(chalk.green('✓'), `Env loaded — network: ${network}`);

  if (!fs.existsSync(HBAR_KEYS_FILE)) {
    fail(`HBAR walkthrough keys not found: ${HBAR_KEYS_FILE}\n` +
         `   Run the HBAR walkthrough first (examples/walkthrough-hbar/README.md) — at minimum step 1 to generate keys.`);
  }
  const keysData = JSON.parse(fs.readFileSync(HBAR_KEYS_FILE, 'utf8'));
  const signerCount = Object.keys(keysData.keys || {}).length;
  if (signerCount !== 3) fail(`Expected 3 keys in walkthrough-hbar/walkthrough-keys.json, found ${signerCount}`);
  console.log(chalk.green('✓'), `Found 3 signing keys: ${Object.keys(keysData.keys).join(', ')}`);

  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );
  const balance = await new AccountBalanceQuery().setAccountId(process.env.OPERATOR_ID).execute(client);
  const hbar = balance.hbars.toBigNumber().toNumber();
  console.log(chalk.green('✓'), `Operator: ${process.env.OPERATOR_ID} (${hbar.toFixed(2)} ℏ)`);
  if (hbar < MIN_BALANCE_HBAR) fail(`Operator needs ≥${MIN_BALANCE_HBAR} ℏ for the contract walkthrough. Refill at https://portal.hedera.com/`);

  // Compiled artifact
  const artifact = path.resolve(__dirname, 'Counter.json');
  if (!fs.existsSync(artifact)) fail(`Counter.json artifact missing. Recompile from Counter.sol.`);
  const c = JSON.parse(fs.readFileSync(artifact, 'utf8'));
  console.log(chalk.green('✓'), `Counter.json: ${c.bytecode.length / 2} bytes bytecode, ${c.abi.length} ABI entries`);

  console.log(chalk.bold.green('\n✅ Ready. Next: node 01-create-demo-eoa.js\n'));
  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
