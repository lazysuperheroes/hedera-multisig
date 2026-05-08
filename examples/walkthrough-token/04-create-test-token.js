#!/usr/bin/env node
/**
 * Walkthrough step 4 (token): operator creates a test fungible token + NFT
 * collection so the multi-sig ceremonies have something real to associate
 * and transfer.
 *
 *   - Fungible token: 1000-unit supply, 0 decimals, 'WALK' symbol, operator
 *     is the treasury (so this single-sig tx can mint into the operator
 *     account directly).
 *   - NFT collection: max-supply 1, mints a single NFT with metadata
 *     pointing at this script.
 *
 * Both single-sig — paid for and signed by the operator. The multi-sig
 * ceremonies (associate / transfer / NFT transfer) come later, once the
 * operator has tokens to send.
 *
 * Persists the resulting tokenIds + serial number to
 * `walkthrough-state.json` so steps 05+ and the dApp /create form fields
 * can reference them by copy-paste.
 *
 * Idempotent on best-effort basis: if `walkthrough-state.json` already has
 * `fungibleTokenId` and `nftId` populated, we exit cleanly with a hint to
 * delete those keys to re-run.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const {
  Client,
  PrivateKey,
  AccountId,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenMintTransaction,
} = require('@hashgraph/sdk');

const STATE_FILE = path.join(__dirname, 'walkthrough-state.json');

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Step 4: Create test fungible + NFT (single-sig) ━━━\n'));

  const operatorId = process.env.OPERATOR_ID;
  const operatorKey = process.env.OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    fail('Set OPERATOR_ID and OPERATOR_KEY in your .env (testnet).');
  }

  if (!fs.existsSync(STATE_FILE)) {
    fail(`${STATE_FILE} not found — run steps 1-3 first.`);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  if (state.fungibleTokenId && state.nftId) {
    console.log(chalk.yellow('ℹ  walkthrough-state.json already has tokens. Nothing to do.'));
    console.log(chalk.gray(`   Fungible: ${state.fungibleTokenId}`));
    console.log(chalk.gray(`   NFT:      ${state.nftId} (serial ${state.nftSerialNumber})`));
    console.log(chalk.gray('\n   Delete those keys from walkthrough-state.json to re-create.\n'));
    return;
  }

  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const client = network === 'mainnet'
    ? Client.forMainnet().setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey))
    : Client.forTestnet().setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

  const opKey = PrivateKey.fromString(operatorKey);

  // ── Fungible ────────────────────────────────────────────────────────
  console.log(chalk.gray('Creating fungible WALK token (1000 supply, 0 decimals)…'));
  const fungibleCreate = await new TokenCreateTransaction()
    .setTokenName('Walkthrough Token')
    .setTokenSymbol('WALK')
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(0)
    .setInitialSupply(1000)
    .setTreasuryAccountId(AccountId.fromString(operatorId))
    .setSupplyKey(opKey.publicKey) // future-proofing; not used in this walkthrough
    .freezeWith(client)
    .sign(opKey);
  const fungibleResp = await fungibleCreate.execute(client);
  const fungibleReceipt = await fungibleResp.getReceipt(client);
  const fungibleTokenId = fungibleReceipt.tokenId.toString();
  console.log(chalk.green('✓'), `Fungible: ${fungibleTokenId}`);

  // ── NFT ─────────────────────────────────────────────────────────────
  console.log(chalk.gray('Creating WALKNFT collection (max 1) + minting serial 1…'));
  const nftCreate = await new TokenCreateTransaction()
    .setTokenName('Walkthrough NFT')
    .setTokenSymbol('WALKNFT')
    .setTokenType(TokenType.NonFungibleUnique)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(1)
    .setInitialSupply(0)
    .setTreasuryAccountId(AccountId.fromString(operatorId))
    .setSupplyKey(opKey.publicKey) // required to mint
    .freezeWith(client)
    .sign(opKey);
  const nftResp = await nftCreate.execute(client);
  const nftReceipt = await nftResp.getReceipt(client);
  const nftId = nftReceipt.tokenId.toString();

  // Mint serial 1 with a tiny metadata blob
  const mintTx = await new TokenMintTransaction()
    .setTokenId(nftReceipt.tokenId)
    .setMetadata([Buffer.from('walkthrough-token: serial 1', 'utf8')])
    .freezeWith(client)
    .sign(opKey);
  const mintResp = await mintTx.execute(client);
  const mintReceipt = await mintResp.getReceipt(client);
  const nftSerialNumber = Number(mintReceipt.serials[0]);
  console.log(chalk.green('✓'), `NFT: ${nftId} (serial ${nftSerialNumber})`);

  // ── Persist ─────────────────────────────────────────────────────────
  state.fungibleTokenId = fungibleTokenId;
  state.nftId = nftId;
  state.nftSerialNumber = nftSerialNumber;
  state.tokensCreatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  client.close();

  console.log(chalk.bold.green('\n✅ Test tokens created:'));
  console.log(chalk.gray(`   Fungible: ${fungibleTokenId}  (1000 WALK held by ${operatorId})`));
  console.log(chalk.gray(`   NFT:      ${nftId} #${nftSerialNumber}  (held by ${operatorId})`));
  console.log(chalk.gray(`   State:    ${STATE_FILE}`));

  console.log(chalk.bold.cyan('\nNext: Ceremony A — multi-sig token-association (see README).\n'));
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => {
  console.error(chalk.red('\n❌ '), err.message);
  process.exit(1);
});
