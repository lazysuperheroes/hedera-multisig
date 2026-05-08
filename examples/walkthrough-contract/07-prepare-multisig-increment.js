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
const { selectNodeAccountIds, DEFAULT_SUBSET_SIZE } = require('../../shared/node-selection');

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
  //
  // Single-node freeze (DEFAULT_SUBSET_SIZE = 1). Counter-intuitive
  // for a multi-sig contract call but mandatory for wallet
  // compatibility:
  //
  //   - HashPack via WalletConnect re-freezes ContractExecuteTransaction
  //     internally before signing (gas / fee / timestamp adjustments).
  //     Its signatures are valid against ITS bytes but NOT against
  //     ours, so a multi-node freeze + wallet signer = "0 signatures
  //     verified" with no recovery path.
  //   - Single-node sidesteps it: only one body to sign, wallet's
  //     re-freeze either matches verbatim or its drift is contained.
  //
  // For CLI-only ceremonies (every signer using sign-via-key, no
  // wallets in the mix), bump `subsetSize: 6` for multi-node submission
  // resilience. See the project's root README for the full rationale.
  const nodeAccountIds = selectNodeAccountIds(client, {
    strategy: 'subset',
    subsetSize: DEFAULT_SUBSET_SIZE, // 1 — wallet-compatible default
  });
  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(state.contractId))
    .setGas(100_000)
    .setFunctionParameters(Buffer.from(calldata.slice(2), 'hex'))
    .setTransactionId(txId)
    .setNodeAccountIds(nodeAccountIds)
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

  // Compact one-line ABI for the dApp's "Contract ABI" textarea on
  // the paste-mode injection panel. Pasting this alongside the base64
  // unlocks verified function-name display ("increment()" green
  // badge) in the participant review screens. Counter's ABI is small
  // (a few function fragments) so a single line is fine; for larger
  // contracts the artifact JSON at OUT_FILE.abi has the same data
  // pretty-printed.
  console.log(chalk.bold.white('\nContract ABI (paste into dApp ABI textarea):'));
  console.log(chalk.cyan(JSON.stringify(artifact.abi)));

  console.log(chalk.bold.white('\nCeremony steps (run in parallel terminals):'));
  console.log(chalk.gray('  1. (already running?) Coordinator server:'));
  console.log(`     ${chalk.cyan('npx hedera-multisig server -t 2 -k "' + state.thresholdConfig.publicKeys.join(',') + '" --port 3001 --no-tunnel --timeout 0')}`);
  console.log(chalk.gray('  2. Inject this transaction via dApp /create — paste both the base64 above AND the ABI above.'));
  console.log(chalk.gray('  3. Two of [alice, bob, carol] join + sign — see README.'));
  console.log(chalk.gray(`  4. Verify: ${chalk.cyan('node verify-on-mirror.js ' + txId.toString())}`));
  console.log(chalk.gray(`             ${chalk.cyan('node query-counter.js --expect 2 --wait')}`));
  console.log(chalk.gray(`\n  Artifact saved: ${OUT_FILE} (also has abi/frozenBase64 fields if you prefer file-based pickup)\n`));

  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
