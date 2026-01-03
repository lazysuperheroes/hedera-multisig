/**
 * Basic Multi-Sig Usage Example
 *
 * This example demonstrates the simplest multi-sig workflow:
 * - 2-of-3 multi-sig
 * - Interactive mode (real-time)
 * - Using PromptKeyProvider for maximum security
 *
 * Configuration:
 *   Create a .env file in the project root with:
 *     OPERATOR_ID=0.0.XXX
 *     OPERATOR_KEY=xxx
 *     ENVIRONMENT=TEST
 */

// Load environment variables from .env file
require('dotenv').config();

const {
  TransactionFreezer,
  SignatureCollector,
  SignatureVerifier,
  TransactionExecutor,
  PromptKeyProvider
} = require('../index');

const {
  Client,
  AccountId,
  PrivateKey,
  ContractExecuteTransaction,
  Hbar
} = require('@hashgraph/sdk');

async function basicMultiSigExample() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║          BASIC MULTI-SIG EXAMPLE                      ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  try {
    // 1. Setup Hedera client
    console.log('Setting up Hedera client...\n');

    const myAccountId = AccountId.fromString(process.env.OPERATOR_ID || process.env.ACCOUNT_ID || '0.0.123456');
    const myPrivateKey = PrivateKey.fromString(
      process.env.OPERATOR_KEY || process.env.PRIVATE_KEY || '302e020100300506032b6570042204200000000000000000000000000000000000000000000000000000000000000000'
    );

    // Determine network (supports testnet, mainnet, previewnet, local)
    const envNetwork = (process.env.ENVIRONMENT || 'TEST').toUpperCase();
    let network;
    switch (envNetwork) {
      case 'MAIN': case 'MAINNET': network = 'mainnet'; break;
      case 'PREVIEW': case 'PREVIEWNET': network = 'previewnet'; break;
      case 'LOCAL': case 'LOCALHOST': network = 'local'; break;
      default: network = 'testnet';
    }

    let client;
    switch (network) {
      case 'mainnet': client = Client.forMainnet(); break;
      case 'previewnet': client = Client.forPreviewnet(); break;
      case 'local': client = Client.forLocalNode(); break;
      default: client = Client.forTestnet();
    }
    client.setOperator(myAccountId, myPrivateKey);

    // 2. Create a sample transaction
    console.log('Creating sample transaction...\n');

    const transaction = new ContractExecuteTransaction()
      .setContractId('0.0.123456')  // Replace with actual contract ID
      .setGas(800000)
      .setFunction('sampleFunction', Buffer.from([]))  // Replace with actual function
      .setPayableAmount(Hbar.fromTinybars(20));

    // 3. Freeze the transaction
    console.log('Freezing transaction...\n');

    const frozenTx = await TransactionFreezer.freeze(transaction, client);

    console.log('✅ Transaction frozen');
    console.log(`   Hash: ${frozenTx.hash}`);
    console.log(`   Expires: ${frozenTx.expiresAt.toISOString()}`);
    console.log(`   Time remaining: ${TransactionFreezer.formatTimeRemaining(frozenTx)}\n`);

    // 4. Get signing key via interactive prompt
    console.log('Getting signing key...\n');

    const keyProvider = new PromptKeyProvider({ count: 1 });
    const keys = await keyProvider.getKeys();

    // 5. Collect signatures (interactive mode)
    console.log('Collecting signatures (2-of-3 multi-sig)...\n');

    const signatures = await SignatureCollector.collectInteractive(
      frozenTx,
      2,  // Need 2 signatures
      {
        timeout: 100,     // 100 second timeout
        localKeys: keys,  // Sign with our key automatically
        verbose: false    // Don't show verbose transaction details
      }
    );

    console.log(`✅ Collected ${signatures.length} signatures\n`);

    // 6. Verify signatures
    console.log('Verifying signatures...\n');

    const verification = await SignatureVerifier.verify(frozenTx, signatures, {
      threshold: 2
    });

    if (!verification.valid) {
      console.error('❌ Signature verification failed!');
      console.error(`   Errors: ${verification.errors.join(', ')}\n`);
      process.exit(1);
    }

    console.log('✅ All signatures verified');
    console.log(`   Valid: ${verification.validCount}/${verification.totalCount}\n`);

    // 7. Execute transaction
    console.log('Executing multi-sig transaction...\n');

    const result = await TransactionExecutor.execute(
      frozenTx,
      signatures,
      client,
      {
        metadata: {
          executedBy: myAccountId.toString(),
          workflow: 'interactive',
          example: 'basic-usage'
        }
      }
    );

    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║              EXECUTION SUCCESSFUL!                    ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log(`Transaction ID: ${result.transactionId}`);
    console.log(`Status: ${result.status}`);
    console.log(`Execution Time: ${result.executionTimeMs}ms\n`);

    console.log('Audit log entry created at: logs/multisig-audit.jsonl\n');

    // 8. Display audit log summary
    console.log('Recent audit log entries:\n');
    TransactionExecutor.displayAuditSummary({ recentCount: 5 });

  } catch (error) {
    console.error('\n❌ Error: ' + error.message);
    console.error(error.stack + '\n');
    process.exit(1);
  }
}

// Run example if executed directly
if (require.main === module) {
  console.log('⚠️  NOTE: This is a demo example. Update with your actual:');
  console.log('   - Account ID and private key');
  console.log('   - Contract ID and function');
  console.log('   - Multi-sig configuration\n');

  const readline = require('readline-sync');
  const proceed = readline.keyInYN('Proceed with example? ');

  if (proceed) {
    basicMultiSigExample().catch(console.error);
  } else {
    console.log('\nExample cancelled.\n');
  }
}

module.exports = basicMultiSigExample;
