#!/usr/bin/env node
/**
 * Walkthrough step 7 (contract): prepare a multi-sig `increment()` ceremony.
 *
 * Builds and freezes a `ContractExecuteTransaction` calling `increment()`
 * with the demo (multi-sig) account as the operator/payer. Outputs:
 *
 *   1. The frozen transaction bytes as base64 — what the coordinator
 *      pastes into the dApp's "Inject Transaction" or pipes to
 *      `npx hedera-multisig participant`.
 *   2. The ABI fragment for the coordinator to load (so participants see
 *      a verified function name in the review screen — Phase B9).
 *   3. The transaction ID and a HashScan link.
 *
 * The frozen bytes have a 120-second validity window. Get participants
 * connected to the coordinator FIRST, then run this, then immediately
 * inject the bytes and have everyone sign within 2 minutes.
 *
 * For longer windows (cross-timezone teams, async approvals), use
 * scheduled transactions instead — see README "Alternate path:
 * scheduled multi-sig" for that flow.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, ContractId, TransactionId,
  ContractExecuteTransaction,
} = require('@hashgraph/sdk');
const { Interface } = require('ethers');
const chalk = require('chalk');

const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const ARTIFACT = path.resolve(__dirname, 'Counter.json');
const OUT_FILE = path.resolve(__dirname, 'multisig-increment-tx.json');

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Prepare multi-sig increment() ceremony ━━━\n'));

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state.convertedToMultisigAt) fail('Run 05-convert-eoa-to-multisig.js first.');
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const iface = new Interface(artifact.abi);

  const client = state.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  // Operator pays for client-side network ops (node lookup), but the
  // transaction's payer is the demo (multi-sig) account.
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );

  const calldata = iface.encodeFunctionData('increment', []);
  const txId = TransactionId.generate(state.demoAccountId);

  // Build + freeze. We do NOT sign here — the multi-sig ceremony attaches
  // signatures after participants review.
  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(state.contractId))
    .setGas(100_000)
    .setFunctionParameters(Buffer.from(calldata.slice(2), 'hex'))
    .setTransactionId(txId)
    .setNodeAccountIds([new AccountId(3), new AccountId(4), new AccountId(5)])
    .setTransactionMemo('walkthrough-contract: multi-sig increment')
    .freeze();

  const bytes = tx.toBytes();
  const base64 = Buffer.from(bytes).toString('base64');

  // Persist the artifact so the coordinator can pick it up
  const out = {
    network: state.network,
    contractId: state.contractId,
    demoAccountId: state.demoAccountId,
    threshold: state.thresholdConfig.threshold,
    eligiblePublicKeys: state.thresholdConfig.publicKeys,
    transactionId: txId.toString(),
    frozenBase64: base64,
    abi: artifact.abi,
    expectedFunction: 'increment',
    expectedArgs: [],
    note: 'Frozen at ' + new Date().toISOString() + ' — 120s validity window. Inject IMMEDIATELY.',
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  console.log(chalk.gray(`Contract: ${state.contractId}`));
  console.log(chalk.gray(`Function: increment()`));
  console.log(chalk.gray(`Payer (multi-sig account): ${state.demoAccountId}`));
  console.log(chalk.gray(`Transaction ID: ${txId.toString()}`));
  console.log(chalk.gray(`Frozen at: ${new Date().toISOString()}`));
  console.log(chalk.yellow(`\n⏱  This transaction expires in 120 seconds. Sign quickly.\n`));

  console.log(chalk.bold.white('Frozen transaction (base64):'));
  console.log(chalk.cyan(base64));

  console.log(chalk.bold.white('\nCeremony steps (run in parallel terminals):'));
  console.log(chalk.gray('  1. (already running?) Coordinator server:'));
  console.log(`     ${chalk.cyan('npx hedera-multisig server -t 2 -k "' + state.thresholdConfig.publicKeys.join(',') + '" --port 3001 --no-tunnel')}`);
  console.log(chalk.gray('  2. Inject this transaction via dApp /create OR programmatically.'));
  console.log(chalk.gray('  3. Two of [alice, bob, carol] join + sign — see README.'));
  console.log(chalk.gray(`  4. Verify: ${chalk.cyan('node ../walkthrough-hbar/06-verify-on-mirror.js ' + txId.toString())}`));
  console.log(chalk.gray(`\n  Artifact saved: ${OUT_FILE}\n`));

  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
