#!/usr/bin/env node
/**
 * Walkthrough step 0 (contract): prerequisite check.
 *
 * The contract walkthrough is fully self-contained — it generates its
 * own three signing keys (alice/bob/carol) via `setup-keys.js`. This
 * precheck verifies env, operator balance, and that those keys exist.
 *
 * Reusing keys from the HBAR walkthrough? Copy them across:
 *   cp ../walkthrough-hbar/walkthrough-keys.* .
 * Otherwise run `node setup-keys.js` once before this precheck.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { Client, AccountId, PrivateKey, AccountBalanceQuery } = require('@hashgraph/sdk');
const chalk = require('chalk');

const KEYS_FILE = path.resolve(__dirname, 'walkthrough-keys.json');
// Operator pays:
//   - ~20 ℏ funding the demo account (01-create-demo-eoa.js — covers
//     downstream contract deploy gas + 2 ℏ contract funding + ceremony fees)
//   - ~0.5 ℏ for the AccountCreate itself
//   - ~0.5 ℏ for the AccountUpdate when converting EOA → multi-sig (05)
//   - small headroom for testnet gas-price spikes
// 25 ℏ minimum keeps the worst observed run safely above zero.
const MIN_BALANCE_HBAR = 25;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Walkthrough precheck (contract) ━━━\n'));

  for (const k of ['OPERATOR_ID', 'OPERATOR_KEY']) {
    if (!process.env[k]) fail(`Missing env var: ${k}. See README.md prerequisites.`);
  }
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  console.log(chalk.green('✓'), `Env loaded — network: ${network}`);

  if (!fs.existsSync(KEYS_FILE)) {
    fail(`Walkthrough keys not found: ${KEYS_FILE}\n` +
         `   Run \`node setup-keys.js\` to generate them, or copy from\n` +
         `   ../walkthrough-hbar/ if you already ran that walkthrough.`);
  }
  const keysData = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const signerCount = Object.keys(keysData.keys || {}).length;
  if (signerCount !== 3) fail(`Expected 3 keys in walkthrough-keys.json, found ${signerCount}`);
  console.log(chalk.green('✓'), `Found 3 signing keys: ${Object.keys(keysData.keys).join(', ')}`);

  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );
  const balance = await new AccountBalanceQuery().setAccountId(process.env.OPERATOR_ID).execute(client);
  const hbar = balance.hbars.toBigNumber().toNumber();
  console.log(chalk.green('✓'), `Operator: ${process.env.OPERATOR_ID} (${hbar.toFixed(2)} ℏ)`);
  if (hbar < MIN_BALANCE_HBAR) {
    fail(
      `Operator needs ≥${MIN_BALANCE_HBAR} ℏ for the contract walkthrough; found ${hbar.toFixed(2)} ℏ.\n` +
      `   The demo account is funded with 20 ℏ in step 01 to cover the contract\n` +
      `   deploy in step 02 (gas pricing on testnet can spike 5–10 ℏ for 800k gas).\n` +
      `   Refill the operator at https://portal.hedera.com/ — testnet ℏ is free.`
    );
  }

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
