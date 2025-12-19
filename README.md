# @lazysuperheroes/hedera-multisig

> Production-grade multi-signature transaction management library for Hedera blockchain

[![npm version](https://badge.fury.io/js/%40lazysuperheroes%2Fhedera-multisig.svg)](https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/lazysuperheroes/hedera-multisig/actions/workflows/test.yml/badge.svg)](https://github.com/lazysuperheroes/hedera-multisig/actions/workflows/test.yml)

**Features:**
- ✅ M-of-N threshold signatures (2-of-3, 3-of-5, etc.)
- ✅ Mixed key type support (Ed25519 + ECDSA secp256k1)
- ✅ Interactive workflow (<110s real-time coordination)
- ✅ Offline workflow (air-gapped signing)
- ✅ Three security tiers (prompt, encrypted files, env vars)
- ✅ Comprehensive audit logging
- ✅ 236 tests, 0 vulnerabilities
- ✅ Production-ready with complete documentation

---

## 🚀 Quick Start

### Installation

```bash
npm install @lazysuperheroes/hedera-multisig
```

### Basic Usage - Interactive Workflow

```javascript
const {
  Client,
  TransferTransaction,
  Hbar
} = require('@hashgraph/sdk');

const {
  WorkflowOrchestrator,
  PromptKeyProvider
} = require('@lazysuperheroes/hedera-multisig');

async function multiSigTransfer() {
  // Set up Hedera client
  const client = Client.forTestnet();

  // Create transaction
  const transaction = new TransferTransaction()
    .addHbarTransfer('0.0.123', Hbar.fromTinybars(-1000))
    .addHbarTransfer('0.0.456', Hbar.fromTinybars(1000));

  // Configure multi-sig
  const orchestrator = new WorkflowOrchestrator(client);

  // Execute with 2-of-3 signatures
  const result = await orchestrator.execute(transaction, {
    workflow: 'interactive',
    keyProviders: [
      new PromptKeyProvider({ label: 'Signer 1' }),
      new PromptKeyProvider({ label: 'Signer 2' }),
      new PromptKeyProvider({ label: 'Signer 3' })
    ],
    threshold: 2,
    signerLabels: ['Alice', 'Bob', 'Charlie']
  });

  console.log('Transaction ID:', result.transactionId);
  console.log('Status:', result.receipt.status.toString());
}

multiSigTransfer();
```

### Offline Workflow (Air-Gapped Signing)

**Step 1: Freeze and Export** (on connected machine)
```javascript
const result = await orchestrator.freezeAndExport(transaction, {
  threshold: 2,
  signerLabels: ['Alice', 'Bob'],
  exportDir: './transactions'
});

console.log('Transaction file:', result.transactionFile);
// Share this file with signers
```

**Step 2: Sign** (on air-gapped machines)
```bash
# Each signer runs this on their secure machine
node node_modules/@lazysuperheroes/hedera-multisig/cli/sign.js transaction-file.txt

# Outputs: signature-Alice-timestamp.json
```

**Step 3: Collect and Execute** (on connected machine)
```javascript
const result = await orchestrator.collectAndExecute(
  frozenTransaction,
  ['signature-Alice.json', 'signature-Bob.json'],
  2
);

console.log('Transaction executed:', result.transactionId);
```

---

## 📚 Documentation

### Core Concepts

#### M-of-N Threshold Signatures
Require M signatures from N authorized signers. Examples:
- **2-of-3**: Any 2 of 3 signers can authorize (recommended for small teams)
- **3-of-5**: Any 3 of 5 signers can authorize (recommended for larger teams)
- **5-of-7**: Any 5 of 7 signers can authorize (high-security operations)

#### Two Workflow Modes

**Interactive Workflow** (Real-Time):
- All signers coordinate in real-time
- < 110-second timeout
- Best for: Quick operations, collocated teams

**Offline Workflow** (Asynchronous):
- Transaction frozen and exported
- Signers sign independently (air-gapped machines supported)
- No timeout
- Best for: High-security operations, distributed teams

#### Three Security Tiers

1. **Prompt Input** (Highest Security)
   - Keys entered at runtime
   - Never stored on disk
   - Recommended for production

2. **Encrypted Files** (High Security)
   - AES-256-GCM encryption
   - PBKDF2 key derivation (100,000 iterations)
   - Passphrase protected

3. **Environment Variables** (Development Only)
   - Convenient for testing
   - NOT recommended for production

---

## 🔑 Key Management

### Create Encrypted Key File

```bash
# Interactive CLI wizard
npm run create-key-file

# Or
node node_modules/@lazysuperheroes/hedera-multisig/cli/createKeyFile.js
```

### Use Encrypted Key Files

```javascript
const { EncryptedFileProvider } = require('@lazysuperheroes/hedera-multisig');

const keyProvider = new EncryptedFileProvider({
  filePath: './keys/signer1.enc',
  passphrase: process.env.KEY_PASSPHRASE // Or prompt
});

const result = await orchestrator.execute(transaction, {
  workflow: 'interactive',
  keyProviders: [keyProvider],
  threshold: 1
});
```

### Test Key File

```bash
npm run test-key-file keys/signer1.enc
```

---

## 🛠️ API Reference

### WorkflowOrchestrator

Main entry point for multi-sig operations.

```javascript
const orchestrator = new WorkflowOrchestrator(client, options);
```

**Options:**
- `verbose` (boolean): Enable detailed logging (default: true)
- `defaultWorkflow` (string): 'interactive' or 'offline' (default: 'interactive')
- `auditLogPath` (string): Path to audit log file
- `exportDir` (string): Directory for offline workflow exports

**Methods:**

#### `execute(transaction, config)`
Execute a transaction with multi-sig.

```javascript
const result = await orchestrator.execute(transaction, {
  workflow: 'interactive' | 'offline',
  keyProviders: [KeyProvider, ...],
  threshold: 2,
  signerLabels: ['Alice', 'Bob', 'Charlie']
});
```

#### `freezeAndExport(transaction, metadata)`
Freeze transaction and export for offline signing.

```javascript
const result = await orchestrator.freezeAndExport(transaction, {
  threshold: 2,
  signerLabels: ['Alice', 'Bob'],
  exportDir: './transactions'
});
// Returns: { transactionFile, metadataFile, frozenTransaction }
```

#### `collectAndExecute(frozenTransaction, signatureFiles, threshold)`
Collect signatures and execute.

```javascript
const result = await orchestrator.collectAndExecute(
  frozenTransaction,
  ['sig1.json', 'sig2.json'],
  2
);
```

---

### Key Providers

#### PromptKeyProvider
Interactive key input (highest security).

```javascript
const provider = new PromptKeyProvider({
  label: 'Signer 1',
  count: 1,
  hideInput: true,
  confirmKeys: true
});
```

#### EncryptedFileProvider
AES-256-GCM encrypted key storage.

```javascript
const provider = new EncryptedFileProvider({
  filePath: './keys/signer.enc',
  passphrase: 'your-strong-passphrase',
  promptIfMissing: true
});
```

#### EnvKeyProvider
Environment variable keys (development only).

```javascript
const provider = new EnvKeyProvider({
  keyVarName: 'PRIVATE_KEY'
});
```

---

### Workflows

#### InteractiveWorkflow
Real-time multi-sig coordination.

```javascript
const workflow = new InteractiveWorkflow(client, {
  verbose: true,
  showTimer: true
});

const result = await workflow.execute(transaction, {
  keyProviders: [provider1, provider2, provider3],
  threshold: 2
});
```

#### OfflineWorkflow
Asynchronous air-gapped signing.

```javascript
const workflow = new OfflineWorkflow(client, {
  exportDir: './transactions',
  verbose: true
});

// Phase 1: Freeze
const frozen = await workflow.freezeAndExport(transaction, metadata);

// Phase 2: Sign (on other machines)
// ...signatures collected...

// Phase 3: Execute
const result = await workflow.collectAndExecute(
  frozen.frozenTransaction,
  signatureFiles,
  threshold
);
```

---

## 🔐 Security

### Security Features

- ✅ **No Key Storage**: Prompt-based provider never stores keys
- ✅ **Strong Encryption**: AES-256-GCM with PBKDF2 (100k iterations)
- ✅ **Input Hiding**: All key inputs use hideEchoBack
- ✅ **Audit Logging**: Comprehensive operation tracking
- ✅ **Sanitized Logs**: No private keys in logs
- ✅ **Signature Validation**: Cryptographic verification
- ✅ **Timeout Protection**: 110-second limit (9s buffer)

### Security Audit

Run automated security audit:
```bash
npm run security-audit
```

### Security Best Practices

1. **Production**: Use `PromptKeyProvider` or `EncryptedFileProvider`
2. **File Permissions**: Set encrypted files to 0600 (owner read/write only)
3. **Passphrases**: Use strong passphrases (12+ characters)
4. **Audit Logs**: Enable and monitor audit logging
5. **Environment Variables**: Never use in production
6. **Key Rotation**: Implement regular key rotation schedule

### What's Safe to Share

✅ **Safe:**
- This package (no keys in code)
- Transaction files (frozen transactions)
- Public keys (last 8 characters displayed)
- Audit logs (sanitized)

❌ **Never Share:**
- Private keys
- Encrypted key files without passphrase rotation
- Passphrases
- .env files
- Signature files (contain cryptographic signatures)

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit      # Key management tests
npm run test:workflows # Workflow tests

# With coverage
npm test -- --coverage
```

---

## 📖 Advanced Usage

### Mixed Key Types (Ed25519 + ECDSA)

```javascript
// Automatically detected - just provide keys
// Key 1: Ed25519 (Hedera native)
// Key 2: ECDSA secp256k1 (Ethereum-compatible)
// Key 3: Ed25519

const result = await orchestrator.execute(transaction, {
  workflow: 'interactive',
  keyProviders: [
    new PromptKeyProvider({ label: 'Ed25519 Key' }),
    new PromptKeyProvider({ label: 'ECDSA Key' }),
    new PromptKeyProvider({ label: 'Ed25519 Key' })
  ],
  threshold: 2
});
// System automatically detects and handles key types
```

### Custom Audit Logging

```javascript
const orchestrator = new WorkflowOrchestrator(client, {
  auditLogPath: './logs/multi-sig-audit.log',
  verbose: true
});

// All operations are logged:
// - Transaction creation
// - Signature collection
// - Execution results
// - Errors and failures
```

### Batch Operations

```javascript
const transactions = [tx1, tx2, tx3];

for (const tx of transactions) {
  const result = await orchestrator.execute(tx, config);
  console.log(`Executed: ${result.transactionId}`);
}
```

### Error Handling

```javascript
try {
  const result = await orchestrator.execute(transaction, config);
  console.log('Success:', result.transactionId);
} catch (error) {
  if (error.message.includes('Insufficient signatures')) {
    console.error('Not enough signers provided signatures');
  } else if (error.message.includes('expired')) {
    console.error('Transaction timed out');
  } else {
    console.error('Unexpected error:', error.message);
  }
}
```

---

## 🔄 Migration from Local Copy

If you were previously copying the `lib/multiSig/` folder:

```javascript
// Before:
const { WorkflowOrchestrator } = require('../../lib/multiSig');

// After:
const { WorkflowOrchestrator } = require('@lazysuperheroes/hedera-multisig');
```

**Steps:**
1. Install package: `npm install @lazysuperheroes/hedera-multisig`
2. Update imports in all files
3. Remove local `lib/multiSig/` copy
4. Test everything works

---

## 💡 Examples

### Example 1: Treasury Multi-Sig (2-of-3)

```javascript
const { WorkflowOrchestrator, PromptKeyProvider } = require('@lazysuperheroes/hedera-multisig');

async function treasuryWithdrawal() {
  const orchestrator = new WorkflowOrchestrator(Client.forMainnet());

  const withdrawal = new TransferTransaction()
    .addHbarTransfer(treasuryAccount, Hbar.from(-10000))
    .addHbarTransfer(recipientAccount, Hbar.from(10000));

  const result = await orchestrator.execute(withdrawal, {
    workflow: 'interactive',
    keyProviders: [
      new PromptKeyProvider({ label: 'CFO' }),
      new PromptKeyProvider({ label: 'CTO' }),
      new PromptKeyProvider({ label: 'CEO' })
    ],
    threshold: 2,
    signerLabels: ['CFO', 'CTO', 'CEO']
  });

  return result;
}
```

### Example 2: High-Security Contract Call (3-of-5)

```javascript
const contractCall = new ContractExecuteTransaction()
  .setContractId('0.0.123456')
  .setGas(100000)
  .setFunction('criticalOperation', params);

const result = await orchestrator.execute(contractCall, {
  workflow: 'offline', // Air-gapped signing for high security
  exportDir: './high-security-transactions'
});

console.log('Transaction frozen:', result.transactionFile);
// Distribute to 5 signers for signing
```

### Example 3: Emergency Pause with Encrypted Keys

```javascript
const { EncryptedFileProvider } = require('@lazysuperheroes/hedera-multisig');

const pause = new ContractExecuteTransaction()
  .setContractId(contractId)
  .setGas(50000)
  .setFunction('pause');

const result = await orchestrator.execute(pause, {
  workflow: 'interactive',
  keyProviders: [
    new EncryptedFileProvider({ filePath: './keys/security1.enc' }),
    new EncryptedFileProvider({ filePath: './keys/security2.enc' })
  ],
  threshold: 2,
  signerLabels: ['Security Lead', 'Operations Lead']
});
```

---

## 🤝 Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone repository
git clone https://github.com/lazysuperheroes/hedera-multisig.git
cd hedera-multisig

# Install dependencies
npm install

# Run tests
npm test

# Run linter
npm run lint
```

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built with ❤️ by [Lazy Superheroes](https://lazysuperheroes.com) for the Hedera community.

Special thanks to:
- Hedera Hashgraph team for the excellent SDK
- The cryptocurrency security community
- All contributors and testers

---

## 📬 Support

- **Documentation**: [Full Guides](https://github.com/lazysuperheroes/hedera-multisig/tree/main/docs)
- **Issues**: [GitHub Issues](https://github.com/lazysuperheroes/hedera-multisig/issues)
- **Discussions**: [GitHub Discussions](https://github.com/lazysuperheroes/hedera-multisig/discussions)
- **Email**: support@lazysuperheroes.com

---

## 🗺️ Roadmap

### v1.x (Current)
- ✅ M-of-N threshold signatures
- ✅ Interactive and offline workflows
- ✅ Mixed key types support
- ✅ Comprehensive testing (236 tests)

### v2.0 (Planned)
- [ ] Hardware wallet integration (Ledger, Trezor)
- [ ] Mobile app signing support
- [ ] Batch multi-sig operations
- [ ] Scheduled multi-sig transactions
- [ ] Web UI for signature coordination
- [ ] TypeScript definitions

### Future
- [ ] Multi-chain support
- [ ] Hierarchical deterministic (HD) keys
- [ ] Shamir Secret Sharing integration
- [ ] Policy-based automation

---

## 📊 Status

![Tests](https://img.shields.io/badge/tests-236%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-90%25%2B-brightgreen)
![Vulnerabilities](https://img.shields.io/badge/vulnerabilities-0-brightgreen)
![Production Ready](https://img.shields.io/badge/status-production%20ready-brightgreen)

---

**Made with ❤️ for Hedera by Lazy Superheroes**
