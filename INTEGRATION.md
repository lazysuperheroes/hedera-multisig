# Integration Guide

This guide shows how to integrate the Hedera Multi-Sig library into your existing Hedera project.

## Table of Contents

- [Quick Integration](#quick-integration)
- [Project Structure](#project-structure)
- [Integration Patterns](#integration-patterns)
- [Adding Multi-Sig to Existing Scripts](#adding-multi-sig-to-existing-scripts)
- [Creating Project-Specific Adapters](#creating-project-specific-adapters)
- [Configuration](#configuration)
- [Testing](#testing)

## Quick Integration

### Step 1: Copy Library to Your Project

```bash
# From your project root
cp -r /path/to/lib/multiSig ./lib/
cd lib/multiSig
npm install
```

### Step 2: Create Project Bridge

Create `utils/multiSigIntegration.js` in your project:

```javascript
/**
 * Bridge between your project and lib/multiSig
 *
 * This file provides project-specific integration while keeping
 * lib/multiSig completely isolated and portable.
 */

const {
  TransactionFreezer,
  TransactionDecoder,
  SignatureCollector,
  SignatureVerifier,
  TransactionExecutor,
  PromptKeyProvider,
  EnvKeyProvider
} = require('../lib/multiSig');

/**
 * Execute a transaction with multi-sig support
 *
 * @param {Transaction} transaction - Hedera SDK transaction
 * @param {Client} client - Hedera client
 * @param {Object} multiSigConfig - Multi-sig configuration
 * @param {boolean} multiSigConfig.enabled - Enable multi-sig
 * @param {number} multiSigConfig.threshold - Required signatures
 * @param {string} multiSigConfig.workflow - 'offline' or 'interactive'
 * @param {KeyProvider} multiSigConfig.keyProvider - Key provider
 * @param {Interface} multiSigConfig.contractInterface - ethers.js Interface (optional)
 * @returns {Promise<ExecutionResult>}
 */
async function executeWithMultiSig(transaction, client, multiSigConfig) {
  // 1. Freeze transaction
  const frozenTx = await TransactionFreezer.freeze(transaction, client, {
    contractInterface: multiSigConfig.contractInterface
  });

  // 2. Get local keys if provider specified
  let localKeys = [];
  if (multiSigConfig.keyProvider) {
    localKeys = await multiSigConfig.keyProvider.getKeys();
  }

  // 3. Collect signatures based on workflow
  let signatures;
  if (multiSigConfig.workflow === 'offline') {
    signatures = await SignatureCollector.collectOffline(
      frozenTx,
      multiSigConfig.threshold,
      { localKeys, verbose: true }
    );
  } else {
    signatures = await SignatureCollector.collectInteractive(
      frozenTx,
      multiSigConfig.threshold,
      { localKeys, timeout: 100, verbose: true }
    );
  }

  // 4. Verify signatures
  const verification = await SignatureVerifier.verify(frozenTx, signatures, {
    threshold: multiSigConfig.threshold
  });

  if (!verification.valid) {
    throw new Error(`Signature verification failed: ${verification.errors.join(', ')}`);
  }

  // 5. Execute
  const result = await TransactionExecutor.execute(frozenTx, signatures, client, {
    metadata: {
      workflow: multiSigConfig.workflow,
      project: 'YourProject'
    }
  });

  return result;
}

module.exports = {
  executeWithMultiSig,
  TransactionFreezer,
  SignatureCollector,
  SignatureVerifier,
  TransactionExecutor,
  PromptKeyProvider,
  EnvKeyProvider
};
```

### Step 3: Use in Your Scripts

```javascript
const { executeWithMultiSig, PromptKeyProvider } = require('./utils/multiSigIntegration');
const { ContractExecuteTransaction } = require('@hashgraph/sdk');

// Your existing transaction code
const transaction = new ContractExecuteTransaction()
  .setContractId(contractId)
  .setGas(800000)
  .setFunction('yourFunction', params);

// Check if multi-sig flag is set
const useMultiSig = process.argv.includes('--multisig');

if (useMultiSig) {
  // Multi-sig execution
  const result = await executeWithMultiSig(transaction, client, {
    enabled: true,
    threshold: 2,
    workflow: 'interactive',
    keyProvider: new PromptKeyProvider({ count: 1 })
  });

  console.log(`Transaction: ${result.transactionId}`);
} else {
  // Single-sig execution (existing code)
  const txResponse = await transaction.execute(client);
  const receipt = await txResponse.getReceipt(client);
  console.log(`Transaction: ${txResponse.transactionId.toString()}`);
}
```

## Project Structure

Recommended project structure after integration:

```
your-project/
├── lib/
│   └── multiSig/                  # ISOLATED LIBRARY (no project dependencies)
│       ├── core/
│       ├── keyManagement/
│       ├── cli/
│       ├── examples/
│       ├── package.json
│       ├── README.md
│       ├── INTEGRATION.md
│       └── index.js
├── utils/
│   └── multiSigIntegration.js     # PROJECT-SPECIFIC BRIDGE
├── scripts/
│   ├── admin/
│   │   ├── createContract.js      # Add --multisig support
│   │   └── updateConfig.js        # Add --multisig support
│   └── user/
│       └── callContract.js        # Single-sig only
├── .env                           # Add MULTISIG_KEY_* variables
├── .gitignore                     # Ensure .env is included
└── package.json
```

**Key Principle**: `lib/multiSig/` has ZERO dependencies on your project. All project-specific code goes in `utils/multiSigIntegration.js`.

## Integration Patterns

### Pattern 1: Wrapper Function (Recommended)

Modify your existing helper functions to accept optional multi-sig config:

```javascript
// Before (single-sig only)
async function contractExecuteFunction(contractId, client, gas, fcnName, params) {
  const transaction = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(gas)
    .setFunction(fcnName, params);

  const txResponse = await transaction.execute(client);
  const receipt = await txResponse.getReceipt(client);
  return receipt;
}

// After (multi-sig support added)
async function contractExecuteFunction(
  contractId, client, gas, fcnName, params,
  options = {}  // NEW: optional multi-sig config
) {
  const transaction = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(gas)
    .setFunction(fcnName, params);

  // Multi-sig path
  if (options.multiSig?.enabled) {
    const { executeWithMultiSig } = require('./multiSigIntegration');
    const result = await executeWithMultiSig(transaction, client, options.multiSig);
    return result.receipt;
  }

  // Single-sig path (unchanged)
  const txResponse = await transaction.execute(client);
  const receipt = await txResponse.getReceipt(client);
  return receipt;
}
```

### Pattern 2: Separate Functions

Keep single-sig and multi-sig as separate functions:

```javascript
// Single-sig (existing)
async function executeSingle(transaction, client) {
  const txResponse = await transaction.execute(client);
  return await txResponse.getReceipt(client);
}

// Multi-sig (new)
async function executeMultiSig(transaction, client, multiSigConfig) {
  const { executeWithMultiSig } = require('./multiSigIntegration');
  return await executeWithMultiSig(transaction, client, multiSigConfig);
}

// Unified interface
async function execute(transaction, client, options = {}) {
  if (options.multiSig?.enabled) {
    return await executeMultiSig(transaction, client, options.multiSig);
  }
  return await executeSingle(transaction, client);
}
```

### Pattern 3: CLI Flag Detection

Add multi-sig support via command-line flags:

```javascript
// Parse CLI arguments
const args = process.argv.slice(2);
const useMultiSig = args.includes('--multisig');
const workflowType = args.includes('--offline') ? 'offline' : 'interactive';

// Configure multi-sig if enabled
let executionOptions = {};

if (useMultiSig) {
  const { PromptKeyProvider } = require('./utils/multiSigIntegration');

  console.log('\n🔐 Multi-Sig Configuration\n');

  const readline = require('readline-sync');
  const threshold = parseInt(readline.question('Required signatures (e.g., 2): '));

  executionOptions.multiSig = {
    enabled: true,
    threshold,
    workflow: workflowType,
    keyProvider: new PromptKeyProvider({ count: 1 })
  };
}

// Execute with config
await contractExecuteFunction(
  contractId, client, gas, fcnName, params,
  executionOptions
);
```

## Adding Multi-Sig to Existing Scripts

### Example: Admin Script Conversion

**Before**:

```javascript
// scripts/admin/createPool.js
const { ContractExecuteTransaction } = require('@hashgraph/sdk');
const { setupClient } = require('../../utils/nodeHelpers');

async function main() {
  const client = await setupClient();

  const transaction = new ContractExecuteTransaction()
    .setContractId('0.0.123456')
    .setGas(800000)
    .setFunction('createPool', params);

  const txResponse = await transaction.execute(client);
  const receipt = await txResponse.getReceipt(client);

  console.log(`Pool created! Transaction: ${txResponse.transactionId.toString()}`);
}

main();
```

**After (with multi-sig support)**:

```javascript
// scripts/admin/createPool.js
const { ContractExecuteTransaction } = require('@hashgraph/sdk');
const { setupClient } = require('../../utils/nodeHelpers');
const { executeWithMultiSig, PromptKeyProvider } = require('../../utils/multiSigIntegration');
const readline = require('readline-sync');

async function main() {
  const client = await setupClient();

  // Parse CLI flags
  const useMultiSig = process.argv.includes('--multisig');

  const transaction = new ContractExecuteTransaction()
    .setContractId('0.0.123456')
    .setGas(800000)
    .setFunction('createPool', params);

  if (useMultiSig) {
    // Multi-sig execution
    console.log('\n🔐 Multi-Sig Mode\n');

    const threshold = parseInt(readline.question('Required signatures: '));
    const workflow = readline.question('Workflow (offline/interactive): ');

    const result = await executeWithMultiSig(transaction, client, {
      enabled: true,
      threshold,
      workflow,
      keyProvider: new PromptKeyProvider({ count: 1 })
    });

    console.log(`✅ Pool created! Transaction: ${result.transactionId}`);
  } else {
    // Single-sig execution (original code)
    const txResponse = await transaction.execute(client);
    const receipt = await txResponse.getReceipt(client);

    console.log(`✅ Pool created! Transaction: ${txResponse.transactionId.toString()}`);
  }
}

main();
```

**Usage**:

```bash
# Single-sig (unchanged)
node scripts/admin/createPool.js

# Multi-sig interactive
node scripts/admin/createPool.js --multisig

# Multi-sig offline
node scripts/admin/createPool.js --multisig --offline
```

## Creating Project-Specific Adapters

For complex integrations, create adapters that encapsulate your project's patterns:

```javascript
// utils/adapters/ContractCallAdapter.js

const { executeWithMultiSig } = require('../multiSigIntegration');
const { ContractExecuteTransaction } = require('@hashgraph/sdk');
const { ethers } = require('ethers');

class ContractCallAdapter {
  constructor(contractId, contractABI, client) {
    this.contractId = contractId;
    this.contractInterface = new ethers.Interface(contractABI);
    this.client = client;
  }

  /**
   * Execute contract function with optional multi-sig
   */
  async execute(functionName, params, options = {}) {
    // Encode function parameters
    const encodedParams = this.contractInterface.encodeFunctionData(
      functionName,
      params
    );

    // Create transaction
    const transaction = new ContractExecuteTransaction()
      .setContractId(this.contractId)
      .setGas(options.gas || 800000)
      .setFunction(functionName, Buffer.from(encodedParams.slice(2), 'hex'));

    if (options.payableAmount) {
      transaction.setPayableAmount(options.payableAmount);
    }

    // Execute with multi-sig if enabled
    if (options.multiSig?.enabled) {
      return await executeWithMultiSig(transaction, this.client, {
        ...options.multiSig,
        contractInterface: this.contractInterface
      });
    }

    // Single-sig execution
    const txResponse = await transaction.execute(this.client);
    const receipt = await txResponse.getReceipt(this.client);

    return {
      transactionId: txResponse.transactionId.toString(),
      receipt,
      success: true
    };
  }
}

module.exports = ContractCallAdapter;
```

**Usage**:

```javascript
const ContractCallAdapter = require('./utils/adapters/ContractCallAdapter');
const { PromptKeyProvider } = require('./utils/multiSigIntegration');

const adapter = new ContractCallAdapter(contractId, contractABI, client);

// Single-sig
await adapter.execute('createPool', [name, symbol, fee]);

// Multi-sig
await adapter.execute('createPool', [name, symbol, fee], {
  multiSig: {
    enabled: true,
    threshold: 2,
    workflow: 'interactive',
    keyProvider: new PromptKeyProvider({ count: 1 })
  }
});
```

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Multi-sig keys (if using EnvKeyProvider)
MULTISIG_KEY_1=302e020100300506032b657004220420...
MULTISIG_KEY_2=302e020100300506032b657004220420...
MULTISIG_KEY_3=302e020100300506032b657004220420...

# Multi-sig configuration (optional defaults)
MULTISIG_THRESHOLD=2
MULTISIG_WORKFLOW=interactive
```

### Load in scripts:

```javascript
require('dotenv').config();

const { EnvKeyProvider } = require('./utils/multiSigIntegration');

const multiSigConfig = {
  enabled: true,
  threshold: parseInt(process.env.MULTISIG_THRESHOLD || '2'),
  workflow: process.env.MULTISIG_WORKFLOW || 'interactive',
  keyProvider: new EnvKeyProvider({ prefix: 'MULTISIG_KEY' })
};
```

## Testing

### Test Multi-Sig Integration

Create `test/multiSig.integration.test.js`:

```javascript
const { executeWithMultiSig } = require('../utils/multiSigIntegration');
const { TransactionFreezer, SignatureCollector } = require('../lib/multiSig');
const { Client, ContractExecuteTransaction, PrivateKey } = require('@hashgraph/sdk');

describe('Multi-Sig Integration', () => {
  let client, testKeys;

  beforeEach(() => {
    client = Client.forTestnet();
    testKeys = [
      PrivateKey.generate(),
      PrivateKey.generate()
    ];
  });

  it('should execute transaction with 2-of-2 multi-sig', async () => {
    const transaction = new ContractExecuteTransaction()
      .setContractId('0.0.123456')
      .setGas(800000);

    const frozenTx = await TransactionFreezer.freeze(transaction, client);
    const signatures = SignatureCollector.generateSignatures(frozenTx, testKeys);

    // This would execute in real test
    // const result = await executeWithMultiSig(transaction, client, {
    //   enabled: true,
    //   threshold: 2,
    //   workflow: 'offline'
    // });

    expect(signatures.length).toBe(2);
  });
});
```

### Run tests:

```bash
npm test
```

## Backward Compatibility

Key principle: All existing scripts work unchanged. Multi-sig is opt-in via flags.

**Ensure**:
- Default behavior (no `--multisig` flag) = single-sig execution
- No breaking changes to function signatures
- Optional parameters for multi-sig config

## Troubleshooting

### "Cannot find module '../lib/multiSig'"

**Solution**: Ensure lib/multiSig is copied to your project and npm install was run.

### "Transaction expired" in offline mode

**Solution**: Ensure signers respond within 110 seconds, or use longer validity transactions.

### Keys not loading from .env

**Solution**:
```javascript
require('dotenv').config();  // Load .env before using EnvKeyProvider
```

## Next Steps

1. Copy `lib/multiSig` to your project
2. Create `utils/multiSigIntegration.js` bridge
3. Add `--multisig` support to admin scripts
4. Test on testnet with 2-of-2 multi-sig
5. Document your project's multi-sig usage

## Support

- See examples in `lib/multiSig/examples/`
- Read main README: `lib/multiSig/README.md`
- Check API docs (coming soon)
