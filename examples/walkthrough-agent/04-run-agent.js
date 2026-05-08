#!/usr/bin/env node
/**
 * Walkthrough step 4 (agent): long-running automated co-signer.
 *
 * Connects to a coordinator session via the AgentSigningClient,
 * applies a TreasuryAgent policy to every incoming transaction, and:
 *   - approves + signs anything within policy (max 10 ℏ to allowlisted
 *     recipients)
 *   - rejects (TRANSACTION_REJECTED) anything that violates a rule,
 *     with the rule name + reason in the broadcast — so other
 *     participants and the coordinator can see WHY the agent declined.
 *
 * The point of this script is to make a marketing-grade demo of the
 * AgentSigningClient + PolicyEngine. The console output is the
 * artifact — it shows policy decisions in plain English so a reader
 * can follow what the agent is doing without reading the source.
 *
 * Long-running: run this in its own terminal and leave it. It auto-
 * reconnects on transient WebSocket failures (up to 10 attempts).
 *
 * Usage:
 *   node 04-run-agent.js --connect "hmsc:..."
 *
 *   # Or pass the connection string in a CONNECT env var:
 *   CONNECT="hmsc:..." node 04-run-agent.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { PrivateKey } = require('@hashgraph/sdk');
const { AgentSigningClient } = require('../../client');
const {
  PolicyEngine,
  MaxAmountRule,
  AllowedRecipientsRule,
  AllowedTransactionTypesRule,
} = require('../../client/PolicyEngine');
const EncryptedFileProvider = require('../../keyManagement/EncryptedFileProvider');
const { parseConnectionString } = require('../../shared/connection-string');

const STATE_FILE = path.join(__dirname, 'walkthrough-state.json');
const KEYS_FILE = path.join(__dirname, 'walkthrough-keys.json');
const AGENT_KEY_FILE = path.join(__dirname, 'walkthrough-keys.agent.encrypted');
const PASSPHRASE = 'walkthrough-test';

// ── Policy ─────────────────────────────────────────────────────────────
// The agent's auto-approval criteria. Tune in one place; everything
// downstream (the rejection messages, the README's expected outcomes)
// derives from these constants.
const MAX_HBAR_PER_TX = 10;
const ALLOWED_TX_TYPES = ['TransferTransaction'];

function buildAllowedRecipients(state) {
  // For the demo: operator (the off-session bystander) is the only
  // allowlisted recipient. Real treasury agents would have a payroll
  // account, a vendor account, etc.
  const recipients = [];
  if (state.operatorId) recipients.push(state.operatorId);
  return recipients;
}

async function main() {
  // Args
  const args = process.argv.slice(2);
  const connectIdx = args.indexOf('--connect');
  const connectionString = connectIdx >= 0 ? args[connectIdx + 1] : process.env.CONNECT;
  if (!connectionString) {
    console.error(chalk.red('\n❌ Missing --connect. Usage:\n'));
    console.error(chalk.gray('   node 04-run-agent.js --connect "hmsc:..."\n'));
    process.exit(2);
  }

  const parsed = parseConnectionString(connectionString);
  if (!parsed) {
    console.error(chalk.red('\n❌ Invalid connection string (must start with hmsc:).\n'));
    process.exit(2);
  }

  // State
  if (!fs.existsSync(STATE_FILE)) {
    console.error(chalk.red(`\n❌ ${STATE_FILE} not found. Run steps 1-3 first.\n`));
    process.exit(2);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  // Load agent's private key
  if (!fs.existsSync(AGENT_KEY_FILE)) {
    console.error(chalk.red(`\n❌ Agent key not found: ${AGENT_KEY_FILE}. Run step 1 first.\n`));
    process.exit(2);
  }
  const provider = new EncryptedFileProvider({
    filePath: AGENT_KEY_FILE,
    passphrase: PASSPHRASE,
  });
  await provider.loadKeys();
  const agentPrivKeyStr = (await provider.getKeys())[0];
  const agentPrivKey = PrivateKey.fromString(agentPrivKeyStr);

  // Build policy
  const allowedRecipients = buildAllowedRecipients(state);
  if (allowedRecipients.length === 0) {
    console.warn(chalk.yellow(
      '⚠  No operatorId in walkthrough-state.json — every transfer will be rejected\n' +
      '   by AllowedRecipientsRule. Re-run step 3 if this looks wrong.\n'
    ));
  }
  const policy = new PolicyEngine()
    .addRule(new AllowedTransactionTypesRule(ALLOWED_TX_TYPES))
    .addRule(new MaxAmountRule(MAX_HBAR_PER_TX))
    .addRule(new AllowedRecipientsRule(allowedRecipients));

  // Print policy summary so the operator can verify
  console.log(chalk.bold.cyan('\n━━━ Treasury agent ━━━\n'));
  console.log(chalk.bold.white('Policy:'));
  console.log(chalk.gray(`  • Allowed tx types:  ${ALLOWED_TX_TYPES.join(', ')}`));
  console.log(chalk.gray(`  • Max amount per tx: ${MAX_HBAR_PER_TX} ℏ`));
  console.log(chalk.gray(`  • Allowed recipients: ${allowedRecipients.join(', ') || '(none — agent will reject all transfers)'}`));
  console.log(chalk.bold.white('\nSigner:'));
  console.log(chalk.gray(`  • Public key: ${agentPrivKey.publicKey.toString().slice(0, 32)}…`));
  console.log(chalk.bold.white('\nSession:'));
  console.log(chalk.gray(`  • Server:  ${parsed.serverUrl}`));
  console.log(chalk.gray(`  • Session: ${parsed.sessionId.slice(0, 16)}…`));
  console.log();

  // Wire up the agent
  const agent = new AgentSigningClient({
    approvalPolicy: policy.evaluate.bind(policy),
    label: 'agent (treasury)',
    autoReady: true,
  });

  agent.on('connected', () => {
    console.log(chalk.green('✓ connected'), chalk.gray(`  participantId=${agent.participantId}`));
  });

  agent.on('ready', () => {
    console.log(chalk.green('✓ ready — waiting for transactions to evaluate'));
    console.log(chalk.gray('  (Ctrl+C to stop the agent)\n'));
  });

  agent.on('transactionReceived', ({ txDetails }) => {
    const t = txDetails || {};
    console.log(chalk.bold.white('\n→ tx received'),
      chalk.gray(`type=${t.type || 'unknown'}`));
    if (Array.isArray(t.transfers)) {
      for (const xfer of t.transfers) {
        const hbar = (Number(xfer.amount) / 100_000_000).toFixed(8).replace(/\.?0+$/, '');
        console.log(chalk.gray(`    ${xfer.accountId}: ${hbar} ℏ`));
      }
    }
  });

  agent.on('approved', ({ reason }) => {
    console.log(chalk.bold.green('✓ APPROVED by policy'),
      reason ? chalk.gray(`(${reason})`) : '');
  });

  agent.on('rejected', ({ reason }) => {
    console.log(chalk.bold.yellow('✗ REJECTED by policy'),
      chalk.gray(`(${reason || 'no reason'})`));
  });

  agent.on('signed', () => {
    console.log(chalk.green('✓ signature submitted'));
  });

  agent.on('signatureAccepted', (data) => {
    console.log(chalk.gray(
      `   server accepted (${data.signaturesCollected}/${data.signaturesRequired}` +
      `${data.thresholdMet ? ', threshold met' : ''})`,
    ));
  });

  agent.on('thresholdMet', () => {
    console.log(chalk.bold.green('🎉 threshold met — coordinator will execute'));
  });

  agent.on('transactionExecuted', ({ transactionId }) => {
    console.log(chalk.bold.green(`✅ executed: ${transactionId}\n`));
    console.log(chalk.gray('   waiting for next transaction…\n'));
  });

  agent.on('transactionExpired', () => {
    console.log(chalk.yellow('⏱  transaction expired — back to waiting\n'));
  });

  agent.on('sessionExpired', () => {
    console.log(chalk.red('⏱  session expired — exiting'));
    process.exit(0);
  });

  agent.on('error', ({ message, code }) => {
    if (code === 'RECONNECTING') {
      console.log(chalk.yellow(`… ${message}`));
    } else {
      console.error(chalk.red(`error: ${message}`));
    }
  });

  agent.on('reconnectFailed', () => {
    console.error(chalk.red('reconnect failed — exiting'));
    process.exit(1);
  });

  // Connect
  try {
    await agent.connect(parsed.serverUrl, parsed.sessionId, parsed.pin, agentPrivKey);
  } catch (err) {
    console.error(chalk.red(`\n❌ Failed to connect: ${err.message}\n`));
    process.exit(1);
  }

  // Hold open. Ctrl+C to stop.
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\nshutting down agent…'));
    agent.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(chalk.red('\n❌ '), err.message);
  process.exit(1);
});
