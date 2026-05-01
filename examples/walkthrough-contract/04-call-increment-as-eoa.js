#!/usr/bin/env node
/**
 * Walkthrough step 4 (contract): call Counter.increment() as the demo EOA.
 *
 * Single-sig: the demo account is currently controlled by alice's key, so
 * this is a normal `ContractExecuteTransaction` signed implicitly by the
 * client operator.
 *
 * After running, queries the count via mirror to confirm it ticked from 0
 * to 1. The follow-up step (05-convert) will switch the account's key to
 * a 2-of-3 threshold; from then on this same call shape will fail with
 * `INVALID_SIGNATURE` (proven by 06-prove-eoa-rejected.js).
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, ContractId,
  ContractExecuteTransaction, ContractCallQuery,
} = require('@hashgraph/sdk');
const { Interface } = require('ethers');
const chalk = require('chalk');

const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const ARTIFACT = path.resolve(__dirname, 'Counter.json');
const CALL_GAS = 100_000;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Call Counter.increment() as demo EOA (single-sig) ━━━\n'));

  if (!fs.existsSync(STATE_FILE)) fail('Run earlier steps first.');
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state.contractId) fail('No contractId — run 02-deploy-as-eoa.js first.');
  if (state.convertedToMultisigAt) {
    console.log(chalk.yellow('⚠  This account has already been converted to multi-sig.'));
    console.log(chalk.yellow('   Single-sig increment will fail; that is the point of step 06.'));
    console.log(chalk.yellow('   To re-run the EOA arc, restart from 01-create-demo-eoa.js.\n'));
  }

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const iface = new Interface(artifact.abi);

  const client = state.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(state.demoAccountId),
    PrivateKey.fromString(state.initialKeyPrivate)
  );

  // Encode increment() call (no args)
  const calldata = iface.encodeFunctionData('increment', []);

  console.log(chalk.gray(`Caller: ${state.demoAccountId} (single-key)`));
  console.log(chalk.gray(`Function: increment()`));

  const tx = await new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(state.contractId))
    .setGas(CALL_GAS)
    .setFunctionParameters(Buffer.from(calldata.slice(2), 'hex'))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  console.log(chalk.green(`✅ increment() executed: ${receipt.status.toString()}`));
  console.log(`   Tx: ${tx.transactionId.toString()}`);

  // Read back via ContractCallQuery — no signature needed for a view function.
  const queryCalldata = iface.encodeFunctionData('getCount', []);
  const result = await new ContractCallQuery()
    .setContractId(ContractId.fromString(state.contractId))
    .setGas(50_000)
    .setFunctionParameters(Buffer.from(queryCalldata.slice(2), 'hex'))
    .execute(client);
  const [count] = iface.decodeFunctionResult('getCount', '0x' + Buffer.from(result.bytes).toString('hex'));
  console.log(chalk.bold.green(`\n   Counter is now: ${count.toString()}`));
  console.log(`   View on HashScan: https://hashscan.io/${state.network}/contract/${state.contractId}`);

  console.log(chalk.bold.cyan('\nNext: node 05-convert-eoa-to-multisig.js (turn this account into 2-of-3)\n'));
  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
