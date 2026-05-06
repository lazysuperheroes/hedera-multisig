#!/usr/bin/env node
/**
 * Walkthrough step 5 (contract): convert the demo EOA to a 2-of-3 threshold key.
 *
 * `AccountUpdateTransaction` changes the account's key. Hedera enforces a
 * **dual-signature rule** for key rotations:
 *
 *   - The OLD key must sign — proves you currently control the account.
 *   - The NEW key must sign — proves you accept the new control structure
 *     (prevents griefing where someone sets your key to a key you don't hold).
 *
 * For our 2-of-3 KeyList replacing alice's single key, that means:
 *   - alice (old key) signs — 1 signature
 *   - The new threshold key signs at threshold (any 2 of alice/bob/carol)
 *
 * Since alice is in BOTH the old key and the new threshold, her single
 * signature satisfies the old-key requirement; we still need 1 more from
 * bob or carol to satisfy the new-key threshold. We sign with all three
 * locally (we hold every key in this walkthrough) — Hedera ignores extra
 * signatures so this is safe and forgiving.
 *
 * After this script, the demo account is multi-sig. Verify by running
 * step 06 (negative test).
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  Client, AccountId, PrivateKey, PublicKey,
  AccountUpdateTransaction, KeyList, AccountInfoQuery,
} = require('@hashgraph/sdk');
const chalk = require('chalk');

const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const KEYS_FILE = path.resolve(__dirname, 'walkthrough-keys.json');
const THRESHOLD = 2;

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Convert demo EOA → 2-of-3 multi-sig ━━━\n'));

  if (!fs.existsSync(STATE_FILE)) fail('Run 01-create-demo-eoa.js first.');
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const keysData = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));

  if (state.convertedToMultisigAt) {
    fail(`Account ${state.demoAccountId} was already converted at ${state.convertedToMultisigAt}.\n` +
         `   To re-run, start over with 01-create-demo-eoa.js.`);
  }

  // Operator pays for the AccountUpdate transaction (so we don't deplete the demo account)
  const client = state.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.OPERATOR_ID),
    PrivateKey.fromString(process.env.OPERATOR_KEY)
  );

  // Build the new 2-of-3 KeyList from alice/bob/carol public keys
  const signers = ['alice', 'bob', 'carol'];
  const publicKeys = signers.map((n) => PublicKey.fromString(keysData.keys[n].publicKey));
  const newKey = new KeyList(publicKeys, THRESHOLD);

  console.log(chalk.gray(`Account: ${state.demoAccountId}`));
  console.log(chalk.gray(`Old key: alice (single)`));
  console.log(chalk.gray(`New key: 2-of-3 KeyList of [alice, bob, carol]`));

  // Build, freeze, then sign with old + new keys
  const txInit = new AccountUpdateTransaction()
    .setAccountId(AccountId.fromString(state.demoAccountId))
    .setKey(newKey)
    .setAccountMemo('hedera-multisig walkthrough — converted to 2-of-3 multi-sig');
  const frozen = await txInit.freezeWith(client);

  // Sign with all three private keys (alice = old key, alice + bob + carol satisfy 2-of-3 new key)
  const alicePriv = PrivateKey.fromString(keysData.keys.alice.privateKey);
  const bobPriv = PrivateKey.fromString(keysData.keys.bob.privateKey);
  const carolPriv = PrivateKey.fromString(keysData.keys.carol.privateKey);

  const signed1 = await frozen.sign(alicePriv);
  const signed2 = await signed1.sign(bobPriv);
  const signed3 = await signed2.sign(carolPriv);

  console.log(chalk.gray('\nSubmitting AccountUpdateTransaction with all three signatures...'));
  const submit = await signed3.execute(client);
  const receipt = await submit.getReceipt(client);

  console.log(chalk.green(`\n✅ Conversion complete: ${receipt.status.toString()}`));

  // Verify by querying account info
  const info = await new AccountInfoQuery()
    .setAccountId(state.demoAccountId)
    .execute(client);
  console.log(chalk.gray(`   New account key type: ${info.key.constructor.name}`));
  if (info.key instanceof KeyList) {
    console.log(chalk.gray(`   Threshold: ${info.key.threshold} of ${info.key.toArray().length}`));
  }

  state.convertedToMultisigAt = new Date().toISOString();
  state.thresholdConfig = {
    threshold: THRESHOLD,
    publicKeys: publicKeys.map((p) => p.toString()),
  };
  state.conversionTransactionId = submit.transactionId.toString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log(chalk.bold.cyan('\n   This account is now controlled by a 2-of-3 threshold key.'));
  console.log(chalk.bold.cyan('   The single alice key alone can no longer authorize transactions.\n'));
  console.log(chalk.bold.cyan('Next: node 06-prove-eoa-rejected.js (negative test — expect failure)\n'));
  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
