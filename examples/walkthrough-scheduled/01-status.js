#!/usr/bin/env node
/**
 * Walkthrough step 5 (scheduled): print the current mirror-node state
 * of a scheduled transaction.
 *
 * Reads `walkthrough-state.json`'s `lastScheduleId` field (set by you
 * after the dApp's "Schedule created" confirmation in step 3 — see
 * the comment at the bottom of this file for the one-liner). Or pass
 * `--id <scheduleId>` to override.
 *
 * Prints a more readable view than `hedera-multisig schedule status`:
 *   - Maps signatories' public keys back to alice/bob/carol from
 *     walkthrough-state.json so you don't squint at hex.
 *   - Highlights threshold status (executed / pending / expired).
 *   - Shows the inner transaction's resulting transactionId on
 *     execution, so you can verify the ledger movement directly.
 *
 * For the raw view, use:
 *   hedera-multisig schedule status --schedule-id <id> --json
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { Client, AccountId, PrivateKey } = require('@hashgraph/sdk');
const ScheduledWorkflow = require('../../workflows/ScheduledWorkflow');
const { loadDotenvFromAncestors } = require('../../cli/utils/cliUtils');

function parseArgs(argv) {
  const args = { id: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--id' && argv[i + 1]) {
      args.id = argv[i + 1];
      i++;
    }
  }
  return args;
}

function pubKeyToName(pub, signers) {
  const norm = (pub || '').toLowerCase().replace(/^0x/, '');
  for (const s of signers) {
    const sNorm = (s.publicKey || '').toLowerCase().replace(/^0x/, '');
    if (sNorm.endsWith(norm) || norm.endsWith(sNorm)) return s.name;
  }
  return null;
}

async function main() {
  loadDotenvFromAncestors();

  const args = parseArgs(process.argv);
  const stateFile = path.join(__dirname, 'walkthrough-state.json');

  let scheduleId = args.id;
  let signers = [];

  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    scheduleId = scheduleId || state.lastScheduleId;
    signers = state.signers || [];
  }

  if (!scheduleId) {
    console.error(chalk.red(
      '\n❌ No schedule ID found.\n' +
      '   Pass --id <scheduleId> or set "lastScheduleId" in walkthrough-state.json:\n\n' +
      `     node -e "const f='${stateFile.replace(/\\/g, '/')}'; const s=JSON.parse(require('fs').readFileSync(f)); s.lastScheduleId='0.0.YOUR_ID'; require('fs').writeFileSync(f, JSON.stringify(s,null,2));"\n`
    ));
    process.exit(1);
  }

  const operatorId = process.env.OPERATOR_ID;
  const operatorKey = process.env.OPERATOR_KEY;
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();

  if (!operatorId || !operatorKey) {
    console.error(chalk.red('\n❌ OPERATOR_ID / OPERATOR_KEY not set in .env\n'));
    process.exit(1);
  }

  const client = network.startsWith('main')
    ? Client.forMainnet()
    : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromString(operatorKey)
  );

  try {
    const workflow = new ScheduledWorkflow(client, { verbose: false });
    const info = await workflow.getScheduleInfo(scheduleId);

    if (!info.success) {
      console.error(chalk.red(`\n❌ ${info.error || 'Unknown error'}\n`));
      process.exit(1);
    }

    const networkLabel = network.startsWith('main') ? 'mainnet' : 'testnet';
    console.log('');
    console.log(chalk.bold.cyan(`━━━ Schedule ${info.scheduleId} ━━━`));
    console.log(chalk.gray(`    https://hashscan.io/${networkLabel}/schedule/${info.scheduleId}`));
    console.log('');

    const status = info.executed
      ? chalk.bold.green('EXECUTED ✅')
      : info.deleted
      ? chalk.bold.red('DELETED 🗑️')
      : chalk.bold.yellow('PENDING ⏳');
    console.log(`  Status:       ${status}`);

    if (info.memo) console.log(`  Memo:         ${info.memo}`);
    if (info.creatorAccountId) console.log(`  Creator:      ${info.creatorAccountId}`);
    if (info.payerAccountId) console.log(`  Payer:        ${info.payerAccountId}`);

    if (info.expirationTime) {
      const expiresAt = new Date(info.expirationTime);
      const ms = expiresAt.getTime() - Date.now();
      const human = ms > 0
        ? `~${Math.floor(ms / 86400000)}d ${Math.floor((ms % 86400000) / 3600000)}h from now`
        : 'expired';
      console.log(`  Expiration:   ${info.expirationTime} (${human})`);
    }

    if (info.executedAt) {
      console.log(`  Executed at:  ${info.executedAt}`);
    }

    const sigs = info.signatories || [];
    console.log('');
    console.log(chalk.bold(`  Signatories (${sigs.length}):`));
    if (sigs.length === 0) {
      console.log(chalk.gray('    (none yet — schedule created but no one has signed)'));
    } else {
      for (const sig of sigs) {
        const name = pubKeyToName(sig, signers);
        const tag = name ? chalk.cyan(`(${name})`) : chalk.gray('(unknown)');
        console.log(`    - ${sig.slice(0, 32)}… ${tag}`);
      }
    }

    if (!info.executed && !info.deleted) {
      console.log('');
      console.log(chalk.gray(
        '  Threshold not yet met. Sign with:\n' +
        `    hedera-multisig schedule sign --schedule-id ${info.scheduleId} \\\n` +
        '      --keyfile ./walkthrough-keys.<name>.encrypted --passphrase walkthrough-test'
      ));
    }
    console.log('');
  } catch (err) {
    console.error(chalk.red(`\n❌ ${err.message}\n`));
    process.exit(1);
  } finally {
    client.close();
  }
}

main();
