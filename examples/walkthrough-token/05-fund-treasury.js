#!/usr/bin/env node
/**
 * Walkthrough step 5 (token): operator funds the threshold account so it
 * has tokens to spend in the multi-sig transfer ceremonies.
 *
 *   - Sends 100 WALK fungible to the threshold account.
 *   - Sends NFT #1 to the threshold account.
 *
 * Single-sig — operator owns the tokens (created in step 4 with operator
 * as treasury) and pays the network fee.
 *
 * Run AFTER Ceremony A (multi-sig token-association) succeeds —
 * the threshold account has to be associated with both tokens before
 * it can hold them, and that association IS the multi-sig ceremony.
 * If you run this before Ceremony A, both transfers will fail with
 * `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`.
 *
 * Idempotent on best-effort basis: persists `treasuryFundedAt` to
 * walkthrough-state.json. Re-running prints a hint and exits.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const {
  Client,
  PrivateKey,
  AccountId,
  TokenId,
  NftId,
  TransferTransaction,
} = require('@hashgraph/sdk');

const STATE_FILE = path.join(__dirname, 'walkthrough-state.json');

const FUNGIBLE_AMOUNT = 100;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Step 5: Fund the threshold account (single-sig) ━━━\n'));

  const operatorId = process.env.OPERATOR_ID;
  const operatorKey = process.env.OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    fail('Set OPERATOR_ID and OPERATOR_KEY in your .env (testnet).');
  }

  if (!fs.existsSync(STATE_FILE)) {
    fail(`${STATE_FILE} not found — run steps 1-4 first.`);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  if (!state.thresholdAccountId) {
    fail('walkthrough-state.json missing thresholdAccountId — run step 3 first.');
  }
  if (!state.fungibleTokenId || !state.nftId) {
    fail('walkthrough-state.json missing fungibleTokenId / nftId — run step 4 first.');
  }
  if (state.treasuryFundedAt) {
    console.log(chalk.yellow('ℹ  Threshold account already funded.'));
    console.log(chalk.gray(`   At: ${state.treasuryFundedAt}`));
    console.log(chalk.gray('\n   Delete `treasuryFundedAt` from walkthrough-state.json to re-run.\n'));
    return;
  }

  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const client = network === 'mainnet'
    ? Client.forMainnet().setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey))
    : Client.forTestnet().setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

  const opKey = PrivateKey.fromString(operatorKey);
  const treasuryId = AccountId.fromString(state.thresholdAccountId);
  const fungibleId = TokenId.fromString(state.fungibleTokenId);
  const nftTokenId = TokenId.fromString(state.nftId);

  // Bundle both transfers in a single atomic tx — either both succeed
  // (threshold account fully funded) or both fail (often because
  // Ceremony A wasn't run yet, so neither token is associated).
  console.log(chalk.gray(`Sending ${FUNGIBLE_AMOUNT} WALK + NFT #${state.nftSerialNumber} to ${state.thresholdAccountId}…`));
  const tx = await new TransferTransaction()
    .addTokenTransfer(fungibleId, AccountId.fromString(operatorId), -FUNGIBLE_AMOUNT)
    .addTokenTransfer(fungibleId, treasuryId, FUNGIBLE_AMOUNT)
    .addNftTransfer(
      new NftId(nftTokenId, state.nftSerialNumber),
      AccountId.fromString(operatorId),
      treasuryId,
    )
    .freezeWith(client)
    .sign(opKey);
  const resp = await tx.execute(client);
  const receipt = await resp.getReceipt(client);

  if (receipt.status.toString() !== 'SUCCESS') {
    fail(`Funding tx failed: ${receipt.status.toString()}. ` +
         `If TOKEN_NOT_ASSOCIATED_TO_ACCOUNT, run Ceremony A first.`);
  }

  state.treasuryFundedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  client.close();

  console.log(chalk.bold.green('\n✅ Threshold account funded:'));
  console.log(chalk.gray(`   ${FUNGIBLE_AMOUNT} WALK in ${state.thresholdAccountId}`));
  console.log(chalk.gray(`   NFT #${state.nftSerialNumber} in ${state.thresholdAccountId}`));

  console.log(chalk.bold.cyan('\nNext: Ceremony B — multi-sig fungible transfer (see README).\n'));
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => {
  console.error(chalk.red('\n❌ '), err.message);
  process.exit(1);
});
