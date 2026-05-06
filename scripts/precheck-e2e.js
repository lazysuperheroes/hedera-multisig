#!/usr/bin/env node
/**
 * One-stop precheck before running end-to-end tests.
 *
 * Verifies the environment is wired up enough to run:
 *   - examples/walkthrough-hbar (Scenario 11)
 *   - examples/walkthrough-contract (Scenario 12)
 *   - examples/walkthrough-dapp (Scenario 13 — hosted dApp + ngrok)
 *   - the dApp at http://localhost:3000
 *   - networked + tunnel scenarios
 *
 * Read-only — never writes to disk or chain.
 *
 * Exit codes:
 *   0  all required checks passed (warnings may be present)
 *   1  one or more required checks failed
 *
 * Usage:
 *   node scripts/precheck-e2e.js
 *   node scripts/precheck-e2e.js --quick   # skip the on-chain balance query
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { Client, AccountId, PrivateKey, AccountBalanceQuery } = require('@hashgraph/sdk');
const chalk = require('chalk');

const REPO_ROOT = path.resolve(__dirname, '..');
const RECOMMENDED_OPERATOR_HBAR = 30; // enough for all three walkthroughs (~6 + ~10 + ~6 + buffer)
const MIN_NODE_MAJOR = 20;

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    quick: argv.includes('--quick'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

const results = []; // { level: 'pass'|'warn'|'fail', label, detail }
function pass(label, detail = '') { results.push({ level: 'pass', label, detail }); }
function warn(label, detail = '') { results.push({ level: 'warn', label, detail }); }
function failCheck(label, detail = '') { results.push({ level: 'fail', label, detail }); }

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= MIN_NODE_MAJOR) {
    pass('Node version', `v${process.versions.node}`);
  } else {
    failCheck('Node version', `v${process.versions.node} — need ≥ v${MIN_NODE_MAJOR}.0.0 (see package.json engines)`);
  }
}

function checkRepoEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    failCheck('.env at repo root', 'missing — copy from .env.example and fill OPERATOR_ID, OPERATOR_KEY');
    return false;
  }
  pass('.env at repo root', envPath);

  const required = ['OPERATOR_ID', 'OPERATOR_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    failCheck('Required env vars', `missing: ${missing.join(', ')}`);
    return false;
  }
  pass('Required env vars', 'OPERATOR_ID, OPERATOR_KEY');

  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  if (!['testnet', 'previewnet', 'mainnet'].includes(network)) {
    warn('HEDERA_NETWORK', `unknown value "${network}" — defaulting to testnet`);
  } else if (network === 'mainnet') {
    warn('HEDERA_NETWORK', 'set to mainnet — walkthroughs will spend REAL HBAR. Use testnet for tests.');
  } else {
    pass('HEDERA_NETWORK', network);
  }

  return true;
}

async function checkOperatorOnChain() {
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  let client;
  try {
    client = network === 'mainnet'
      ? Client.forMainnet()
      : (network === 'previewnet' ? Client.forPreviewnet() : Client.forTestnet());
    client.setOperator(
      AccountId.fromString(process.env.OPERATOR_ID),
      PrivateKey.fromString(process.env.OPERATOR_KEY)
    );
  } catch (err) {
    failCheck('Operator client', err.message);
    return;
  }
  pass('Operator client', `connected to ${network}`);

  let bal;
  try {
    const balance = await new AccountBalanceQuery()
      .setAccountId(process.env.OPERATOR_ID)
      .execute(client);
    bal = balance.hbars.toBigNumber().toNumber();
  } catch (err) {
    failCheck('Operator balance query', err.message);
    client.close();
    return;
  } finally {
    client.close();
  }

  const labelDetail = `${bal.toFixed(2)} ℏ`;
  if (bal >= RECOMMENDED_OPERATOR_HBAR) {
    pass('Operator balance', `${labelDetail} (≥ ${RECOMMENDED_OPERATOR_HBAR} ℏ recommended)`);
  } else if (bal >= 5) {
    warn(
      'Operator balance',
      `${labelDetail} — enough for the HBAR walkthrough alone. ` +
      `Recommend ≥ ${RECOMMENDED_OPERATOR_HBAR} ℏ for both. Refill: https://portal.hedera.com/`
    );
  } else {
    failCheck(
      'Operator balance',
      `${labelDetail} — too low. Refill at https://portal.hedera.com/ → select account → "Refill Account"`
    );
  }
}

function checkRootDeps() {
  const nm = path.join(REPO_ROOT, 'node_modules');
  if (fs.existsSync(nm)) {
    pass('Root node_modules', 'installed');
  } else {
    failCheck('Root node_modules', 'missing — run `npm install` at repo root');
  }
}

function checkDapp() {
  const dappDir = path.join(REPO_ROOT, 'dapp');
  if (!fs.existsSync(dappDir)) {
    failCheck('dapp/ directory', 'missing');
    return;
  }
  pass('dapp/ directory', dappDir);

  const dappNm = path.join(dappDir, 'node_modules');
  if (fs.existsSync(dappNm)) {
    pass('dapp/node_modules', 'installed');
  } else {
    warn('dapp/node_modules', 'missing — run `cd dapp && npm install` before browser tests');
  }

  const envLocal = path.join(dappDir, '.env.local');
  const envFile = path.join(dappDir, '.env');
  let dappEnv = null;
  if (fs.existsSync(envLocal)) dappEnv = envLocal;
  else if (fs.existsSync(envFile)) dappEnv = envFile;

  if (!dappEnv) {
    warn('dapp/.env.local', 'missing — copy from dapp/.env.example and set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID');
    return;
  }

  const contents = fs.readFileSync(dappEnv, 'utf8');
  const wcMatch = contents.match(/NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID\s*=\s*(.+)/);
  if (!wcMatch || !wcMatch[1].trim() || wcMatch[1].trim() === 'your_project_id_here') {
    warn(
      'WalletConnect project ID',
      'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not set in dapp/.env.local. ' +
      'Get one at https://cloud.walletconnect.com/ (free).'
    );
  } else {
    pass('WalletConnect project ID', `set in ${path.relative(REPO_ROOT, dappEnv)}`);
  }

  const networkMatch = contents.match(/NEXT_PUBLIC_DEFAULT_NETWORK\s*=\s*(.+)/);
  if (networkMatch) {
    pass('dApp default network', networkMatch[1].trim());
  } else {
    warn('dApp default network', 'NEXT_PUBLIC_DEFAULT_NETWORK not set — defaults to testnet');
  }
}

function checkNgrok() {
  const token = process.env.NGROK_AUTH_TOKEN;
  if (token && token.length >= 20) {
    pass('NGROK_AUTH_TOKEN', 'set (length ' + token.length + ')');
  } else {
    warn(
      'NGROK_AUTH_TOKEN',
      'not set. Required only for remote-participant tests with `--tunnel ngrok`. ' +
      'Skip if using `--no-tunnel` or `--tunnel localtunnel`. ' +
      'Sign up: https://dashboard.ngrok.com/signup → token at https://dashboard.ngrok.com/get-started/your-authtoken'
    );
  }
}

function checkTestEnv() {
  const stateFile = path.join(REPO_ROOT, '.testenv.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      pass('.testenv.json', `${state.accounts.length} accounts on ${state.network}`);
    } catch {
      warn('.testenv.json', 'exists but is unreadable — delete and re-run `npm run setup-test-env`');
    }
  } else {
    pass(
      '.testenv.json',
      'not present (only needed for Phase 2.6 agent-signing tests; see TESTING.md)'
    );
  }
}

function checkWalkthroughArtifacts() {
  // Each walkthrough is self-contained as of Phase G/H — they own their
  // own keys + state files. Surface whichever ones are already populated
  // so the operator knows what they can skip if they want to chain runs.
  const dirs = [
    { name: 'hbar', dir: 'walkthrough-hbar' },
    { name: 'contract', dir: 'walkthrough-contract' },
    { name: 'dapp', dir: 'walkthrough-dapp' },
  ];

  let anyArtifacts = false;
  for (const { name, dir } of dirs) {
    const stateFile = name === 'contract' ? 'demo-account-state.json' : 'walkthrough-state.json';
    const keysPath = path.join(REPO_ROOT, 'examples', dir, 'walkthrough-keys.json');
    const statePath = path.join(REPO_ROOT, 'examples', dir, stateFile);
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const acct = state.thresholdAccountId || state.demoAccountId || 'unknown';
        pass(`Walkthrough state (${name})`, `account ${acct} on ${state.network || 'testnet'}`);
        anyArtifacts = true;
      } catch {
        warn(`Walkthrough state (${name})`, `${stateFile} exists but is unreadable`);
      }
    } else if (fs.existsSync(keysPath)) {
      pass(`Walkthrough keys (${name})`, 'present (run next-stage script to create the account)');
      anyArtifacts = true;
    }
  }

  if (!anyArtifacts) {
    pass('Walkthrough artifacts', 'clean (each walkthrough will create its own under examples/walkthrough-*)');
  }
}

function printResults(args) {
  const longest = Math.max(...results.map((r) => r.label.length));
  console.log(chalk.bold.cyan('\n━━━ Pre-flight: end-to-end test environment ━━━\n'));

  for (const r of results) {
    const label = r.label.padEnd(longest);
    if (r.level === 'pass') {
      console.log(chalk.green('✓'), label, chalk.gray(r.detail));
    } else if (r.level === 'warn') {
      console.log(chalk.yellow('⚠'), label, chalk.yellow(r.detail));
    } else {
      console.log(chalk.red('✗'), label, chalk.red(r.detail));
    }
  }

  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  const passes = results.filter((r) => r.level === 'pass').length;
  console.log(chalk.gray(`\n  ${passes} passed, ${warns} warnings, ${fails} failed`));

  if (fails > 0) {
    console.log(chalk.bold.red('\n❌ Pre-flight failed. Fix the items marked ✗ above before running tests.\n'));
    process.exit(1);
  }

  if (args.quick) {
    console.log(chalk.bold.yellow('\n⚠  Quick mode — on-chain checks skipped.\n'));
  }

  if (warns > 0) {
    console.log(chalk.bold.yellow('\n✅ Pre-flight passed (with warnings).'));
    console.log(chalk.gray('   Warnings indicate optional gear (ngrok, dApp, .testenv.json) that you may not need depending on which scenarios you run.'));
  } else {
    console.log(chalk.bold.green('\n✅ Pre-flight passed cleanly.'));
  }

  console.log(chalk.bold.cyan('\nNext: see TESTING.md → Phase 1 (scripted walkthroughs).\n'));
  process.exit(0);
}

function showHelp() {
  console.log(`
Usage: node scripts/precheck-e2e.js [options]

Verifies your local environment is ready to run hedera-multisig E2E tests.
Read-only — does not modify files or submit transactions.

Options:
  --quick    Skip the on-chain operator-balance query (faster, still validates env)
  --help, -h Show this help

Exit codes:
  0  all required checks passed (warnings may be present)
  1  one or more required checks failed
`);
}

async function main() {
  const args = parseArgs();
  if (args.help) { showHelp(); return; }

  checkNode();
  const envOk = checkRepoEnv();
  checkRootDeps();
  if (envOk && !args.quick) await checkOperatorOnChain();
  checkDapp();
  checkNgrok();
  checkTestEnv();
  checkWalkthroughArtifacts();

  printResults(args);
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Pre-check crashed:'), err.stack || err.message);
  process.exit(1);
});
