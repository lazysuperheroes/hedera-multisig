# Start Here: Hedera Multi-Sig Guide

> A decision-tree guide to help you choose the right workflow for your team.

---

## What is this?

This library helps you:
- **Create** Hedera accounts that require multiple signatures (M-of-N)
- **Convert** existing accounts to multi-sig
- **Coordinate** transaction signing across teams, timezones, and devices
- **Sign** with hardware wallets (Ledger) via WalletConnect

---

## Quick Decision Tree

### 1. Setting Up Multi-Sig

**"We want to create a new multi-sig account from scratch"**
```bash
npm run create-account
```
- Creates a fresh account with a KeyList (threshold key)
- You provide the public keys of all signers
- Best for: Treasury accounts, new projects
- [Detailed guide](./CLI_TOOLS_README.md#2-create-new-multi-sig-account)

---

**"We have an existing account we want to protect with multi-sig"**
```bash
npm run setup-multisig
```
- Converts a single-key account to M-of-N threshold key
- Current key holder must sign the update
- Best for: Existing treasury, operator accounts
- [Detailed guide](./CLI_TOOLS_README.md#3-convert-existing-account-to-multi-sig)

---

**"We need to collect public keys from our team first"**
```bash
npm run collect-keys
```
- Coordinator mode: Starts a key collection session
- Participant mode: Team members submit their public keys
- Best for: Distributed teams who haven't shared keys yet
- [Detailed guide](./CLI_TOOLS_README.md#8-collect-team-public-keys)

---

### 2. Signing Transactions Together

**"Everyone can be online at the same time"**

Use the **Interactive Workflow**:
```bash
# Coordinator starts server
npm run multisig-server -- --port 3001 --threshold 2 --keys "KEY1,KEY2,KEY3"

# Participants join
npm run multisig-client -- --server ws://localhost:3001 --session SESSION_ID --pin PIN
```
- Real-time coordination
- See who's signed, who's pending
- Best for: Teams in same timezone, scheduled signing ceremonies
- [Detailed guide](./README.md#interactive-workflow)

---

**"We're in different timezones / can't coordinate schedules"**

> **Current limitation**: Hedera transactions must hit consensus within ~120 seconds of being frozen. All signers need to be available within that window.

**Current workaround**: Schedule a 15-minute "signing ceremony" that works across timezones (e.g., 8am PT / 4pm GMT / midnight SGT).

**Future feature**: Scheduled transaction support will allow true async signing:
- Create a `ScheduleCreateTransaction` with the payload
- Signers submit `ScheduleSignTransaction` over hours/days
- Transaction executes automatically once threshold met

This is on the roadmap. For now, use the Networked Workflow for coordinated signing windows:
```bash
npm run multisig-server -- --port 3001 --threshold 2 --keys "KEY1,KEY2,KEY3" --tunnel ngrok
```
- Participants can join early and wait
- Transaction injected when everyone's ready
- 120-second signing window once injected

---

**"Some signers have air-gapped / cold storage keys"**

> **Important**: Currently, air-gapped signing is a **standalone workflow** (CLI-only). It does not integrate with the WebSocket server or dApp. All signers must use the same workflow.

Use the **Offline Workflow** when ALL signers are air-gapped:
```bash
# 1. Coordinator freezes and exports transaction
node workflows/WorkflowOrchestrator.js --export

# 2. Transfer frozen transaction to air-gapped machines (USB, QR, etc.)

# 3. Each signer signs offline
npm run sign-tx --file transaction.json --key <private-key>

# 4. Collect signature files back to coordinator

# 5. Coordinator executes with collected signatures
```
- No network required for signing
- Maximum security for cold storage
- Best for: ALL signers using cold storage
- [Detailed guide](./README.md#offline-workflow)

**Hybrid (some online, some air-gapped)**: Not yet supported. This is on the roadmap - will allow mixing dApp signers with air-gapped signers in the same session.

---

**"We want a web UI instead of command line"**

Use the **dApp with WalletConnect**:
- Testnet: https://testnet-multisig.lazysuperheroes.com
- Mainnet: https://multisig.lazysuperheroes.com

1. Start a server with `--tunnel ngrok`
2. Share the connection string
3. Participants open dApp, paste connection, connect wallet
4. Sign with HashPack (browser or mobile) or Ledger

Best for: Non-technical signers, hardware wallet users

---

### 3. Managing Multi-Sig Accounts

**"We need to add or remove signers"**
```bash
npm run update-keys
```
- Change which keys are on the account
- Adjust threshold (e.g., 2-of-3 to 3-of-5)
- Requires M-of-N current signers to approve
- [Detailed guide](./CLI_TOOLS_README.md#4-rotate-multi-sig-keys)

---

**"We want to go back to a single-key account"**
```bash
npm run revert-multisig
```
- Converts multi-sig back to single key
- Requires M-of-N current signers to approve
- Best for: Winding down, simplifying
- [Detailed guide](./CLI_TOOLS_README.md#5-revert-to-single-signature)

---

### 4. One-Off Operations

**"I just need to inspect a frozen transaction"**
```bash
npm run query-tx
```
- Decodes transaction bytes to human-readable format
- Shows type, amounts, accounts involved
- Verify before signing

---

**"I need to sign a transaction file offline"**
```bash
npm run sign-tx
```
- Signs a frozen transaction with a private key
- Outputs signature or signed transaction bytes
- For air-gapped workflows

---

## Common Scenarios

### Scenario A: New Project Treasury

You're starting a new project and want a 2-of-3 treasury account.

1. **Collect keys**: Each of 3 founders runs `npm run generate-keys` and shares their public key
2. **Create account**: One person runs `npm run create-account` with all 3 public keys, threshold=2
3. **Fund it**: Transfer HBAR to the new account
4. **Sign together**: When spending, use `npm run multisig-server` to coordinate

---

### Scenario B: Secure Existing Treasury

You have an existing account controlled by one key. You want to add multi-sig protection.

1. **Collect keys**: Get public keys from all signers
2. **Convert**: Current key holder runs `npm run setup-multisig`
3. **Verify**: Check account on HashScan - should show KeyList

---

### Scenario C: Global Team Signing

Your team is spread across US, Europe, and Asia. You need to sign a large transfer.

> **Note**: Due to Hedera's ~120-second transaction validity, all signers must be available within a short window. Schedule a signing ceremony.

1. **Schedule**: Find a 15-minute window that works (e.g., 8am PT / 4pm GMT / midnight SGT)
2. **Coordinator**: Run `npm run multisig-server -- --tunnel ngrok`
3. **Share**: Send connection string to team via secure channel
4. **Join early**: Participants connect and wait in session
5. **Inject**: Coordinator injects transaction when all are ready
6. **Sign**: Everyone signs within 120 seconds
7. **Execute**: Once threshold met, transaction executes

*Future: Scheduled transactions will enable true async signing across days.*

---

### Scenario D: Hardware Wallet Signing

One signer uses a Ledger for maximum security.

1. **Start server**: `npm run multisig-server -- --tunnel ngrok`
2. **Ledger user**: Opens dApp, connects HashPack (which connects to Ledger)
3. **Sign**: Ledger prompts for physical confirmation
4. **Other signers**: Can use CLI or dApp

---

## Hardware Requirements

| Workflow | Internet Required | Hardware Wallet Support | Mix with Other Workflows |
|----------|-------------------|------------------------|-------------------------|
| Interactive | Yes (local network OK) | Via dApp + WalletConnect | No - all signers same workflow |
| Networked | Yes (public URL) | Via dApp + WalletConnect | No - all signers same workflow |
| Offline | No | Manual key entry | No - all signers same workflow |
| **Hybrid** | Partial | Yes | **Future feature** |

---

## Security Recommendations

1. **Never share private keys** - Only share public keys for account setup
2. **Verify before signing** - Use `npm run query-tx` to inspect transactions
3. **Use hardware wallets** - For high-value accounts, use Ledger via HashPack
4. **Air-gap cold storage** - For maximum security, use offline workflow
5. **Secure PIN distribution** - Share session PINs via separate channel from URLs

---

## Quick Reference

| Task | Command |
|------|---------|
| Generate new keypair | `npm run generate-keys` |
| Create multi-sig account | `npm run create-account` |
| Convert to multi-sig | `npm run setup-multisig` |
| Update signers | `npm run update-keys` |
| Revert to single-sig | `npm run revert-multisig` |
| Start signing server | `npm run multisig-server` |
| Join as participant | `npm run multisig-client` |
| Collect team keys | `npm run collect-keys` |
| Inspect transaction | `npm run query-tx` |
| Sign offline | `npm run sign-tx` |
| Interactive menu | `npm run account-manager` |

---

## Next Steps

- **First time?** Start with [SETUP_GUIDE.md](./SETUP_GUIDE.md) for a complete walkthrough
- **Need CLI details?** See [CLI_TOOLS_README.md](./CLI_TOOLS_README.md)
- **Building an integration?** See [examples/README.md](./examples/README.md)
- **Security concerns?** See [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md)

---

*Questions? Open an issue at https://github.com/lazysuperheroes/hedera-multisig/issues*
