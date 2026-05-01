#!/usr/bin/env node
/**
 * Walkthrough step 6 (contract): negative test — prove the single-sig path is dead.
 *
 * After step 5, the demo account requires 2-of-3 signatures. This script
 * tries to call `Counter.increment()` exactly the same way 04 did — with
 * only alice's single signature — and **expects** to fail with
 * `INVALID_SIGNATURE`. A pass here means the conversion worked.
 *
 * Exit code:
 *   0 — single-sig was rejected (expected outcome ✓)
 *   1 — single-sig succeeded (BUG — conversion didn't take effect)
 *   2 — script error before the test could run
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, ContractId, Status,
  ContractExecuteTransaction,
} = require('@hashgraph/sdk');
const { Interface } = require('ethers');
const chalk = require('chalk');

const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const ARTIFACT = path.resolve(__dirname, 'Counter.json');

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Negative test: single-sig should be rejected ━━━\n'));

  if (!fs.existsSync(STATE_FILE)) failHard('Run earlier steps first.');
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state.convertedToMultisigAt) {
    failHard(`Account ${state.demoAccountId} has NOT been converted yet — run 05-convert-eoa-to-multisig.js first.\n` +
             `   This negative test only makes sense after conversion.`);
  }
  if (!state.contractId) failHard('No contractId in state.');

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const iface = new Interface(artifact.abi);

  const client = state.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  // Set the operator to the demo account using ONLY alice's key. Pre-conversion
  // this would succeed; post-conversion this should fail with INVALID_SIGNATURE
  // because the threshold (2) is not met.
  client.setOperator(
    AccountId.fromString(state.demoAccountId),
    PrivateKey.fromString(state.initialKeyPrivate) // alice's key
  );

  const calldata = iface.encodeFunctionData('increment', []);

  console.log(chalk.gray(`Caller: ${state.demoAccountId} (now 2-of-3, but signing with alice only)`));
  console.log(chalk.gray(`Function: increment()`));
  console.log(chalk.gray('Expected outcome: INVALID_SIGNATURE\n'));

  let outcome;
  try {
    const submit = await new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(state.contractId))
      .setGas(100_000)
      .setFunctionParameters(Buffer.from(calldata.slice(2), 'hex'))
      .execute(client);

    // If we get here, .execute() submitted the transaction. The receipt
    // is where Hedera reports authorization failures.
    try {
      const receipt = await submit.getReceipt(client);
      outcome = `unexpected success (status ${receipt.status.toString()})`;
    } catch (receiptErr) {
      // ReceiptError carries the failing status — this is the expected path
      const status = receiptErr.status?.toString() || receiptErr.message;
      outcome = `rejected at receipt: ${status}`;
    }
  } catch (submitErr) {
    // Some clients reject pre-submission with INVALID_SIGNATURE — also acceptable
    outcome = `rejected at submit: ${submitErr.status?.toString() || submitErr.message}`;
  }

  console.log(chalk.gray(`Outcome: ${outcome}`));

  if (/INVALID_SIGNATURE/i.test(outcome) || /rejected/i.test(outcome) && !/unexpected/i.test(outcome)) {
    console.log(chalk.bold.green('\n✅ EXPECTED: Single-sig was rejected. Multi-sig is in effect.'));
    console.log(chalk.gray('   The demo account can no longer be controlled by alice alone.'));
    console.log(chalk.bold.cyan('\nNext: start a multi-sig coordinator and run the increment ceremony.'));
    console.log(chalk.gray('   See README.md "Step 7: Multi-sig increment ceremony"\n'));
    client.close();
    process.exit(0);
  }

  console.log(chalk.bold.red('\n❌ UNEXPECTED: single-sig succeeded. Conversion did not take effect.'));
  console.log(chalk.red('   This is a bug — file an issue with state details.'));
  client.close();
  process.exit(1);
}

function failHard(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(2);
}

main().catch((err) => failHard(err.stack || err.message));
