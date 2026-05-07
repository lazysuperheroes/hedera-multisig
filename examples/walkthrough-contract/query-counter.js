#!/usr/bin/env node
/**
 * Walkthrough utility (contract): read `Counter.getCount()` for free via
 * the mirror node.
 *
 * Why mirror node, not `ContractCallQuery`:
 *   - `ContractCallQuery` (consensus query) is a paid read — the operator
 *     pays a small HBAR fee per call.
 *   - The mirror node's `POST /api/v1/contracts/call` endpoint (HIP-584)
 *     runs the same EVM execution against archived state, gas-free, and
 *     doesn't require any operator credentials. For `view` / `pure`
 *     functions like `getCount()`, this is strictly the better option.
 *
 * Mirror lag: the mirror node trails consensus by a few seconds. If you
 * run this script ≥5s after the increment ceremony lands, you're fine.
 * If you script it immediately after a tx, pass `--wait` so the client
 * polls with backoff until the mirror catches up to the new state.
 *
 * Usage:
 *   node query-counter.js                # one-shot read (run ≥5s after a tx)
 *   node query-counter.js --wait         # poll until mirror has fresh state (~30s budget)
 *   node query-counter.js --wait --expect 2   # poll until count >= 2 (use right after a tx)
 *
 * Exit codes:
 *   0 — read succeeded; count printed to stdout
 *   1 — usage / state-file error
 *   2 — mirror call failed
 *   3 — `--expect <n>` provided but count never reached the expected value
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { Interface } = require('ethers');
const chalk = require('chalk');
const MirrorNodeClient = require('../../shared/mirror-node-client');

const STATE_FILE = path.resolve(__dirname, 'demo-account-state.json');
const ARTIFACT_FILE = path.resolve(__dirname, 'Counter.json');

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { wait: false, expect: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wait') args.wait = true;
    else if (a === '--expect') args.expect = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node query-counter.js [--wait] [--expect <n>]

  --wait          Poll the mirror with backoff to absorb the ~5s lag
                  after a recent on-chain tx. Without this, the script
                  reads whatever state the mirror has right now.

  --expect <n>    With --wait, keep polling until the returned count is
                  >= n (e.g. --expect 2 right after the second
                  increment). Exits 3 if the value never reaches n.`);
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();

  if (!fs.existsSync(STATE_FILE)) fail('Run 01-create-demo-eoa.js + 02-deploy-as-eoa.js first.', 1);
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state.contractId) fail('No contractId in demo-account-state.json — run 02-deploy-as-eoa.js.', 1);

  if (!fs.existsSync(ARTIFACT_FILE)) fail('Counter.json artifact missing.', 1);
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_FILE, 'utf8'));
  const iface = new Interface(artifact.abi);

  const network = state.network || 'testnet';
  const mirror = new MirrorNodeClient(network);
  const data = iface.encodeFunctionData('getCount');

  // The mirror's POST /api/v1/contracts/call endpoint requires
  // 0x-prefixed EVM addresses for `to` and `from` — it rejects the
  // `0.0.X` shorthand with HTTP 400 ("to field invalid hexadecimal
  // string"). Resolve both up front:
  //   - Contract: long-zero is canonical for contract entities; no
  //     mirror lookup needed.
  //   - Operator (used as `from`): mirror lookup with long-zero
  //     fallback. Long-zero is correct for ED25519 accounts; ECDSA
  //     accounts have a public-key-derived alias that only the mirror
  //     knows about.
  // The `from` field is technically optional for view functions per
  // the HIP-584 docs, but several mirror builds reject calls without
  // it, so we always supply it when an OPERATOR_ID is configured.
  const toAddr = mirror.contractToEvmAddress(state.contractId);
  let fromAddr = null;
  if (process.env.OPERATOR_ID) {
    try {
      fromAddr = await mirror.accountToEvmAddress(process.env.OPERATOR_ID);
    } catch {
      // Operator lookup failed (offline mirror, etc.) — proceed
      // without `from`. The endpoint may still accept it for view
      // calls; if not, the error surfaces with a clear message below.
    }
  }

  // Polling budget when --wait is set: 12 attempts × 2.5s = 30s.
  // That comfortably covers the typical 3–8s mirror lag with margin
  // for occasional spikes during testnet load. If --expect is set we
  // also keep polling until the value reaches the expected threshold;
  // otherwise the first successful response wins.
  const callOpts = args.wait
    ? { pollMs: 2500, maxAttempts: 12 }
    : { pollMs: 2500, maxAttempts: 1 };

  console.log(chalk.bold.cyan('\n━━━ Query Counter.getCount() via mirror node ━━━\n'));
  console.log(chalk.gray(`Contract: ${state.contractId} (${toAddr})`));
  console.log(chalk.gray(`Network:  ${network}`));
  if (fromAddr) {
    console.log(chalk.gray(`From:     ${process.env.OPERATOR_ID} (${fromAddr})`));
  }
  if (args.wait) {
    console.log(chalk.gray(`Polling:  up to ${callOpts.maxAttempts} attempts × ${callOpts.pollMs}ms`));
  }
  if (args.expect != null && !Number.isNaN(args.expect)) {
    console.log(chalk.gray(`Expect:   count >= ${args.expect}`));
  }
  console.log('');

  let lastCount = null;
  for (let attempt = 1; attempt <= callOpts.maxAttempts; attempt++) {
    let response;
    try {
      response = await mirror.callContract({
        to: toAddr,
        data,
        ...(fromAddr ? { from: fromAddr } : {}),
        estimate: false,
        // Single-shot per attempt: the outer loop below handles the
        // count-watching retry budget. Inner client retry is set to 1
        // so 4xx (revert / bad calldata) bail immediately.
        opts: { maxAttempts: 1 },
      });
    } catch (err) {
      if (attempt === callOpts.maxAttempts) {
        console.error(chalk.red(`❌ Mirror call failed: ${err.message}\n`));
        process.exit(2);
      }
      // Transient — wait and retry.
      await new Promise((r) => setTimeout(r, callOpts.pollMs));
      continue;
    }

    const [count] = iface.decodeFunctionResult('getCount', response.result);
    lastCount = typeof count === 'bigint' ? count : BigInt(count.toString());

    const emoji = args.expect != null ? (lastCount >= BigInt(args.expect) ? '✅' : '⏳') : '✅';
    if (args.wait || attempt > 1) {
      console.log(chalk.gray(`  attempt ${attempt}/${callOpts.maxAttempts}: count = ${lastCount.toString()} ${emoji}`));
    }

    // Done if we hit the expected threshold (or weren't watching for one).
    if (args.expect == null || Number.isNaN(args.expect)) break;
    if (lastCount >= BigInt(args.expect)) break;

    if (attempt < callOpts.maxAttempts) {
      await new Promise((r) => setTimeout(r, callOpts.pollMs));
    }
  }

  if (lastCount == null) {
    console.error(chalk.red('❌ No successful mirror call after retry budget.\n'));
    process.exit(2);
  }

  console.log(chalk.bold(`\nCounter: ${chalk.green(lastCount.toString())}`));
  console.log(chalk.gray(`(read via free mirror-node call — no HBAR spent)\n`));

  if (args.expect != null && !Number.isNaN(args.expect) && lastCount < BigInt(args.expect)) {
    console.error(chalk.yellow(`⚠  Expected count >= ${args.expect}; mirror returned ${lastCount.toString()}.`));
    console.error(chalk.gray(`   The on-chain tx may not have landed, or mirror lag exceeded the polling budget.\n`));
    process.exit(3);
  }
}

function fail(msg, code = 1) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(code);
}

main().catch((err) => {
  console.error(chalk.red('\n❌ ') + (err.stack || err.message) + '\n');
  process.exit(2);
});
