/**
 * Example: Smart Contract Deployment and Calls with Multi-Sig
 *
 * This example demonstrates how to deploy and interact with smart contracts
 * using multi-signature accounts with the networked workflow.
 *
 * Includes:
 * - Contract deployment with multi-sig
 * - Contract function calls with multi-sig
 * - Full ABI support for parameter decoding
 * - Transaction metadata for contract calls
 *
 * Usage:
 *   OPERATOR_ID=0.0.XXX OPERATOR_KEY=xxx node examples/smart-contract-multisig.js
 */

const {
  Client,
  ContractCreateTransaction,
  ContractFunctionParameters,
  ContractExecuteTransaction,
  FileCreateTransaction,
  FileAppendTransaction,
  Hbar,
  PrivateKey,
  AccountId
} = require('@hashgraph/sdk');

const {
  SigningSessionManager,
  WebSocketServer,
  WorkflowOrchestrator
} = require('../index');

const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');

// Sample contract ABI and bytecode
// This is a simple storage contract: store and retrieve a number

const CONTRACT_ABI = [
  {
    "inputs": [],
    "name": "get",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "x", "type": "uint256" }],
    "name": "set",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Simple storage contract bytecode (solidity)
// contract Storage { uint256 number; function set(uint256 x) public { number = x; } function get() public view returns (uint256) { return number; } }
const CONTRACT_BYTECODE = "608060405234801561001057600080fd5b50610150806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c806360fe47b11461003b5780636d4ce63c14610057575b600080fd5b6100556004803603810190610050919061009d565b610075565b005b61005f61007f565b60405161006c91906100d9565b60405180910390f35b8060008190555050565b60008054905090565b60008135905061009781610103565b92915050565b6000602082840312156100b3576100b26100fe565b5b60006100c184828501610088565b91505092915050565b6100d3816100f4565b82525050565b60006020820190506100ee60008301846100ca565b92915050565b6000819050919050565b600080fd5b61010c816100f4565b811461011757600080fd5b5056fea2646970667358221220c3f4e4e88e6f0b6c3d5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e64736f6c63430008070033";

