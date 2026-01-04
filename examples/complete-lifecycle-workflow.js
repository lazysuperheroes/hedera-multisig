#!/usr/bin/env node

/**
 * Complete Multi-Sig Lifecycle Workflow
 *
 * This example demonstrates the complete lifecycle of a multi-sig account:
 * 1. Team setup (key generation and collection) - via CLI tools
 * 2. Account creation or conversion - via CLI tools
 * 3. Transaction execution - via networked workflow
 *
 * This shows how the CLI tools (drop-in replacement for manual workflows)
 * integrate with the networked workflow (for superior coordination).
 *
 * Configuration:
 *   Create a .env file in the project root with:
 *     OPERATOR_ID=0.0.XXX
 *     OPERATOR_KEY=xxx
 *     ENVIRONMENT=TEST
 *
 * Prerequisites:
 *   - At least 3 team members with generated keys
 *
 * Usage:
 *   node examples/complete-lifecycle-workflow.js
 */

// Load environment variables from .env file
require('dotenv').config();

const {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  Hbar
} = require('@hashgraph/sdk');

const chalk = require('chalk');
const { WorkflowOrchestrator } = require('../workflows');

// This is a demonstration script showing the workflow, not a runnable script
// In practice, you would run the CLI tools separately and then use this pattern

async function demonstrateLifecycle() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║         COMPLETE MULTI-SIG LIFECYCLE DEMONSTRATION            ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════╝\n'));

  console.log(chalk.yellow('This example demonstrates how to use the hedera-multisig library\n'));
  console.log(chalk.yellow('for the complete lifecycle of a multi-sig account.\n'));

  // ============================================================================
  // PHASE 1: TEAM SETUP (Using CLI Tools)
  // ============================================================================

  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold.white('PHASE 1: TEAM SETUP'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log('');

  console.log(chalk.white('Step 1: Each team member generates their own key pair'));
  console.log(chalk.gray('  Command: npm run generate-keys\n'));
  console.log(chalk.gray('  Each member runs this independently and securely stores their keys.'));
  console.log(chalk.gray('  The script generates both mnemonic recovery phrases and key files.\n'));

  console.log(chalk.white('Step 2: Coordinator collects public keys from team'));
  console.log(chalk.gray('  Command: npm run collect-keys\n'));
  console.log(chalk.gray('  The coordinator uses this tool to gather public keys from all'));
  console.log(chalk.gray('  team members. Private keys are NEVER shared.\n'));

  console.log(chalk.white('Example team configuration:'));
  console.log(chalk.gray('  - Team Size: 5 members'));
  console.log(chalk.gray('  - Threshold: 3-of-5 signatures required'));
  console.log(chalk.gray('  - Each member has: private key + mnemonic backup\n'));

  // ============================================================================
  // PHASE 2: ACCOUNT SETUP (Using CLI Tools)
  // ============================================================================

  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold.white('PHASE 2: ACCOUNT SETUP'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log('');

  console.log(chalk.white('Option A: Create NEW multi-sig account'));
  console.log(chalk.gray('  Command: npm run create-account\n'));
  console.log(chalk.gray('  Creates a brand new Hedera account with multi-sig from the start.'));
  console.log(chalk.gray('  - Specify initial balance (e.g., 100 HBAR)'));
  console.log(chalk.gray('  - Load public keys from file'));
  console.log(chalk.gray('  - Set threshold (e.g., 3-of-5)'));
  console.log(chalk.gray('  - Account is immediately ready for multi-sig operations\n'));

  console.log(chalk.white('Option B: Convert EXISTING single-sig account'));
  console.log(chalk.gray('  Command: npm run setup-multisig\n'));
  console.log(chalk.gray('  Converts an existing single-signature account to multi-sig.'));
  console.log(chalk.gray('  - Requires current account private key'));
  console.log(chalk.gray('  - Load new public keys from file'));
  console.log(chalk.gray('  - Set threshold'));
  console.log(chalk.gray('  - After conversion, only multi-sig can control account\n'));

  console.log(chalk.green('✅ Account is now configured as 3-of-5 multi-sig\n'));
  console.log(chalk.gray('   Account ID: 0.0.12345 (example)'));
  console.log(chalk.gray('   Configuration saved to: multisig-config-0-0-12345.json\n'));

  // ============================================================================
  // PHASE 3: TRANSACTION EXECUTION (Using Networked Workflow)
  // ============================================================================

  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold.white('PHASE 3: TRANSACTION EXECUTION'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log('');

  console.log(chalk.white('Now we use the NETWORKED WORKFLOW for superior coordination:\n'));

  console.log(chalk.yellow('Step 1: Coordinator creates pre-session (NO transaction yet)'));
  console.log(chalk.gray('  This allows team members 30+ minutes to connect and load keys\n'));

  // Example code showing how to use programmatically
  console.log(chalk.white('Example Code:\n'));
  console.log(chalk.gray('```javascript'));
  console.log(chalk.gray('const { WorkflowOrchestrator } = require(\'@lazysuperheroes/hedera-multisig\');'));
  console.log(chalk.gray(''));
  console.log(chalk.gray('// Load multi-sig configuration'));
  console.log(chalk.gray('const config = JSON.parse(fs.readFileSync(\'multisig-config-0-0-12345.json\'));'));
  console.log(chalk.gray(''));
  console.log(chalk.gray('// Create pre-session (participants connect BEFORE transaction)'));
  console.log(chalk.gray('const orchestrator = new WorkflowOrchestrator(client, accountId, publicKeys, threshold);'));
  console.log(chalk.gray('const { sessionId, pin, publicUrl } = await orchestrator.createNetworkedSession({'));
  console.log(chalk.gray('  expectedParticipants: 5,'));
  console.log(chalk.gray('  sessionTimeout: 1800, // 30 minutes'));
  console.log(chalk.gray('  enableTunnel: true   // For remote participants'));
  console.log(chalk.gray('});'));
  console.log(chalk.gray(''));
  console.log(chalk.gray('console.log(`Share with team: ${publicUrl}, Session: ${sessionId}, PIN: ${pin}`);'));
  console.log(chalk.gray('```\n'));

  console.log(chalk.yellow('Step 2: Team members connect as participants'));
  console.log(chalk.gray('  Command: npm run multisig-client -- --url <url> --session <id> --pin <pin>\n'));
  console.log(chalk.gray('  Each participant:'));
  console.log(chalk.gray('  1. Connects to the session'));
  console.log(chalk.gray('  2. Authenticates with PIN'));
  console.log(chalk.gray('  3. Loads their private key (locally, never transmitted)'));
  console.log(chalk.gray('  4. Marks as READY\n'));

  console.log(chalk.yellow('Step 3: Coordinator waits for participants to be ready'));
  console.log(chalk.gray('  The coordinator monitors connections in real-time:'));
  console.log(chalk.gray('  - Participant 1: CONNECTED → READY ✅'));
  console.log(chalk.gray('  - Participant 2: CONNECTED → READY ✅'));
  console.log(chalk.gray('  - Participant 3: CONNECTED → READY ✅'));
  console.log(chalk.gray('  - Participant 4: OFFLINE'));
  console.log(chalk.gray('  - Participant 5: OFFLINE\n'));
  console.log(chalk.gray('  3 of 5 participants ready → threshold met!\n'));

  console.log(chalk.yellow('Step 4: Coordinator creates and injects transaction'));
  console.log(chalk.gray('  NOW we create the transaction (within 120-second window):\n'));

  console.log(chalk.gray('```javascript'));
  console.log(chalk.gray('// Create transaction (only when participants are ready!)'));
  console.log(chalk.gray('const transaction = new TransferTransaction()'));
  console.log(chalk.gray('  .addHbarTransfer(accountId, new Hbar(-50))'));
  console.log(chalk.gray('  .addHbarTransfer(recipientId, new Hbar(50));'));
  console.log(chalk.gray(''));
  console.log(chalk.gray('// Inject into existing session'));
  console.log(chalk.gray('const result = await orchestrator.executeWithSession(transaction, {'));
  console.log(chalk.gray('  metadata: {'));
  console.log(chalk.gray('    description: \'Team payment\','));
  console.log(chalk.gray('    recipient: recipientId.toString(),'));
  console.log(chalk.gray('    amount: \'50 HBAR\''));
  console.log(chalk.gray('  }'));
  console.log(chalk.gray('});'));
  console.log(chalk.gray('```\n'));

  console.log(chalk.yellow('Step 5: Participants review and approve'));
  console.log(chalk.gray('  Each participant sees:'));
  console.log(chalk.gray('  - Fully decoded transaction (amounts, accounts)'));
  console.log(chalk.gray('  - Metadata from coordinator (UNVERIFIED warning if mismatch)'));
  console.log(chalk.gray('  - Transaction checksum'));
  console.log(chalk.gray('  - Must type "YES" to approve (prevents accidental approval)\n'));

  console.log(chalk.yellow('Step 6: Automatic execution when threshold met'));
  console.log(chalk.gray('  When 3 signatures collected:'));
  console.log(chalk.gray('  ✅ Participant 1 signed'));
  console.log(chalk.gray('  ✅ Participant 2 signed'));
  console.log(chalk.gray('  ✅ Participant 3 signed'));
  console.log(chalk.gray('  → Threshold met (3-of-5)'));
  console.log(chalk.gray('  → Transaction automatically executed'));
  console.log(chalk.gray('  → All participants notified\n'));

  console.log(chalk.green('✅ Transaction complete!\n'));
  console.log(chalk.gray('   Transaction ID: 0.0.98765@1234567890.000000000'));
  console.log(chalk.gray('   Status: SUCCESS'));
  console.log(chalk.gray('   50 HBAR transferred\n'));

  // ============================================================================
  // PHASE 4: ONGOING OPERATIONS
  // ============================================================================

  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold.white('PHASE 4: ONGOING OPERATIONS'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log('');

  console.log(chalk.white('Key Rotation:'));
  console.log(chalk.gray('  Command: npm run update-keys\n'));
  console.log(chalk.gray('  When team membership changes:'));
  console.log(chalk.gray('  - Load NEW public keys'));
  console.log(chalk.gray('  - Requires signatures from CURRENT key holders'));
  console.log(chalk.gray('  - Can use networked workflow for signature collection\n'));

  console.log(chalk.white('Offline Signing:'));
  console.log(chalk.gray('  For air-gapped security or when networked workflow unavailable:'));
  console.log(chalk.gray('  1. Export transaction: orchestrator.exportTransaction()'));
  console.log(chalk.gray('  2. Sign offline: npm run sign-tx --file transaction.json'));
  console.log(chalk.gray('  3. Collect signatures manually'));
  console.log(chalk.gray('  4. Execute when threshold met\n'));

  console.log(chalk.white('Transaction Inspection:'));
  console.log(chalk.gray('  Command: npm run query-tx --file transaction.json\n'));
  console.log(chalk.gray('  Decode and inspect transaction bytes without signing.'));
  console.log(chalk.gray('  Useful for verifying transaction contents before approval.\n'));

  console.log(chalk.white('Revert to Single-Sig:'));
  console.log(chalk.gray('  Command: npm run revert-multisig\n'));
  console.log(chalk.gray('  If needed, convert back to single-signature account.'));
  console.log(chalk.gray('  Requires M-of-N signatures from current key holders.\n'));

  // ============================================================================
  // WORKFLOW COMPARISON
  // ============================================================================

  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold.white('WORKFLOW COMPARISON'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log('');

  console.log(chalk.white('CLI Tools (Drop-in Replacement):'));
  console.log(chalk.gray('  ✅ Simple, familiar command-line interface'));
  console.log(chalk.gray('  ✅ Works with existing scripts/automation'));
  console.log(chalk.gray('  ✅ No infrastructure required'));
  console.log(chalk.gray('  ⚠️  Manual coordination required'));
  console.log(chalk.gray('  ⚠️  Copy-paste signature exchange\n'));

  console.log(chalk.white('Networked Workflow (Superior Coordination):'));
  console.log(chalk.gray('  ✅ Real-time collaboration'));
  console.log(chalk.gray('  ✅ Automatic signature collection'));
  console.log(chalk.gray('  ✅ Remote participants (tunnel support)'));
  console.log(chalk.gray('  ✅ Transaction decoded and validated'));
  console.log(chalk.gray('  ✅ Event-driven monitoring'));
  console.log(chalk.gray('  ⚠️  Requires WebSocket server (temporary)\n'));

  console.log(chalk.white('Best Practice:'));
  console.log(chalk.gray('  - Use CLI tools for: account setup, key management, offline signing'));
  console.log(chalk.gray('  - Use networked workflow for: regular transactions, team coordination'));
  console.log(chalk.gray('  - Combine both: CLI for setup, networked for operations\n'));

  // ============================================================================
  // SUMMARY
  // ============================================================================

  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold.green('✅ COMPLETE LIFECYCLE SUMMARY'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log('');

  console.log(chalk.white('What you learned:'));
  console.log(chalk.gray('  1. Generate keys: npm run generate-keys'));
  console.log(chalk.gray('  2. Collect team keys: npm run collect-keys'));
  console.log(chalk.gray('  3. Setup account: npm run create-account OR npm run setup-multisig'));
  console.log(chalk.gray('  4. Execute transactions: Use WorkflowOrchestrator with networked workflow'));
  console.log(chalk.gray('  5. Ongoing management: npm run update-keys, sign-tx, query-tx\n'));

  console.log(chalk.white('Next Steps:'));
  console.log(chalk.gray('  1. Follow SETUP_GUIDE.md for step-by-step team onboarding'));
  console.log(chalk.gray('  2. See TESTING.md for testing procedures'));
  console.log(chalk.gray('  3. Try examples/networked-multisig-coordinator.js for working code'));
  console.log(chalk.gray('  4. Use cli/account-manager.js for unified menu interface\n'));

  console.log(chalk.green('🎉 You now have everything you need for production multi-sig!\n'));
}

// Run demonstration
demonstrateLifecycle().catch(error => {
  console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
  process.exit(1);
});
