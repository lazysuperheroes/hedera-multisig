/**
 * Inject Command
 *
 * Push a pre-frozen transaction into a running coordinator session via
 * WebSocket. The third multi-sig injection path (alongside dApp build-from-form
 * and dApp paste-frozen-base64). Useful for fully-CLI-driven workflows and
 * automation pipelines.
 *
 * Usage:
 *   hedera-multisig inject --connect "hmsc:..." --base64 "CgQQ..." \
 *     --coordinator-token "..."
 *
 *   hedera-multisig inject --connect "hmsc:..." --base64-file ./tx.json \
 *     --coordinator-token "..."
 *
 * The --base64-file form reads the JSON output of
 * `examples/walkthrough-contract/07-prepare-multisig-increment.js` (and
 * similar prep scripts) and extracts the `frozenBase64` field.
 *
 * Authenticates as a coordinator (requires PIN + coordinator token), sends
 * TRANSACTION_INJECT, waits for TRANSACTION_RECEIVED or INJECTION_FAILED,
 * exits 0 on success / 1 on failure / 2 on auth or connection error.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const chalk = require('chalk');
const { parseConnectionString } = require('../../shared/connection-string');

const INJECT_TIMEOUT_MS = 15000;
const AUTH_TIMEOUT_MS = 10000;

module.exports = function(program) {
  program
    .command('inject')
    .description('Inject a pre-frozen transaction into a running coordinator session')
    .requiredOption('--connect <connStr>', 'Connection string from server output (hmsc:... format)')
    .option('--base64 <data>', 'Base64-encoded frozen transaction bytes')
    .option('--base64-file <path>', 'JSON file containing a `frozenBase64` field (e.g. output of 07-prepare-multisig-increment.js)')
    .option('--coordinator-token <token>', 'Coordinator token (also reads HEDERA_MULTISIG_COORDINATOR_TOKEN env var)')
    .option('--label <name>', 'Coordinator label for logs', 'cli-inject')
    .option('--timeout <ms>', 'Inject timeout in milliseconds', parseInt, INJECT_TIMEOUT_MS)
    .addHelpText('after', `
Examples:
  # Inline base64 (good for short transactions and shell pipelines)
  $ hedera-multisig inject \\
      --connect "hmsc:eyJzIjoid3M6Ly9sb2NhbGhvc3Q6MzAwMSIsImkiOiJhYmMxMjMiLCJwIjoiVEVTVFBJTjEifQ==" \\
      --base64 "CgQQBxgL..." \\
      --coordinator-token "abc...def"

  # From a file written by the walkthrough prep scripts
  $ node examples/walkthrough-contract/07-prepare-multisig-increment.js
  $ hedera-multisig inject \\
      --connect "$(... server connection string ...)" \\
      --base64-file examples/walkthrough-contract/multisig-increment-tx.json \\
      --coordinator-token "..."

  # From stdin (sed/jq pipelines)
  $ cat tx.b64 | xargs -I{} hedera-multisig inject --connect "..." --base64 "{}" --coordinator-token "..."

After injection succeeds, participants in the running session see the
transaction in their TransactionReview UI and can sign. Once threshold
is met, the coordinator submits the signed transaction to Hedera.

Exit codes:
  0 — TRANSACTION_RECEIVED (injection succeeded)
  1 — INJECTION_FAILED / ERROR / timeout
  2 — bad arguments, AUTH failure, or connection error
    `)
    .action(async (options) => {
      try {
        const base64 = await loadBase64(options);
        const conn = parseConnectionString(options.connect);
        if (!conn) failArgs(`Invalid connection string: ${options.connect.slice(0, 24)}…`);

        const coordinatorToken = options.coordinatorToken || process.env.HEDERA_MULTISIG_COORDINATOR_TOKEN;
        if (!coordinatorToken) {
          failArgs('Missing --coordinator-token (or HEDERA_MULTISIG_COORDINATOR_TOKEN env var). The coordinator token is printed by the server CLI when it starts.');
        }

        console.log(chalk.bold.cyan('\n━━━ Inject frozen transaction ━━━'));
        console.log(chalk.gray(`Server: ${conn.serverUrl}`));
        console.log(chalk.gray(`Session: ${conn.sessionId}`));
        console.log(chalk.gray(`Bytes: ${base64.length} base64 chars (~${Math.round(base64.length * 3 / 4)} raw bytes)`));

        const result = await injectViaWebSocket({
          serverUrl: conn.serverUrl,
          sessionId: conn.sessionId,
          pin: conn.pin,
          coordinatorToken,
          frozenBase64: base64,
          label: options.label,
          timeoutMs: options.timeout || INJECT_TIMEOUT_MS,
        });

        if (result.ok) {
          console.log(chalk.bold.green('\n✅ Transaction injected. Participants will now sign.\n'));
          if (result.transactionId) {
            console.log(chalk.gray(`   Transaction ID: ${result.transactionId}`));
          }
          process.exit(0);
        }

        console.error(chalk.red(`\n❌ Injection rejected: ${result.error}\n`));
        process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n❌ ${err.message}\n`));
        process.exit(2);
      }
    });
};

async function loadBase64(options) {
  if (options.base64 && options.base64File) {
    failArgs('Specify --base64 OR --base64-file, not both.');
  }
  if (options.base64) {
    return options.base64.trim();
  }
  if (options.base64File) {
    const filePath = path.resolve(options.base64File);
    if (!fs.existsSync(filePath)) failArgs(`File not found: ${filePath}`);
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    // F1b: only attempt JSON parse when the file LOOKS like JSON (starts with `{`).
    // Previous heuristic try-parsed everything — a partially-valid JSON file
    // would fall through to "treat as raw base64" silently. With the leading-`{`
    // gate, malformed JSON now fails loudly instead of being mis-treated.
    if (raw.startsWith('{')) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        failArgs(`File ${filePath} starts with '{' but is not valid JSON: ${err.message}`);
      }
      if (typeof parsed.frozenBase64 === 'string') return parsed.frozenBase64.trim();
      failArgs(`File ${filePath} is JSON but has no \`frozenBase64\` field.`);
    }
    return raw; // Plain base64 file
  }
  failArgs('Provide --base64 <data> or --base64-file <path>.');
}

function failArgs(msg) {
  console.error(chalk.red(`\n❌ ${msg}\n`));
  process.exit(2);
}

function injectViaWebSocket({ serverUrl, sessionId, pin, coordinatorToken, frozenBase64, label, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(serverUrl);

    let phase = 'connecting';
    const overall = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`Operation timed out in phase '${phase}' after ${timeoutMs + AUTH_TIMEOUT_MS}ms`));
    }, timeoutMs + AUTH_TIMEOUT_MS);

    ws.on('open', () => {
      phase = 'auth';
      ws.send(JSON.stringify({
        type: 'AUTH',
        payload: {
          sessionId,
          pin,
          role: 'coordinator',
          label,
          coordinatorToken,
        },
      }));
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type === 'AUTH_FAILED') {
        clearTimeout(overall);
        ws.close();
        return reject(new Error(`AUTH_FAILED: ${msg.payload?.message || 'unknown'} (code: ${msg.payload?.code})`));
      }

      if (msg.type === 'AUTH_SUCCESS' && phase === 'auth') {
        phase = 'inject';
        ws.send(JSON.stringify({
          type: 'TRANSACTION_INJECT',
          payload: { frozenTransaction: frozenBase64 },
        }));
        return;
      }

      if (msg.type === 'TRANSACTION_RECEIVED' && phase === 'inject') {
        clearTimeout(overall);
        ws.close();
        return resolve({
          ok: true,
          transactionId: msg.payload?.txDetails?.transactionId || msg.payload?.transactionId || null,
        });
      }

      if (msg.type === 'INJECTION_FAILED' || msg.type === 'ERROR') {
        clearTimeout(overall);
        ws.close();
        return resolve({
          ok: false,
          error: msg.payload?.message || msg.type,
        });
      }
    });

    ws.on('error', (err) => {
      clearTimeout(overall);
      reject(new Error(`WebSocket error in phase '${phase}': ${err.message}`));
    });

    ws.on('close', (code, reason) => {
      // Only error on close if we haven't already resolved
      if (phase !== 'done') {
        clearTimeout(overall);
        if (phase === 'connecting' || phase === 'auth') {
          reject(new Error(`Connection closed unexpectedly in phase '${phase}' (code ${code}): ${reason || 'no reason given'}`));
        }
      }
    });
  });
}
