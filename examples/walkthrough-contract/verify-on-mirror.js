#!/usr/bin/env node
/**
 * Walkthrough utility (contract): verify a transaction on the mirror node.
 *
 * Pass the transaction ID printed by the coordinator after a multi-sig
 * ceremony (steps 7d, 8). The script polls the mirror node (with
 * retry/backoff) until it confirms the transaction was externalized,
 * then prints the consensus timestamp, fee, and HBAR transfers.
 *
 * Usage:
 *   node verify-on-mirror.js 0.0.X@1234567890.000000000
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const MirrorNodeClient = require('../../shared/mirror-node-client');
const chalk = require('chalk');

const STATE_FILE = path.join(__dirname, 'demo-account-state.json');

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Verify on mirror node ━━━\n'));

  const txId = process.argv[2];
  if (!txId) {
    console.error(chalk.red('❌ Usage: node verify-on-mirror.js <transactionId>'));
    console.error(chalk.gray('   Example: node verify-on-mirror.js 0.0.1234@1764452239.277675395'));
    process.exit(1);
  }

  const network = fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).network
    : (process.env.HEDERA_NETWORK || 'testnet');

  console.log(`Transaction ID: ${txId}`);
  console.log(`Network: ${network}`);
  console.log(chalk.gray('Polling mirror node (this may take 5–15 seconds for consensus to externalize)...\n'));

  const mirror = new MirrorNodeClient(network);
  const verification = await mirror.verifyExecution(txId, {
    maxAttempts: 10,
    pollIntervalMs: 2500,
  });

  if (!verification.mirrorConfirmed) {
    console.error(chalk.red(`❌ Mirror did not confirm ${txId} after ${10 * 2.5}s.`));
    console.error(chalk.gray('   Possible reasons:'));
    console.error(chalk.gray('   - Threshold not met (only one of two signers signed)'));
    console.error(chalk.gray('   - Transaction expired before signatures arrived (120s window)'));
    console.error(chalk.gray('   - Network congestion — check HashScan manually:'));
    console.error(chalk.gray(`     https://hashscan.io/${network}/transaction/${txId}`));
    process.exit(2);
  }

  const r = verification.record;
  console.log(chalk.bold.green('✅ Mirror confirmed:'));
  console.log(`   Result: ${chalk.bold(r.result)}`);
  console.log(`   Consensus: ${r.consensusTimestamp}`);
  console.log(`   Fee paid: ${r.chargedTxFee} tinybars`);
  if (Array.isArray(r.transfers) && r.transfers.length > 0) {
    console.log(chalk.bold(`   Transfers (${r.transfers.length}):`));
    for (const t of r.transfers) {
      const sign = t.amount > 0 ? '+' : '';
      console.log(`     ${t.account.padEnd(14)} ${sign}${t.amount} tinybars`);
    }
  }
  console.log(chalk.gray(`\n   View on HashScan: https://hashscan.io/${network}/transaction/${txId}\n`));
}

main().catch((err) => {
  console.error(chalk.red('\n❌ ') + (err.stack || err.message) + '\n');
  process.exit(3);
});
