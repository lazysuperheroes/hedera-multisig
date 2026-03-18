# Coordinator Guide

> **Complete guide for setting up and managing multi-sig signing sessions.**
>
> This guide is for the person who creates sessions, shares credentials,
> injects transactions, and monitors signing progress.

---

## Table of Contents

1. [What is a Coordinator?](#what-is-a-coordinator)
2. [Starting a Server](#starting-a-server)
3. [Sharing Session Credentials](#sharing-session-credentials)
4. [Using the Coordinator Panel (dApp)](#using-the-coordinator-panel-dapp)
5. [Injecting Transactions](#injecting-transactions)
6. [Monitoring Signing Progress](#monitoring-signing-progress)
7. [Session Management](#session-management)
8. [Scheduled Sessions](#scheduled-sessions)
9. [Working with Agents](#working-with-agents)
10. [Troubleshooting](#troubleshooting)

---

## What is a Coordinator?

The coordinator is the person who orchestrates a multi-sig signing session. While the coordinator does not have any special power over private keys or funds, they do manage the logistics of getting transactions signed.

**Coordinator responsibilities:**

- Start the signing server
- Share session credentials with participants
- Create and inject transactions for signing
- Monitor signature collection progress
- Ensure all participants can connect and sign
- Maintain the audit trail

**What the coordinator cannot do:**

- Access any participant's private key
- Sign on behalf of a participant
- Execute a transaction without meeting the signature threshold
- Modify a frozen transaction (it is cryptographically locked)

The coordinator holds a **Coordinator Token** which provides elevated privileges compared to regular participants, such as the ability to inject transactions into a session.

---

## Starting a Server

### Basic Server Command

Start a multi-sig session server with the minimum required options:

```bash
hedera-multisig server -t 2 -k "PUBLIC_KEY_1,PUBLIC_KEY_2,PUBLIC_KEY_3"
```

| Option | Description |
|--------|-------------|
| `-t, --threshold <n>` | **Required.** Number of signatures needed to execute. Must be less than or equal to the number of keys. |
| `-k, --keys <keys>` | **Required.** Comma-separated list of public keys that are eligible to sign. |

### Full Options Reference

```bash
hedera-multisig server \
  -t 2 \
  -k "KEY1,KEY2,KEY3" \
  --port 3001 \
  --host 0.0.0.0 \
  --timeout 60 \
  --pin MY_CUSTOM_PIN \
  --network testnet \
  --no-tunnel
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --participants <n>` | Same as key count | Expected number of participants. The server reports when all expected participants are connected. |
| `--port <port>` | `3000` | Port the WebSocket server listens on. |
| `--host <host>` | `localhost` | Host to bind to. Use `0.0.0.0` to accept connections from other machines on the network. |
| `--timeout <minutes>` | `30` | Session timeout in minutes. The session expires after this duration. |
| `--pin <token>` | Auto-generated | Custom session PIN. If not provided, a secure random PIN is generated. |
| `-n, --network <network>` | From environment | Hedera network: `testnet`, `mainnet`, or `previewnet`. |
| `--no-tunnel` | Tunnel enabled | Disable automatic tunnel creation (ngrok/localtunnel). Use this for local-only sessions. |
| `--tls-cert <path>` | None | Path to TLS certificate file. Enables secure WebSocket (WSS). |
| `--tls-key <path>` | None | Path to TLS private key file. Required with `--tls-cert`. |
| `--tls-ca <path>` | None | Path to CA certificate file. Optional. |
| `--tls-passphrase <pass>` | None | Passphrase for the TLS private key. |
| `--redis` | Disabled | Enable Redis for persistent session storage (survives server restarts). |
| `--redis-host <host>` | `localhost` | Redis server hostname. |
| `--redis-port <port>` | `6379` | Redis server port. |
| `--redis-password <pass>` | None | Redis authentication password. |

### Understanding the Server Output

When the server starts successfully, it displays the following credentials:

```
Session ID:        a1b2c3d4-e5f6-7890-abcd-ef1234567890
PIN:               XK7mR9
Coordinator Token: ct_a1b2c3d4e5f6789...
Agent API Key:     ak_x9y8z7w6v5u4t3...
Local URL:         ws://localhost:3001
Connection String: hmsc:eyJzIjoid3M6Ly9sb2NhbGhvc3Q6MzAwMSIsImkiOiJh...
```

**What each credential is for:**

| Credential | Share with | Purpose | Sensitivity |
|------------|-----------|---------|-------------|
| **Session ID** | All participants | Identifies the session to join | Low -- useless without PIN |
| **PIN** | All participants | Authenticates participant connections | Medium -- share via secure channel |
| **Coordinator Token** | Nobody (keep secret) | Proves you are the coordinator; required for injecting transactions and elevated actions | High -- keep this to yourself |
| **Agent API Key** | Automated agents only | Alternative to PIN for programmatic access; identifies the connection as an agent role | High -- share only with trusted agent operators |
| **Connection String** | All participants | Encodes the server URL, session ID, and PIN in a single string. Participants paste this to join. | Medium -- equivalent to sharing all three individually |

### TLS Configuration (Production)

For production use or remote participants, enable TLS to encrypt all WebSocket traffic:

```bash
hedera-multisig server \
  -t 2 \
  -k "KEY1,KEY2,KEY3" \
  --tls-cert ./certs/server.crt \
  --tls-key ./certs/server.key \
  --port 443
```

With TLS enabled, participants connect using `wss://` instead of `ws://`.

### Redis Persistence (Optional)

For long-running or production servers, enable Redis to persist session state:

```bash
hedera-multisig server \
  -t 3 \
  -k "KEY1,KEY2,KEY3,KEY4,KEY5" \
  --redis \
  --redis-host redis.internal.example.com \
  --redis-port 6379 \
  --redis-password YOUR_REDIS_PASSWORD
```

With Redis, sessions survive server restarts and can be inspected from other tools.

---

## Sharing Session Credentials

Once the server is running, you need to distribute session credentials to participants so they can connect.

### Connection String (Recommended)

The connection string is the easiest way to share credentials. It encodes the server URL, session ID, and PIN in a single `hmsc:...` string.

**How participants use it:**

CLI:
```bash
hedera-multisig participant --connect hmsc:eyJz...
```

Web app: Paste the connection string into the Join page at `/join`.

### QR Code

The server automatically displays a QR code in the terminal that participants can scan with the dApp on a mobile device or tablet.

### Manual Sharing

If you prefer to share credentials individually:

```
Server URL:  ws://your-server:3001
Session ID:  a1b2c3d4-e5f6-7890-abcd-ef1234567890
PIN:         XK7mR9
```

Participants join with:

```bash
hedera-multisig participant \
  -u ws://your-server:3001 \
  -s a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -p XK7mR9
```

### Secure Distribution Channels

| Channel | Security | Notes |
|---------|----------|-------|
| In-person / verbal | Highest | Best for the coordinator token |
| End-to-end encrypted messaging (Signal) | High | Good for connection strings and PINs |
| Encrypted email (PGP/S-MIME) | High | Good for formal environments |
| Internal company chat (Slack, Teams) | Medium | Acceptable for testnet; avoid for mainnet high-value |
| Unencrypted email | Low | Testnet only |

For high-value mainnet operations, share the PIN through a different channel than the session ID and server URL. This way, intercepting one channel alone is not enough to join.

---

## Using the Coordinator Panel (dApp)

The web-based dApp provides a graphical interface for session coordination.

### Starting the dApp

```bash
cd dapp
npm install    # first time only
npm run dev
```

The dApp runs at [http://localhost:3000](http://localhost:3000) by default.

### Creating a Session from the Browser

1. Navigate to `/create`
2. Enter the server URL (e.g., `ws://localhost:3001`)
3. Enter the session details (threshold, public keys)
4. The dApp connects to the server and creates a session
5. Share the resulting connection string with participants

### Monitoring from the Browser

The session page (`/session/[id]`) shows:
- Connected participants and their status
- Transaction details when injected
- Signature collection progress
- Execution status and transaction ID

### Building Transactions in the Browser

The dApp transaction builder (planned for Phase 5) will provide form-based transaction creation. Currently, transactions are created using the CLI and injected into sessions.

---

## Injecting Transactions

After participants have connected and marked themselves as ready, you inject a transaction for them to sign.

### The Pre-Session Workflow

This is the recommended approach for real-time signing:

1. **Start the server** and share credentials
2. **Wait for all participants** to connect and load their keys (this can take as long as needed -- minutes, hours, or even days)
3. The server will announce when all expected participants are ready
4. **Freeze the transaction** -- this starts the 120-second Hedera signing window
5. **Inject the frozen transaction** into the session
6. Participants review and sign within the 120-second window

Why this order matters: Hedera transactions expire 120 seconds after being frozen. If you freeze the transaction before participants are ready, you risk running out of time.

### Creating Transactions for Injection

Use any of the CLI commands to create frozen transactions:

**HBAR transfer:**
```bash
hedera-multisig transfer hbar --from 0.0.1234 --to 0.0.5678 --amount 100 --raw
```

**Token transfer:**
```bash
hedera-multisig transfer token --token 0.0.999 --from 0.0.1234 --to 0.0.5678 --amount 5000 --raw
```

**NFT transfer:**
```bash
hedera-multisig transfer nft --token 0.0.999 --serial 42 --from 0.0.1234 --to 0.0.5678 --raw
```

**Token association:**
```bash
hedera-multisig token associate --account 0.0.1234 --tokens 0.0.999,0.0.888 --raw
```

**Smart contract call:**
```bash
hedera-multisig offline freeze \
  -t contract-execute \
  -c 0.0.555 \
  --abi ./contract.json \
  --function approve \
  --args "0.0.1234,10000" \
  --raw
```

The `--raw` flag outputs only the base64 string, which is convenient for injection.

### Piping Commands

You can pipe the freeze output directly into other commands:

```bash
hedera-multisig transfer hbar --from 0.0.1234 --to 0.0.5678 --amount 100 --raw | \
  hedera-multisig offline decode -b "$(cat)"
```

### JSON Output for Automation

All transaction creation commands support `--json` for structured output:

```bash
hedera-multisig transfer hbar \
  --from 0.0.1234 \
  --to 0.0.5678 \
  --amount 100 \
  --json
```

Output:
```json
{
  "success": true,
  "transactionId": "0.0.1234@1710000000.000",
  "transactionType": "hbar-transfer",
  "base64": "CgQQBxgL...",
  "checksum": "a7b3c9d4e5f61234",
  "byteLength": 256
}
```

---

## Monitoring Signing Progress

### Server Console Output

The server terminal displays real-time updates as the session progresses:

```
Participant connected: participant-abc123
  Total connected: 1/3

Participant connected: participant-def456
  Total connected: 2/3

Participant ready: participant-abc123
  Total ready: 1/3

Participant ready: participant-def456
  Total ready: 2/3

All participants are ready! You can now inject a transaction.

Signature received from participant-abc123
  Signatures: 1/2

Signature received from participant-def456
  Signatures: 2/2

Signature threshold met!
  Ready to execute transaction

Transaction executed successfully!
  Transaction ID: 0.0.1234@1710000000.000
  Status: SUCCESS
```

### Session Status Command

Query the status of a running session from another terminal:

```bash
hedera-multisig session status --connect hmsc:eyJz...
```

This shows:
- Session state (waiting, signing, completed, expired)
- Number of connected participants
- Signature threshold and progress
- Time remaining before expiration

JSON output for scripts:

```bash
hedera-multisig session status --connect hmsc:eyJz... --json
```

### Session List Command

List all active sessions on a server (requires coordinator authentication):

```bash
hedera-multisig session list --url ws://localhost:3001
```

### Session States

A session progresses through these states:

| State | Description | What happens next |
|-------|-------------|-------------------|
| `waiting` | Server is up, waiting for participants to connect | Participants connect and load keys |
| `transaction-received` | A frozen transaction has been injected | Participants review and begin signing |
| `signing` | Participants are actively signing | Signatures accumulate toward threshold |
| `executing` | Threshold met, transaction is being submitted | Automatic execution on Hedera network |
| `completed` | Transaction executed successfully | Session can accept new transactions or be closed |
| `expired` | Session timeout reached | Start a new session |

---

## Session Management

### Session Timeout

Sessions automatically expire after the configured timeout (default: 30 minutes). You can adjust this:

```bash
hedera-multisig server -t 2 -k "KEY1,KEY2" --timeout 120
```

This sets the session to expire after 120 minutes (2 hours).

### Cancelling a Session

To cancel a running session, press `Ctrl+C` in the server terminal. This:
1. Disconnects all participants
2. Removes the `.multisig-session.json` file
3. Shuts down the WebSocket server cleanly

### Multiple Transactions per Session

After a transaction is executed successfully, the session remains open. You can inject additional transactions without participants needing to reconnect. This is useful for batch operations like:

1. Associate a new token
2. Transfer tokens from treasury
3. Execute a smart contract call

Each transaction goes through the full review-and-sign cycle.

### Session Auto-Discovery

When the server starts, it writes a `.multisig-session.json` file in the current working directory. Other scripts and tools can read this file to automatically detect the running session without manual credential entry.

---

## Scheduled Sessions

For teams where not all signers can be online simultaneously, use scheduled transactions instead of real-time sessions.

### Creating a Scheduled Transaction

1. Freeze the transaction you want to schedule:

```bash
hedera-multisig offline freeze \
  -t transfer \
  -f 0.0.1234 \
  -T 0.0.5678 \
  -a 1000 \
  --raw
```

2. Create a schedule on the Hedera network:

```bash
hedera-multisig schedule create \
  -b "BASE64_FROM_STEP_1" \
  --memo "March payroll - vendor ABC"
```

3. Share the **Schedule ID** (e.g., `0.0.98765`) with all signers.

### How Signers Participate

Each signer runs the schedule sign command at their convenience:

```bash
hedera-multisig schedule sign \
  --schedule-id 0.0.98765 \
  --key-file my-keys.encrypted \
  --passphrase "my-passphrase"
```

There is no time pressure -- signers can sign hours or days apart.

### Monitoring a Schedule

Check how many signatures have been collected:

```bash
hedera-multisig schedule status --schedule-id 0.0.98765
```

The output shows:
- Whether the schedule is pending, executed, or deleted
- The creator and payer accounts
- All signatories who have signed so far
- The schedule expiration time

### Advantages Over Real-Time Sessions

| Aspect | Real-Time Session | Scheduled Transaction |
|--------|------------------|----------------------|
| Signing window | 120 seconds | Hours or days |
| Requires server | Yes | No (on-chain) |
| All signers online at once | Ideally yes | No |
| Coordinator involvement | Active throughout | Only at creation |
| Execution | Coordinator triggers | Automatic when threshold met |

---

## Working with Agents

Automated agents (AI agents, bots, policy engines) can participate in signing sessions programmatically.

### What Agents Can Do

- Connect to a session using the **Agent API Key** (instead of a PIN)
- Receive frozen transactions automatically
- Apply policy rules (amount limits, approved recipients, time windows) to decide whether to sign
- Provide signatures without human intervention
- Disconnect after signing

### Sharing the Agent API Key

When you start a server, it generates an **Agent API Key** alongside the PIN and Coordinator Token. Share this key with the agent operator:

```
Agent API Key: ak_x9y8z7w6v5u4t3...
```

The agent uses this key to authenticate with the `agent` role, which is distinct from the `participant` role. This allows the server to track which connections are human vs. automated.

### Agent Policy Presets

Agents typically run with policy rules that constrain what they will automatically sign:

- **TreasuryAgent** -- signs transfers up to a configured maximum amount, only to pre-approved recipients
- **ApprovalBot** -- signs any transaction type within configured limits and time windows

See the [Agent Integration Guide](./AGENT_INTEGRATION.md) for full details on configuring agents with the `AgentSigningClient` and `PolicyEngine`.

### Mixed Sessions

A single session can include both human participants (using the dApp or CLI with PINs) and automated agents (using API keys). For example:

- 3-of-5 threshold
- 2 human signers using the dApp with hardware wallets
- 1 automated agent that auto-signs transfers under 100 HBAR to approved addresses

This gives you the flexibility to automate routine approvals while still requiring human oversight.

---

## Troubleshooting

### "Connection refused" when participants try to join

**Cause:** The server is not reachable from the participant's machine.

**Solutions:**
- If both machines are on the same network, use `--host 0.0.0.0` when starting the server
- Check that the port is not blocked by a firewall
- If participants are remote, remove `--no-tunnel` to enable automatic tunneling via ngrok or localtunnel
- Verify the URL protocol matches: `ws://` for unencrypted, `wss://` for TLS

### "Authentication failed" when joining

**Cause:** Wrong PIN, wrong session ID, or the session has expired.

**Solutions:**
- Double-check the PIN was copied correctly (it is case-sensitive)
- Verify the session ID matches
- Check if the session has expired (the server will log this)
- Try using the connection string instead of individual parameters to avoid copy-paste errors

### "Transaction expired" during signing

**Cause:** The 120-second Hedera transaction validity window elapsed before all signatures were collected.

**Solutions:**
- Make sure all participants are connected and ready BEFORE freezing the transaction
- Use the pre-session workflow: connect everyone first, then freeze and inject
- For distributed teams, use **scheduled transactions** which have no 120-second limit
- Reduce the threshold if appropriate
- Freeze a new transaction and try again

### Participant disconnects mid-signing

**Cause:** Network interruption, browser closed, or terminal closed.

**Solutions:**
- The participant can reconnect to the same session using a **reconnection token** (automatically handled by the client)
- If reconnection fails, the participant can rejoin with the original PIN
- Signatures already collected are preserved -- only the disconnected participant needs to re-sign
- If the transaction has expired during the disconnection, freeze a new one

### "Threshold cannot exceed number of keys"

**Cause:** You specified a threshold higher than the number of public keys.

**Solution:** The threshold must be less than or equal to the key count. For example, `-t 2 -k "KEY1,KEY2"` means 2-of-2 (both must sign). You cannot have `-t 3 -k "KEY1,KEY2"`.

### Server crashes or needs to restart

**Without Redis:** Session state is lost. Start a new server and have participants reconnect.

**With Redis:** Session state is preserved. Restart the server with the same `--redis` configuration and the session resumes.

### Port already in use

**Cause:** Another process is using the specified port.

**Solutions:**
- Use a different port: `--port 3002`
- Find and stop the conflicting process
- On Linux/macOS: `lsof -i :3001` to find what is using the port
- On Windows: `netstat -ano | findstr :3001`

### "Invalid key format" when starting server

**Cause:** One of the public keys in the `-k` option is malformed.

**Solutions:**
- Public keys should be DER-encoded hex strings (e.g., `302a300506032b6570032100...`)
- Do not include the `0x` prefix (the CLI adds it automatically)
- Make sure there are no spaces within individual keys
- Verify keys using: `hedera-multisig keys test` with the corresponding encrypted key file

### Tunnel creation fails

**Cause:** ngrok or localtunnel services are unreachable or not configured.

**Solutions:**
- Set `NGROK_AUTH_TOKEN` in your environment for ngrok
- Use `--no-tunnel` for local-only sessions
- Check your internet connection
- Try a different tunnel provider by using localtunnel as a fallback

---

## Quick Reference

### Starting a minimal session

```bash
hedera-multisig server -t 2 -k "KEY1,KEY2" --no-tunnel
```

### Starting a production session

```bash
hedera-multisig server \
  -t 3 \
  -k "KEY1,KEY2,KEY3,KEY4,KEY5" \
  --port 443 \
  --host 0.0.0.0 \
  --timeout 60 \
  --tls-cert ./certs/cert.pem \
  --tls-key ./certs/key.pem \
  --redis
```

### Participant joining via connection string

```bash
hedera-multisig participant --connect hmsc:eyJz... -f keys.encrypted
```

### Checking session status

```bash
hedera-multisig session status --connect hmsc:eyJz...
```

### Creating and injecting a transfer

```bash
hedera-multisig transfer hbar --from 0.0.1234 --to 0.0.5678 --amount 100
```

### Shutting down cleanly

Press `Ctrl+C` in the server terminal.

---

## Related Documentation

- [Getting Started](./GETTING_STARTED.md) -- Installation and first transaction
- [Treasury Guide](./TREASURY_GUIDE.md) -- All transaction types and treasury operations
- [Agent Integration](./AGENT_INTEGRATION.md) -- Building automated signing agents
- [Offline Signing Guide](./OFFLINE_SIGNING_GUIDE.md) -- Air-gapped signing workflow
- [Security Architecture](./SECURITY_ARCHITECTURE.md) -- Security model and threat analysis
