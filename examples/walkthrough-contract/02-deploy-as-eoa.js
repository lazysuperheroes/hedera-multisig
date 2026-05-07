#!/usr/bin/env node
/**
 * Walkthrough step 2 (contract): deploy Counter.sol as the demo EOA.
 *
 * Uses Hedera's `ContractCreateFlow()` (the canonical pattern from
 * https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/create-a-smart-contract#contractcreateflow ).
 * It transparently:
 *   1. Creates a Hedera File entity to hold the bytecode (FileCreate).
 *   2. Appends additional chunks if the bytecode exceeds 4 KiB
 *      (FileAppend) — Counter is only 850 bytes so this is a no-op here.
 *   3. Issues ContractCreateTransaction referencing that File.
 *   4. Cleans up the File entity (FileDelete).
 *
 * The contract's Solidity-level `admin` is set in the constructor to
 * `msg.sender`, which becomes the demo EOA's EVM address. This matters
 * later: after we convert the demo account to multi-sig, only that same
 * Hedera account ID (now controlled by the threshold key) can call
 * `withdraw()` — the contract's access control is unchanged, the
 * authorization required to act AS that account is what changes.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey,
  ContractCreateFlow,
} = require('@hashgraph/sdk');
const chalk = require('chalk');

const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const ARTIFACT = path.resolve(__dirname, 'Counter.json');
const DEPLOY_GAS = 800_000;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Deploy Counter as demo EOA (single-sig) ━━━\n'));

  if (!fs.existsSync(STATE_FILE)) fail('Run 01-create-demo-eoa.js first.');
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));

  const client = state.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  // KEY MOMENT: we set the demo account as the operator, signing with alice's key.
  // The deploy transaction's payer + msg.sender for the constructor is the demo EOA.
  // This is the EOA stage — the demo account is controlled by alice's single key.
  client.setOperator(
    AccountId.fromString(state.demoAccountId),
    PrivateKey.fromString(state.initialKeyPrivate)
  );

  console.log(chalk.gray(`Deployer (operator): ${state.demoAccountId} (single-key)`));
  console.log(chalk.gray(`Bytecode: ${artifact.bytecode.length / 2} bytes`));
  console.log(chalk.gray(`Gas: ${DEPLOY_GAS.toLocaleString()}`));

  // ContractCreateFlow wraps File + Chunked-Append + ContractCreate.
  // Counter has no constructor arguments, so we don't call setConstructorParameters.
  const flow = new ContractCreateFlow()
    .setBytecode(artifact.bytecode)
    .setGas(DEPLOY_GAS);

  let submit, receipt;
  try {
    submit = await flow.execute(client);
    receipt = await submit.getReceipt(client);
  } catch (err) {
    // Most common failure here is INSUFFICIENT_PAYER_BALANCE — the demo
    // EOA pays for the entire ContractCreateFlow (FileCreate + optional
    // FileAppend + ContractCreate), and 800k gas at testnet pricing can
    // run 5–10 ℏ. Surface the diagnostic with a concrete remediation
    // before re-throwing.
    if (err && /INSUFFICIENT_PAYER_BALANCE/i.test(err.message || '')) {
      console.error(chalk.red(
        `\n❌ Demo account ${state.demoAccountId} ran out of HBAR mid-deploy.\n`
      ));
      console.error(chalk.gray(
        `   The demo EOA pays for the entire ContractCreateFlow (FileCreate +\n` +
        `   ${DEPLOY_GAS.toLocaleString()} gas ContractCreate). On a testnet day with\n` +
        `   elevated gas pricing this can exceed the initial funding.\n\n` +
        `   Fix: top up the demo account from your operator, then re-run\n` +
        `   this script. Try +20 ℏ for safety:\n\n`
      ));
      console.error(chalk.cyan(
        `     node -e "(async()=>{const{Client,AccountId,PrivateKey,TransferTransaction,Hbar}=require('@hashgraph/sdk');\\n` +
        `       require('dotenv').config({path:'../../.env'});const c=Client.forTestnet();\\n` +
        `       c.setOperator(AccountId.fromString(process.env.OPERATOR_ID),PrivateKey.fromString(process.env.OPERATOR_KEY));\\n` +
        `       const tx=await new TransferTransaction().addHbarTransfer(process.env.OPERATOR_ID,new Hbar(-20)).addHbarTransfer('${state.demoAccountId}',new Hbar(20)).execute(c);\\n` +
        `       await tx.getReceipt(c);console.log('Funded ${state.demoAccountId} +20 ℏ');})()"\n\n`
      ));
      console.error(chalk.gray(
        `   Step 01 was updated post-incident to fund 20 ℏ by default; if you\n` +
        `   pulled this repo recently and got a fresh demo account from\n` +
        `   01-create-demo-eoa.js, this error shouldn't recur.\n`
      ));
    }
    throw err;
  }
  const contractId = receipt.contractId.toString();

  console.log(chalk.green(`\n✅ Counter deployed: ${chalk.bold(contractId)}`));
  console.log(`   Solidity admin = demo account's EVM address (${state.demoAccountId}'s)`);
  console.log(`   View on HashScan: https://hashscan.io/${state.network}/contract/${contractId}`);

  state.contractId = contractId;
  state.deployTransactionId = submit.transactionId.toString();
  state.deployedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log(chalk.bold.cyan('\nNext: node 03-fund-contract.js\n'));
  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
