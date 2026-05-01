#!/usr/bin/env node
/**
 * Walkthrough step 3 (contract): send 2 ℏ from the demo EOA to the Counter
 * contract. This puts a balance on the contract so the later `withdraw()`
 * multi-sig ceremony has something to sweep back.
 *
 * Counter has a `receive()` payable function; sending HBAR to the contract
 * address triggers it implicitly.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, ContractId, Hbar,
  TransferTransaction, ContractInfoQuery,
} = require('@hashgraph/sdk');
const chalk = require('chalk');

const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const FUND_AMOUNT_HBAR = 2;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Fund Counter contract with 2 ℏ ━━━\n'));

  if (!fs.existsSync(STATE_FILE)) fail('Run 01-create-demo-eoa.js + 02-deploy-as-eoa.js first.');
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state.contractId) fail('No contractId in state — run 02-deploy-as-eoa.js first.');

  const client = state.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(state.demoAccountId),
    PrivateKey.fromString(state.initialKeyPrivate)
  );

  console.log(chalk.gray(`From: ${state.demoAccountId} (demo EOA)`));
  console.log(chalk.gray(`To:   ${state.contractId} (Counter contract)`));
  console.log(chalk.gray(`Amount: ${FUND_AMOUNT_HBAR} ℏ`));

  // TransferTransaction works for HBAR-to-contract too — the contract is a
  // Hedera account under the hood, so addHbarTransfer accepts a contract ID
  // (resolved via .toString() to "0.0.X" form).
  const tx = await new TransferTransaction()
    .addHbarTransfer(state.demoAccountId, new Hbar(-FUND_AMOUNT_HBAR))
    .addHbarTransfer(ContractId.fromString(state.contractId), new Hbar(FUND_AMOUNT_HBAR))
    .setTransactionMemo('walkthrough-contract: fund Counter')
    .execute(client);
  await tx.getReceipt(client);

  // Verify
  const info = await new ContractInfoQuery().setContractId(state.contractId).execute(client);
  const balanceHbar = info.balance.toBigNumber().toNumber();
  console.log(chalk.green(`\n✅ Contract balance: ${balanceHbar.toFixed(2)} ℏ`));
  console.log(`   View: https://hashscan.io/${state.network}/contract/${state.contractId}`);

  console.log(chalk.bold.cyan('\nNext: node 04-call-increment-as-eoa.js\n'));
  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
