# Smart Contract Integration Guide
## Hedera MultiSig - Solidity/ABI Support

---

## Overview

This guide explains how to integrate Solidity smart contract calls into the Hedera MultiSig system, including how ABIs (Application Binary Interfaces) flow through the system and enable proper decoding of contract function calls.

**Key Capability**: The system supports multi-signature execution of smart contract transactions with full ABI decoding, allowing participants to see exactly which function is being called and with what parameters.

---

## Quick Summary

```
Coordinator → Provides ABI in metadata
    ↓
Server → Forwards ABI with frozen transaction
    ↓
Participants (CLI/Web) → Decode function using ABI
    ↓
Sign → Knowing exactly what contract function will execute
```

**Security Model**:
- ✅ **VERIFIED**: Function parameters decoded from transaction bytes (cryptographically verified)
- ⚠️ **UNVERIFIED**: ABI and function names provided by coordinator (advisory only)

---

## Table of Contents

1. [What is an ABI?](#what-is-an-abi)
2. [ABI Flow Through System](#abi-flow-through-system)
3. [Coordinator: How to Inject Contract Transactions](#coordinator-how-to-inject-contract-transactions)
4. [Participant: How Contract Calls are Reviewed](#participant-how-contract-calls-are-reviewed)
5. [Security Considerations](#security-considerations)
6. [Complete Example](#complete-example)
7. [Troubleshooting](#troubleshooting)

---

## What is an ABI?

An **ABI (Application Binary Interface)** is a JSON specification that describes:
- Function names and signatures
- Parameter types and names
- Return types
- Events

**Example ABI**:
```json
[
  {
    "name": "transfer",
    "type": "function",
    "inputs": [
      { "name": "recipient", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "outputs": [
      { "name": "success", "type": "bool" }
    ]
  }
]
```

**Why ABIs Matter**: Without an ABI, contract transaction bytes look like this:
```
0xa9059cbb000000000000000000000000742d35Cc6634C0532925a3b844Bc9e7595f0000000000000000000000000000000000000000000000000000000000000064
```

**With ABI**, we can decode to:
```
Function: transfer(address,uint256)
Parameters:
  - recipient: 0x742d35Cc6634C0532925a3b844Bc9e7595f
  - amount: 100
```

---

## ABI Flow Through System

### 1. Coordinator Has ABI

The coordinator (transaction initiator) typically has the ABI because they:
- Deployed the contract (have source code)
- Obtained ABI from contract documentation
- Fetched ABI from Hedera Mirror Node (future feature)
- Have the Solidity source code

### 2. ABI Included in Metadata

When injecting a contract transaction, the coordinator includes the ABI in the `metadata` field:

```javascript
const metadata = {
  description: "Transfer 100 tokens to recipient",
  contractAbi: [
    {
      name: "transfer",
      type: "function",
      inputs: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" }
      ]
    }
  ]
};

await server.injectTransaction(frozenTransaction, metadata);
```

### 3. Server Forwards ABI

The server forwards the entire `metadata` object (including `contractAbi`) to all participants:

```javascript
// Server broadcasts to all participants:
{
  type: 'TRANSACTION_RECEIVED',
  payload: {
    frozenTransaction: { base64: '...' },
    txDetails: { /* decoded from bytes */ },
    metadata: {
      description: "Transfer 100 tokens to recipient",
      contractAbi: [ /* ABI array */ ]
    }
  }
}
```

### 4. Participants Decode Contract Call

**CLI Participants** use `TransactionReviewer.js`:
```javascript
const decoded = await reviewer.decode(frozenTransaction, metadata.contractAbi);

console.log('Function:', decoded.function.name);  // "transfer"
console.log('Parameters:', decoded.function.params);
// [
//   { name: 'recipient', type: 'address', value: '0x742d...' },
//   { name: 'amount', type: 'uint256', value: '100' }
// ]
```

**Web Participants** use `transaction-decoder.ts` with ethers.js:
```typescript
import { Interface } from 'ethers';

const iface = new Interface(metadata.contractAbi);
const decoded = iface.parseTransaction({ data: functionParameters });

console.log('Function:', decoded.name);  // "transfer"
console.log('Args:', decoded.args);      // ['0x742d...', 100n]
```

### 5. Participants Review and Sign

Participants see:
- ✅ **VERIFIED**: Function parameters (decoded from transaction bytes)
- ⚠️ **UNVERIFIED**: Function name (from ABI - could be fake)
- Contract ID (verified from transaction)
- Gas limit (verified from transaction)

---

## Coordinator: How to Inject Contract Transactions

### Step 1: Create Contract Call Transaction

```javascript
const { ContractExecuteTransaction } = require('@hashgraph/sdk');
const { ethers } = require('ethers');

// 1. Create interface from ABI
const abi = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ]
  }
];

const iface = new ethers.Interface(abi);

// 2. Encode function call
const functionData = iface.encodeFunctionData('transfer', [
  '0x742d35Cc6634C0532925a3b844Bc9e7595f',  // recipient address
  ethers.parseUnits('100', 18)               // amount (100 tokens)
]);

// 3. Create Hedera contract transaction
const transaction = new ContractExecuteTransaction()
  .setContractId('0.0.123456')
  .setGas(100000)
  .setFunctionParameters(Buffer.from(functionData.slice(2), 'hex'));
```

### Step 2: Freeze Transaction

```javascript
const frozenTransaction = await transaction
  .setTransactionId(TransactionId.generate(coordinatorAccountId))
  .freeze();
```

### Step 3: Inject with ABI in Metadata

```javascript
const metadata = {
  description: "Transfer 100 tokens to team member",
  urgency: "routine",
  contractAbi: abi,  // ← Include ABI here!
  contractAddress: '0.0.123456',
  functionName: 'transfer',  // Optional: for display
  estimatedGasUsed: '75000'  // Optional: advisory
};

// Inject into signing session
await server.injectTransaction(frozenTransaction, metadata);
```

### Step 4: Wait for Signatures

The rest of the flow is identical to other transaction types. Participants will see decoded contract parameters and sign if they approve.

---

## Participant: How Contract Calls are Reviewed

### CLI Participant View

When a contract transaction is received with ABI:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRANSACTION REVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ VERIFIED TRANSACTION DATA
(Cryptographically verified from transaction bytes)

Type: ContractExecuteTransaction
Contract ID: 0.0.123456
Gas Limit: 100000
Checksum: abc123def456...

Smart Contract Execution:
  Function Parameters (VERIFIED):
    - recipient (address): 0x742d35Cc6634C0532925a3b844Bc9e7595f
    - amount (uint256): 100

⚠️ UNVERIFIED METADATA
(Provided by coordinator - advisory only)

Description: Transfer 100 tokens to team member
Function Name: transfer (⚠️ UNVERIFIED - verify parameters above)
Estimated Gas: 75000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Checksum valid
✓ No metadata warnings

Do you want to sign this transaction? (yes/no):
```

### Web Participant View

The dApp shows a similar two-section display:

**Green Section (VERIFIED)**:
- Contract ID: `0.0.123456` (with HashScan link)
- Function Parameters:
  - `recipient (address)`: `0x742d35Cc6634C0532925a3b844Bc9e7595f`
  - `amount (uint256)`: `100`
- Gas Limit: `100000`
- SHA-256 Checksum: `abc123...`

**Yellow Section (UNVERIFIED)**:
- Description: "Transfer 100 tokens to team member"
- Function Name: `transfer` ⚠️ (from ABI - verify parameters)
- Estimated Gas: `75000`

**Important**: The actual parameter *values* are verified (decoded from transaction bytes). Only the parameter *names* and function *name* come from the ABI and are unverified.

---

## Security Considerations

### ✅ What is Cryptographically Verified

1. **Contract ID** - Which contract will be called (from transaction bytes)
2. **Function Parameters** - The actual data being passed (from transaction bytes)
3. **Gas Limit** - Maximum gas that can be consumed (from transaction bytes)
4. **Transaction Checksum** - SHA-256 of all transaction bytes

### ⚠️ What is NOT Verified (From ABI)

1. **Function Name** - Could be "transfer" but actually be "steal"
2. **Parameter Names** - Could say "recipient" but actually be "attacker"
3. **Semantic Meaning** - Parameters are just bytes; ABI provides interpretation

### Attack Vector: Fake ABI

**Attack Scenario**:
```javascript
// Malicious coordinator provides fake ABI
const fakeAbi = [
  {
    name: "transfer",  // Looks innocent
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ]
  }
];

// But actual contract function is:
// function drainFunds(address attacker, uint256 amount)
```

**Mitigation**:
1. **Participants MUST verify the contract address** - Check that it's the expected contract on HashScan
2. **Participants MUST verify parameter values** - Do the actual bytes make sense?
3. **Parameter values are VERIFIED** - Even with fake function name, you see the real data
4. **Parameter types are verified** - ethers.js will fail if types don't match actual encoding

### Best Practices for Participants

1. **Always check contract ID on HashScan** - Verify it's the expected contract
2. **Verify parameter values** - Do they make sense for the operation?
3. **Don't trust function names** - They're advisory from the ABI
4. **If ABI not provided** - You'll see raw hex bytes; verify manually or reject
5. **Cross-reference with team** - Discuss contract transactions before signing

### Best Practices for Coordinators

1. **Always provide accurate ABIs** - Helps participants make informed decisions
2. **Include contract address in metadata** - For easy HashScan verification
3. **Explain the operation** - Clear description of what contract call does
4. **Test on testnet first** - Verify contract behavior before mainnet multi-sig
5. **Publish contract source code** - Allows participants to verify ABI independently

---

## Complete Example

### Scenario: Multi-Sig Execute ERC-20 Token Transfer

**Contract**: ERC-20 token on Hedera (Solidity)
**Operation**: Transfer 1000 tokens from multi-sig treasury to recipient
**Threshold**: 3-of-5 signatures required

### Coordinator Script

```javascript
const {
  Client,
  ContractExecuteTransaction,
  TransactionId
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const { SigningSessionManager } = require('@lazysuperheroes/hedera-multisig');

async function executeTokenTransfer() {
  // 1. Setup
  const client = Client.forTestnet();
  const contractId = '0.0.123456';  // ERC-20 token contract
  const treasuryAccountId = '0.0.789';  // Multi-sig treasury

  // 2. ERC-20 ABI (standard)
  const erc20Abi = [
    {
      name: "transfer",
      type: "function",
      inputs: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      outputs: [
        { name: "success", type: "bool" }
      ]
    }
  ];

  // 3. Encode function call
  const iface = new ethers.Interface(erc20Abi);
  const recipientAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f';
  const amount = ethers.parseUnits('1000', 18);  // 1000 tokens (18 decimals)

  const functionData = iface.encodeFunctionData('transfer', [
    recipientAddress,
    amount
  ]);

  // 4. Create contract execute transaction
  const transaction = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(100000)
    .setFunctionParameters(Buffer.from(functionData.slice(2), 'hex'))
    .setTransactionId(TransactionId.generate(treasuryAccountId));

  // 5. Freeze transaction
  const frozenTransaction = await transaction.freeze();

  // 6. Create metadata with ABI
  const metadata = {
    description: "Transfer 1000 tokens from treasury to team member for Q4 bonus",
    urgency: "routine",
    contractAbi: erc20Abi,
    contractAddress: contractId.toString(),
    functionName: 'transfer',
    notes: [
      "Recipient: 0x742d35Cc6634C0532925a3b844Bc9e7595f",
      "Amount: 1000 tokens",
      "Purpose: Q4 team bonus payment"
    ]
  };

  // 7. Inject into signing session
  const server = new SigningSessionManager({
    eligibleKeys: [
      // Public keys of 5 authorized signers
      'pubkey1...', 'pubkey2...', 'pubkey3...', 'pubkey4...', 'pubkey5...'
    ],
    threshold: 3,
    network: 'testnet'
  });

  const session = await server.createSession();
  console.log('Session ID:', session.sessionId);
  console.log('PIN:', session.pin);

  // Inject transaction
  await server.injectTransaction(frozenTransaction, metadata);

  // 8. Wait for signatures (3-of-5)
  console.log('Waiting for 3 signatures...');

  // Signatures will be collected automatically
  // When threshold met, transaction executes
}

executeTokenTransfer();
```

### Participant Experience (CLI)

```bash
$ node cli/participant.js

Enter server URL: ws://coordinator-server.com:3001
Enter session ID: abc123
Enter PIN: 456789

✓ Connected to session
✓ Authenticated successfully

Waiting for transaction...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRANSACTION REVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ VERIFIED TRANSACTION DATA

Type: ContractExecuteTransaction
Contract ID: 0.0.123456 → https://hashscan.io/testnet/contract/0.0.123456
Gas Limit: 100000
SHA-256 Checksum: a1b2c3d4e5f6...

Smart Contract Execution:
  Function Parameters (VERIFIED from transaction bytes):
    Parameter 1 (address): 0x742d35Cc6634C0532925a3b844Bc9e7595f
    Parameter 2 (uint256): 1000000000000000000000 (1000 with 18 decimals)

⚠️ UNVERIFIED METADATA (Provided by coordinator)

Description: Transfer 1000 tokens from treasury to team member for Q4 bonus
Function Name: transfer (⚠️ UNVERIFIED - verify parameters above)

Notes:
  • Recipient: 0x742d35Cc6634C0532925a3b844Bc9e7595f
  • Amount: 1000 tokens
  • Purpose: Q4 team bonus payment

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Checksum valid
✓ No metadata warnings

Verification Steps:
1. ✓ Contract ID matches expected ERC-20 token contract
2. ✓ Recipient address confirmed with team
3. ✓ Amount matches expected 1000 tokens
4. ✓ Purpose aligns with approved Q4 bonus plan

Do you want to sign this transaction? (yes/no): yes

Signing with key provider: Prompt
Enter your private key: ***************************

✓ Signature created and submitted
✓ Waiting for additional signatures (1 of 3 received)

[Later...]
✓ Threshold met (3 signatures received)
✓ Transaction executed successfully!
Transaction ID: 0.0.123456@1234567890.123
Status: SUCCESS

View on HashScan: https://hashscan.io/testnet/transaction/0.0.123456@1234567890.123
```

### Participant Experience (Web dApp)

1. **Connect Wallet** - HashPack/Blade via WalletConnect
2. **Join Session** - Enter session ID + PIN
3. **Review Transaction**:

**VERIFIED Section (Green)**:
- Contract: [`0.0.123456`](https://hashscan.io/testnet/contract/0.0.123456)
- Function Parameters:
  - `address`: `0x742d35Cc6634C0532925a3b844Bc9e7595f`
  - `uint256`: `1000000000000000000000`
- Gas Limit: `100000`
- Checksum: ✓ Valid

**UNVERIFIED Section (Yellow)**:
- Function: `transfer` ⚠️
- Description: "Transfer 1000 tokens from treasury..."
- Notes: [recipient, amount, purpose]

4. **Click "Approve & Sign"** - WalletConnect modal opens
5. **Sign in Wallet** - Approve signature in HashPack/Blade
6. **Signature Submitted** - Shows progress (1/3, 2/3, 3/3)
7. **Transaction Executed** - Success message with HashScan link

---

## Troubleshooting

### "Function parameters not decoded" (ABI missing)

**Symptom**: Raw hex bytes shown instead of decoded parameters

**Cause**: Coordinator didn't provide `contractAbi` in metadata

**Solution**:
- **Participants**: Request ABI from coordinator, or verify hex bytes manually
- **Coordinators**: Always include `contractAbi` in metadata

**Example Without ABI**:
```
Smart Contract Execution:
  Function Parameters: 0xa9059cbb000000000000000000000000742d35Cc6634C0532925a3b844Bc9e7595f0000000000000000000000000000000000000000000000000000000000000064

  ⚠️ No ABI provided - cannot decode function call
```

### "ethers.js parsing failed"

**Symptom**: Error when trying to decode function parameters

**Cause**: ABI doesn't match actual function encoding

**Possible Reasons**:
1. Wrong ABI provided (doesn't match contract)
2. Contract was upgraded but ABI wasn't updated
3. Function parameters encoded incorrectly

**Solution**:
1. Verify contract ID on HashScan
2. Check contract source code if available
3. Request correct ABI from coordinator
4. If mismatch detected: **REJECT THE TRANSACTION**

### "Parameter types don't match"

**Symptom**: Decoded parameters look wrong (e.g., huge numbers, invalid addresses)

**Cause**: ABI parameter types don't match actual encoding

**Example**:
```javascript
// ABI says: function foo(address x, uint256 y)
// But contract actually has: function foo(uint256 x, address y)

// Result: Address decoded as number, number decoded as address
// Participant sees:
//   x (address): 0x0000000000000000000000000000000000000064  ← Should be 100
//   y (uint256): 532156161...  ← Should be address
```

**Solution**:
1. If parameters look nonsensical: **REJECT**
2. Request coordinator to verify ABI
3. Check contract source code on HashScan (if verified)

### "How do I get the ABI for a contract?"

**Options**:

1. **Deployed the contract yourself**: ABI is in compilation artifacts
   ```bash
   # Solidity compilation output
   contracts/MyContract.sol/MyContract.json
   ```

2. **Contract source verified on HashScan**:
   - Visit contract on HashScan
   - Look for "Contract" tab → "Code"
   - ABI available if source code verified

3. **Ask contract owner**: Request ABI from whoever deployed it

4. **Future**: Hedera Mirror Node may provide ABI endpoint (not yet available)

### "Should I sign if ABI is missing?"

**Decision Matrix**:

| Scenario | Recommendation |
|----------|---------------|
| Known contract + Expected parameters (verified hex) | ✅ Can sign if you can verify hex manually |
| Known contract + Unexpected hex | ❌ Reject - might be malicious |
| Unknown contract + No ABI | ❌ Reject - cannot verify operation |
| Test transaction + Small amount | ⚠️ Proceed with caution |
| Production + Large value | ❌ Reject unless ABI provided |

**General Rule**: If you can't verify what the transaction does, **don't sign it**.

---

## Advanced Topics

### Custom Contract ABIs

For non-standard contracts, provide complete ABI:

```javascript
const customAbi = [
  {
    name: "executeMultiSigOperation",
    type: "function",
    inputs: [
      { name: "operationType", type: "uint8" },
      { name: "targetAddress", type: "address" },
      { name: "data", type: "bytes" },
      { name: "value", type: "uint256" }
    ]
  }
];

const metadata = {
  contractAbi: customAbi,
  description: "Execute multi-sig operation on custom contract"
};
```

### Multiple Function Definitions

If contract has overloaded functions, include all variants:

```javascript
const abi = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ]
  },
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" }
    ]
  }
];
```

ethers.js will automatically select the correct variant based on parameter count.

### Future: Auto-Fetch ABIs

**Planned Feature**: Automatically fetch ABIs from Hedera Mirror Node

```javascript
// Future capability (not yet available)
const abi = await mirror.getContractAbi('0.0.123456');
```

When this becomes available, participants can verify coordinator-provided ABIs against on-chain data.

---

## Summary

### For Coordinators

1. ✅ **Always provide ABIs** in `metadata.contractAbi`
2. ✅ **Include clear descriptions** of what contract call does
3. ✅ **Test on testnet first** with small amounts
4. ✅ **Publish contract source** on HashScan when possible
5. ⚠️ **Never assume participants trust you** - they will verify everything

### For Participants

1. ✅ **Verify contract ID** on HashScan before signing
2. ✅ **Check parameter values** (VERIFIED section) carefully
3. ⚠️ **Don't trust function names** (UNVERIFIED from ABI)
4. ❌ **Reject if suspicious** - better safe than sorry
5. ✅ **Cross-reference with team** before signing contract transactions

### Key Security Principle

**Parameter VALUES are verified. Parameter NAMES are not.**

Even if the ABI says the function is "transfer" and the parameter is "recipient", you're seeing the actual bytes. Verify those bytes make sense for the operation, regardless of what the ABI claims.

---

## Additional Resources

- [Solidity ABI Specification](https://docs.soliditylang.org/en/latest/abi-spec.html)
- [ethers.js Interface Documentation](https://docs.ethers.org/v6/api/abi/)
- [Hedera Smart Contract Service](https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts)
- [HashScan Explorer](https://hashscan.io/)
- [Security Architecture](./SECURITY_ARCHITECTURE.md) - Complete security analysis

---

**Questions?** Open an issue on [GitHub](https://github.com/lazysuperheroes/hedera-multisig/issues)