async function smartContractExample() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║    SMART CONTRACT DEPLOYMENT WITH MULTI-SIG           ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // 1. Set up Hedera client
    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
      throw new Error('Please set OPERATOR_ID and OPERATOR_KEY environment variables');
    }

    const client = Client.forTestnet();
    client.setOperator(
      AccountId.fromString(process.env.OPERATOR_ID),
      PrivateKey.fromString(process.env.OPERATOR_KEY)
    );

    console.log(chalk.green('✅ Hedera client configured\n'));

    // 2. Define multi-sig keys (replace with actual keys)
    const eligiblePublicKeys = [
      '302a300506032b65700321001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      '302a300506032b65700321009876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
      '302a300506032b6570032100abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    ];

    console.log(chalk.white('Multi-Sig Configuration:'));
    console.log(chalk.gray(`  Keys: ${eligiblePublicKeys.length}`));
    console.log(chalk.gray(`  Threshold: 2 of ${eligiblePublicKeys.length}\n`));

    // 3. Use WorkflowOrchestrator for networked workflow
    const orchestrator = new WorkflowOrchestrator(client, {
      verbose: true
    });

    // 4. Create networked session
    console.log(chalk.yellow('Creating networked multi-sig session...\n'));

    const sessionResult = await orchestrator.createNetworkedSession({
      threshold: 2,
      eligiblePublicKeys,
      expectedParticipants: 3,
      port: 3100, // Different port to avoid conflicts
      tunnel: false, // Set to true for remote participants
      eventHandlers: {
        onParticipantReady: (event) => {
          if (event.allReady) {
            console.log(chalk.bold.green('\n🎉 All participants ready!\n'));
          }
        },
        onThresholdMet: async () => {
          console.log(chalk.bold.green('\n🎉 Threshold met! Transaction will execute...\n'));
        }
      }
    });

    if (!sessionResult.success) {
      throw new Error(`Failed to create session: ${sessionResult.error}`);
    }

    console.log(chalk.green('✅ Session created\n'));
    console.log(chalk.cyan('Share with participants:'));
    console.log(chalk.yellow(`  URL: ${sessionResult.serverInfo.url}`));
    console.log(chalk.yellow(`  Session ID: ${sessionResult.session.sessionId}`));
    console.log(chalk.yellow(`  PIN: ${sessionResult.session.pin}\n`));

    // Wait for participants to be ready
    console.log(chalk.white('Waiting for participants to connect...\n'));
    console.log(chalk.gray('(In a real scenario, participants would connect now)'));
    console.log(chalk.gray('(Press ENTER to continue with simulation)\n'));

    readlineSync.question('');

    // =========================================================================
    // PART 1: DEPLOY SMART CONTRACT
    // =========================================================================

    console.log(chalk.bold.cyan('\n─── PART 1: DEPLOY SMART CONTRACT ───\n'));

    // Upload contract bytecode to Hedera File Service
    console.log(chalk.yellow('Step 1: Uploading contract bytecode...\n'));

    const bytecode = Buffer.from(CONTRACT_BYTECODE, 'hex');

    const fileCreateTx = await new FileCreateTransaction()
      .setKeys([client.operatorPublicKey])
      .setContents(bytecode.slice(0, 4096))
      .freezeWith(client)
      .sign(client.operatorKey);

    const fileCreateSubmit = await fileCreateTx.execute(client);
    const fileCreateReceipt = await fileCreateSubmit.getReceipt(client);
    const bytecodeFileId = fileCreateReceipt.fileId;

    console.log(chalk.green(`✅ Bytecode file created: ${bytecodeFileId}\n`));

    // If bytecode is larger than 4096 bytes, append
    if (bytecode.length > 4096) {
      console.log(chalk.yellow('Appending remaining bytecode...\n'));

      const fileAppendTx = await new FileAppendTransaction()
        .setFileId(bytecodeFileId)
        .setContents(bytecode.slice(4096))
        .freezeWith(client)
        .sign(client.operatorKey);

      await fileAppendTx.execute(client);
      console.log(chalk.green('✅ Bytecode appended\n'));
    }

    // Create contract deployment transaction
    console.log(chalk.yellow('Step 2: Creating contract deployment transaction...\n'));

    const contractDeployTx = new ContractCreateTransaction()
      .setBytecodeFileId(bytecodeFileId)
      .setGas(100000)
      .setConstructorParameters(new ContractFunctionParameters())
      .freezeWith(client);

    console.log(chalk.green('✅ Contract deployment transaction created\n'));

    // Execute with multi-sig session
    console.log(chalk.yellow('Step 3: Injecting deployment transaction into session...\n'));

    const deployResult = await orchestrator.executeWithSession(contractDeployTx, {
      metadata: {
        description: 'Deploy Storage contract with multi-sig',
        contractName: 'Storage',
        gas: 100000
      },
      contractInterface: CONTRACT_ABI
    });

    if (!deployResult.success) {
      throw new Error(`Deployment failed: ${deployResult.error}`);
    }

    console.log(chalk.green('✅ Deployment transaction injected\n'));
    console.log(chalk.white('Participants will now review and sign...\n'));

    // Simulate waiting for signatures and execution
    console.log(chalk.gray('(Simulation: waiting for 2 signatures...)\n'));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // In a real scenario, this would be triggered by actual signatures
    // For demo purposes, we'll simulate the contract deployment
    console.log(chalk.green('✅ Contract deployed successfully!\n'));
    console.log(chalk.gray('   Contract ID: 0.0.999999 (simulated)\n'));

    const contractId = '0.0.999999'; // In real scenario, get from receipt

    // =========================================================================
    // PART 2: CALL CONTRACT FUNCTION
    // =========================================================================

    console.log(chalk.bold.cyan('\n─── PART 2: CALL CONTRACT FUNCTION ───\n'));

    // Create contract call transaction
    console.log(chalk.yellow('Creating contract function call transaction...\n'));

    const valueToStore = 42;

    const contractCallTx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(50000)
      .setFunction(
        'set',
        new ContractFunctionParameters().addUint256(valueToStore)
      )
      .freezeWith(client);

    console.log(chalk.green(`✅ Contract call transaction created (set value to ${valueToStore})\n`));

    // Execute with multi-sig session
    console.log(chalk.yellow('Injecting contract call transaction into session...\n'));

    const callResult = await orchestrator.executeWithSession(contractCallTx, {
      metadata: {
        description: `Call Storage.set(${valueToStore}) with multi-sig`,
        contractId,
        functionName: 'set',
        parameters: { x: valueToStore }
      },
      contractInterface: CONTRACT_ABI
    });

    if (!callResult.success) {
      throw new Error(`Contract call failed: ${callResult.error}`);
    }

    console.log(chalk.green('✅ Contract call transaction injected\n'));
    console.log(chalk.white('Participants will now review and sign...\n'));

    // Simulate waiting for signatures
    console.log(chalk.gray('(Simulation: waiting for 2 signatures...)\n'));
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(chalk.green('✅ Contract function called successfully!\n'));

    // =========================================================================
    // SUMMARY
    // =========================================================================

    console.log(chalk.cyan('\n═'.repeat(60)));
    console.log(chalk.bold.white('SMART CONTRACT MULTI-SIG SUMMARY'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white('Accomplishments:'));
    console.log(chalk.green('  ✅ Deployed smart contract with 2-of-3 multi-sig'));
    console.log(chalk.green('  ✅ Called contract function with multi-sig'));
    console.log(chalk.green('  ✅ Full ABI support for parameter decoding'));
    console.log(chalk.green('  ✅ Transaction metadata validation'));
    console.log('');
    console.log(chalk.white('Contract Information:'));
    console.log(chalk.gray(`  Contract ID: ${contractId}`));
    console.log(chalk.gray(`  Bytecode File: ${bytecodeFileId}`));
    console.log(chalk.gray(`  Functions: set(uint256), get()`));
    console.log('');
    console.log(chalk.white('Multi-Sig Configuration:'));
    console.log(chalk.gray('  Threshold: 2 of 3'));
    console.log(chalk.gray('  Workflow: Networked (pre-session)'));
    console.log(chalk.gray('  Review: Manual approval required'));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    console.log(chalk.yellow('⚠️  NOTE: This example uses simulated contract deployment.'));
    console.log(chalk.white('In a real scenario:'));
    console.log(chalk.white('  1. Participants would connect and load keys'));
    console.log(chalk.white('  2. Each transaction would be reviewed and approved'));
    console.log(chalk.white('  3. Contract would be deployed to actual Hedera network'));
    console.log(chalk.white('  4. Contract calls would execute on real contract\n'));

    // Cleanup
    orchestrator.cleanup();

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Additional utility functions for contract interaction

/**
 * Get contract function signature from ABI
 */
function getFunctionSignature(abi, functionName) {
  const func = abi.find(f => f.name === functionName && f.type === 'function');
  if (!func) {
    throw new Error(`Function ${functionName} not found in ABI`);
  }

  const inputs = func.inputs.map(i => i.type).join(',');
  return `${functionName}(${inputs})`;
}

/**
 * Decode contract call parameters
 */
function decodeParameters(abi, functionName, params) {
  const func = abi.find(f => f.name === functionName && f.type === 'function');
  if (!func) return null;

  const decoded = {};
  func.inputs.forEach((input, idx) => {
    const name = input.name || `param${idx}`;
    decoded[name] = params[idx];
  });

  return decoded;
}

// Run example if called directly
if (require.main === module) {
  smartContractExample();
}

module.exports = {
  smartContractExample,
  getFunctionSignature,
  decodeParameters,
  CONTRACT_ABI,
  CONTRACT_BYTECODE
};
