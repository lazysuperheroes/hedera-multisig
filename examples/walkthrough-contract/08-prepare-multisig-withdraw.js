#!/usr/bin/env node
/**
 * Walkthrough step 8 (contract): prepare a multi-sig `withdraw()` ceremony.
 *
 * Counter.withdraw() is admin-only — `require(msg.sender == admin)`.
 * `admin` was set to the deployer's EVM address in the constructor: that's
 * the demo account's address. The demo account is now controlled by a
 * 2-of-3 threshold key (post step 5), so the only way to call withdraw()
 * successfully is via a multi-sig ceremony.
 *
 * Output: same shape as 07 — a frozen base64 transaction the coordinator
 * injects, a 120-second validity window, expected function = "withdraw".
 *
 * After the ceremony succeeds, the contract's HBAR balance is swept back
 * to the demo (multi-sig) account.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, ContractId, TransactionId,
  ContractExecuteTransaction, ContractInfoQuery,
} = require('@hashgraph/sdk');
const { Interface } = require('ethers');
const chalk = require('chalk');
const { selectNodeAccountIds, DEFAULT_SUBSET_SIZE } = require('../../shared/node-selection');

const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const ARTIFACT = path.resolve(__dirname, 'Counter.json');
const OUT_FILE = path.resolve(__dirname, 'multisig-withdraw-tx.json');

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Prepare multi-sig withdraw() ceremony ━━━\n'));

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state.convertedToMultisigAt) fail('Run 05-convert-eoa-to-multisig.js first.');
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const iface = new Interface(artifact.abi);

  const client = state.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );

  // Show current contract balance so the user knows what's being swept
  const info = await new ContractInfoQuery()
    .setContractId(ContractId.fromString(state.contractId))
    .execute(client);
  const contractHbar = info.balance.toBigNumber().toNumber();
  console.log(chalk.gray(`Contract balance: ${contractHbar.toFixed(2)} ℏ → will be sent back to ${state.demoAccountId}`));

  const calldata = iface.encodeFunctionData('withdraw', []);
  const txId = TransactionId.generate(state.demoAccountId);

  // Multi-node freeze with random subset of 6 — see
  // shared/node-selection.js. Resilient to per-node downtime, well
  // under Hedera's 6 KB tx-size cap.
  const nodeAccountIds = selectNodeAccountIds(client, {
    strategy: 'subset',
    subsetSize: DEFAULT_SUBSET_SIZE,
  });
  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(state.contractId))
    .setGas(120_000) // slightly higher — withdraw does a value transfer
    .setFunctionParameters(Buffer.from(calldata.slice(2), 'hex'))
    .setTransactionId(txId)
    .setNodeAccountIds(nodeAccountIds)
    .setTransactionMemo('walkthrough-contract: multi-sig withdraw')
    .freeze();

  const bytes = tx.toBytes();
  const base64 = Buffer.from(bytes).toString('base64');

  const out = {
    network: state.network,
    contractId: state.contractId,
    demoAccountId: state.demoAccountId,
    threshold: state.thresholdConfig.threshold,
    eligiblePublicKeys: state.thresholdConfig.publicKeys,
    transactionId: txId.toString(),
    frozenBase64: base64,
    abi: artifact.abi,
    expectedFunction: 'withdraw',
    expectedArgs: [],
    contractBalanceAtFreeze: contractHbar,
    note: 'Frozen at ' + new Date().toISOString() + ' — 120s validity window. Inject IMMEDIATELY.',
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  console.log(chalk.gray(`\nFunction: withdraw() — admin-only`));
  console.log(chalk.gray(`Payer (multi-sig account): ${state.demoAccountId}`));
  console.log(chalk.gray(`Transaction ID: ${txId.toString()}`));
  console.log(chalk.yellow(`\n⏱  Expires in 120 seconds. Sign quickly.\n`));

  console.log(chalk.bold.white('Frozen transaction (base64):'));
  console.log(chalk.cyan(base64));

  // Compact one-line ABI for the dApp's "Contract ABI" textarea —
  // pasting it alongside the base64 unlocks verified function-name
  // display ("withdraw()" badge) in the participant review screen.
  console.log(chalk.bold.white('\nContract ABI (paste into dApp ABI textarea):'));
  console.log(chalk.cyan(JSON.stringify(artifact.abi)));

  console.log(chalk.gray(`\nArtifact saved: ${OUT_FILE} (also has abi/frozenBase64 fields if you prefer file-based pickup)`));
  console.log(chalk.gray(`Verify after ceremony: node verify-on-mirror.js ${txId.toString()}\n`));

  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
