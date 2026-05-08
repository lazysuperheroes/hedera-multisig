#!/usr/bin/env node
/**
 * Walkthrough step 5 (agent): inject one of three demo transactions.
 *
 *   --scenario allowed         5 ℏ from threshold → operator (allowlisted, under limit)
 *                              Expected: agent APPROVES, alice signs, executes.
 *
 *   --scenario over-limit      50 ℏ from threshold → operator (allowlisted, OVER limit)
 *                              Expected: agent REJECTS via MaxAmountRule. Ceremony aborts.
 *
 *   --scenario blocked         5 ℏ from threshold → 0.0.98 (NOT allowlisted)
 *                              Expected: agent REJECTS via AllowedRecipientsRule. Aborts.
 *
 * Auto-discovers the running server via `.multisig-session.json` (the
 * coordinator process writes it on startup). Override with --connect
 * + --coordinator-token if you've moved it.
 *
 * Run from this directory after step 4 (the agent) is already
 * connected and waiting:
 *
 *     node 05-inject-scenario.js --scenario allowed
 *     node 05-inject-scenario.js --scenario over-limit
 *     node 05-inject-scenario.js --scenario blocked
 *
 * Watch the agent terminal — you'll see the policy evaluation in
 * real time.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const chalk = require('chalk');
const {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  TransferTransaction,
  TransactionId,
} = require('@hashgraph/sdk');
const { parseConnectionString } = require('../../shared/connection-string');
const { selectNodeAccountIds } = require('../../shared/node-selection');

const STATE_FILE = path.join(__dirname, 'walkthrough-state.json');
// Server writes `.multisig-session.json` to its CWD; we expect it at
// the repo root since that's typically where the user runs the server.
const SESSION_FILE_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '.multisig-session.json'),
  path.resolve(__dirname, '.multisig-session.json'),
  path.resolve(process.cwd(), '.multisig-session.json'),
];

const BLOCKED_RECIPIENT = '0.0.98'; // Hedera's "treasury" account, just used as
                                    // a never-allowlisted target for the demo.

const SCENARIOS = {
  'allowed': {
    description: '5 ℏ → operator (under limit, allowlisted)',
    amountHbar: 5,
    recipientFromState: 'operatorId',
    expectedOutcome: 'APPROVED',
  },
  'over-limit': {
    description: '50 ℏ → operator (allowlisted but over MaxAmountRule)',
    amountHbar: 50,
    recipientFromState: 'operatorId',
    expectedOutcome: 'REJECTED by MaxAmountRule',
  },
  'blocked': {
    description: '5 ℏ → 0.0.98 (not in AllowedRecipientsRule)',
    amountHbar: 5,
    recipientLiteral: BLOCKED_RECIPIENT,
    expectedOutcome: 'REJECTED by AllowedRecipientsRule',
  },
};

async function main() {
  // Args
  const args = process.argv.slice(2);
  const scenarioIdx = args.indexOf('--scenario');
  const scenarioName = scenarioIdx >= 0 ? args[scenarioIdx + 1] : null;
  if (!scenarioName || !SCENARIOS[scenarioName]) {
    console.error(chalk.red('\n❌ Pass --scenario allowed | over-limit | blocked\n'));
    for (const [name, def] of Object.entries(SCENARIOS)) {
      console.error(chalk.gray(`   ${name.padEnd(11)} ${def.description}`));
    }
    process.exit(2);
  }
  const scenario = SCENARIOS[scenarioName];

  // Auto-discover session
  const connectIdx = args.indexOf('--connect');
  const tokenIdx = args.indexOf('--coordinator-token');
  let connectionString = connectIdx >= 0 ? args[connectIdx + 1] : null;
  let coordinatorToken = tokenIdx >= 0 ? args[tokenIdx + 1] : null;
  if (!connectionString || !coordinatorToken) {
    let sessionData = null;
    for (const candidate of SESSION_FILE_CANDIDATES) {
      if (fs.existsSync(candidate)) {
        sessionData = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        break;
      }
    }
    if (!sessionData) {
      console.error(chalk.red(
        '\n❌ Could not find .multisig-session.json. Either the server isn\'t\n' +
        '   running, or it was started from a directory other than the repo root.\n' +
        '   Pass --connect "hmsc:..." --coordinator-token "..." explicitly.\n',
      ));
      process.exit(2);
    }
    connectionString = connectionString || sessionData.connectionString;
    coordinatorToken = coordinatorToken || sessionData.coordinatorToken;
  }
  const parsed = parseConnectionString(connectionString);
  if (!parsed) {
    console.error(chalk.red('\n❌ Invalid connection string.\n'));
    process.exit(2);
  }

  // State
  if (!fs.existsSync(STATE_FILE)) {
    console.error(chalk.red(`\n❌ ${STATE_FILE} not found. Run steps 1-3 first.\n`));
    process.exit(2);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const treasuryId = state.thresholdAccountId;
  const operatorId = state.operatorId;
  if (!treasuryId) {
    console.error(chalk.red('\n❌ walkthrough-state.json missing thresholdAccountId.\n'));
    process.exit(2);
  }

  const recipientId = scenario.recipientLiteral
    || state[scenario.recipientFromState];
  if (!recipientId) {
    console.error(chalk.red(`\n❌ Could not resolve recipient (${scenario.recipientFromState}).\n`));
    process.exit(2);
  }

  // Build + freeze the transfer
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const operatorKey = process.env.OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    console.error(chalk.red('\n❌ Set OPERATOR_ID and OPERATOR_KEY in .env.\n'));
    process.exit(2);
  }
  const client = network === 'mainnet'
    ? Client.forMainnet().setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey))
    : Client.forTestnet().setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

  console.log(chalk.bold.cyan(`\n━━━ Inject scenario: ${scenarioName} ━━━`));
  console.log(chalk.gray(`  ${scenario.description}`));
  console.log(chalk.gray(`  Expected: ${scenario.expectedOutcome}\n`));

  const txId = TransactionId.generate(operatorId);
  const nodeAccountIds = selectNodeAccountIds(client); // single-node default
  const tx = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(treasuryId), Hbar.from(-scenario.amountHbar))
    .addHbarTransfer(AccountId.fromString(recipientId), Hbar.from(scenario.amountHbar))
    .setTransactionId(txId)
    .setNodeAccountIds(nodeAccountIds)
    .setTransactionMemo(`walkthrough-agent: ${scenarioName}`)
    .freezeWith(client);
  const frozenBase64 = Buffer.from(tx.toBytes()).toString('base64');
  client.close();

  console.log(chalk.gray(`  txId: ${txId.toString()}`));
  console.log(chalk.gray(`  bytes: ${frozenBase64.length} chars\n`));

  // Inject via WebSocket as coordinator
  const ws = new WebSocket(parsed.serverUrl);
  let phase = 'connecting';
  const timeout = setTimeout(() => {
    console.error(chalk.red(`\n❌ Timed out in phase '${phase}'\n`));
    try { ws.close(); } catch {}
    process.exit(1);
  }, 30000);

  ws.on('open', () => {
    phase = 'auth';
    ws.send(JSON.stringify({
      type: 'AUTH',
      payload: {
        sessionId: parsed.sessionId,
        pin: parsed.pin,
        role: 'coordinator',
        coordinatorToken,
        label: 'walkthrough-agent injector',
      },
    }));
  });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'AUTH_FAILED') {
      clearTimeout(timeout);
      console.error(chalk.red(`\n❌ AUTH_FAILED: ${msg.payload?.message}\n`));
      ws.close();
      process.exit(1);
    }

    if (msg.type === 'AUTH_SUCCESS' && phase === 'auth') {
      phase = 'inject';
      console.log(chalk.green('✓ authenticated as coordinator'));
      ws.send(JSON.stringify({
        type: 'TRANSACTION_INJECT',
        payload: { frozenTransaction: frozenBase64 },
      }));
      return;
    }

    if (msg.type === 'TRANSACTION_RECEIVED' && phase === 'inject') {
      clearTimeout(timeout);
      console.log(chalk.green('✓ injected — watch the agent terminal for the policy decision'));
      console.log(chalk.gray(
        '\n  If the agent approves, alice still has to sign — run `npx hedera-multisig\n' +
        '  participant --connect "..." --key-file walkthrough-keys.alice.encrypted ...`\n' +
        '  in another terminal (see README).\n',
      ));
      ws.close();
      process.exit(0);
    }

    if (msg.type === 'INJECTION_FAILED' && phase === 'inject') {
      clearTimeout(timeout);
      console.error(chalk.red(`\n❌ INJECTION_FAILED: ${msg.payload?.message}\n`));
      ws.close();
      process.exit(1);
    }
  });

  ws.on('error', (err) => {
    clearTimeout(timeout);
    console.error(chalk.red(`\n❌ WebSocket error: ${err.message}\n`));
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(chalk.red('\n❌ '), err.stack || err.message);
  process.exit(1);
});
