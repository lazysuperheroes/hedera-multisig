/**
 * Decoder Regression Fixtures (Phase C13)
 *
 * Builds canonical frozen transactions in-memory (no Hedera client required),
 * runs the shared decoder, and asserts the produced txDetails shape. The same
 * fixtures are exported as JSON snapshots in test/fixtures/decoder/ so the
 * dApp's TS decoder tests can compare against them — this is how we prevent
 * silent drift between the Node and browser decoders.
 *
 * Adding a new fixture: create a builder that returns a frozen transaction,
 * declare expectations, and call `assertFixture`. The fixture file is
 * regenerated on each run.
 */

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  TransferTransaction,
  TokenAssociateTransaction,
  TokenDissociateTransaction,
  TokenMintTransaction,
  TokenBurnTransaction,
  TokenCreateTransaction,
  ContractExecuteTransaction,
  ContractCreateTransaction,
  ScheduleSignTransaction,
  AccountCreateTransaction,
  AccountUpdateTransaction,
  AccountDeleteTransaction,
  AccountAllowanceApproveTransaction,
  Hbar,
  AccountId,
  TokenId,
  ContractId,
  TransactionId,
  PrivateKey,
  KeyList,
} = require('@hashgraph/sdk');

const {
  TransactionDecoder: SharedDecoder,
  getTransactionTypeName,
} = require('../shared/transaction-decoder');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'decoder');
const NODE_ACCOUNT_IDS = [new AccountId(3), new AccountId(4), new AccountId(5)];
const PAYER = '0.0.1001';

function freezeOffline(tx) {
  tx.setTransactionId(TransactionId.generate(PAYER));
  tx.setNodeAccountIds(NODE_ACCOUNT_IDS);
  return tx.freeze();
}

function ensureFixtureDir() {
  if (!fs.existsSync(FIXTURE_DIR)) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  }
}

function writeFixture(name, fixture) {
  ensureFixtureDir();
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
}

describe('Decoder Regression Fixtures (Phase C13)', function() {
  this.timeout(10000);

  it('TransferTransaction (HBAR)', function() {
    const tx = new TransferTransaction()
      .addHbarTransfer('0.0.1001', Hbar.fromTinybars(-1000))
      .addHbarTransfer('0.0.1002', Hbar.fromTinybars(1000));
    const frozen = freezeOffline(tx);

    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);

    expect(typeName).to.equal('TransferTransaction');
    expect(details.type).to.equal('TransferTransaction');
    expect(details.transactionId).to.be.a('string').and.match(/^0\.0\.1001@/);
    expect(details.transfers).to.be.an('array').with.lengthOf(2);
    const accounts = details.transfers.map((t) => t.accountId).sort();
    expect(accounts).to.deep.equal(['0.0.1001', '0.0.1002']);
    // Phase F3: amount is now raw tinybars (string), not "-1000 tℏ" formatted form.
    const amounts = details.transfers.map((t) => parseInt(t.amount, 10)).sort((a, b) => a - b);
    expect(amounts).to.deep.equal([-1000, 1000]);
    // Verify amount string is digits only (or leading minus) — no formatting cruft
    for (const t of details.transfers) {
      expect(t.amount).to.match(/^-?\d+$/);
    }

    writeFixture('transfer-hbar', {
      description: 'Simple HBAR transfer 0.0.1001 → 0.0.1002 (1000 tinybars)',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: {
        type: details.type,
        transferCount: details.transfers.length,
        accountIds: accounts,
      },
    });
  });

  it('TokenAssociateTransaction', function() {
    const tx = new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString('0.0.1001'))
      .setTokenIds([TokenId.fromString('0.0.5000'), TokenId.fromString('0.0.5001')]);
    const frozen = freezeOffline(tx);

    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);

    expect(typeName).to.equal('TokenAssociateTransaction');
    expect(details.accountId).to.equal('0.0.1001');
    expect(details.tokenIds).to.deep.equal(['0.0.5000', '0.0.5001']);

    writeFixture('token-associate', {
      description: 'Associate 0.0.1001 with two tokens',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: {
        type: details.type,
        accountId: details.accountId,
        tokenIds: details.tokenIds,
      },
    });
  });

  it('TokenDissociateTransaction', function() {
    const tx = new TokenDissociateTransaction()
      .setAccountId(AccountId.fromString('0.0.1001'))
      .setTokenIds([TokenId.fromString('0.0.5000')]);
    const frozen = freezeOffline(tx);

    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);

    expect(typeName).to.equal('TokenDissociateTransaction');
    expect(details.accountId).to.equal('0.0.1001');
    expect(details.tokenIds).to.deep.equal(['0.0.5000']);

    writeFixture('token-dissociate', {
      description: 'Dissociate 0.0.1001 from one token',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: {
        type: details.type,
        accountId: details.accountId,
        tokenIds: details.tokenIds,
      },
    });
  });

  it('TokenMintTransaction (fungible)', function() {
    const tx = new TokenMintTransaction()
      .setTokenId(TokenId.fromString('0.0.5000'))
      .setAmount(1000);
    const frozen = freezeOffline(tx);

    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);

    expect(typeName).to.equal('TokenMintTransaction');
    expect(details.type).to.equal('TokenMintTransaction');
    expect(details.tokenId).to.equal('0.0.5000');

    writeFixture('token-mint', {
      description: 'Mint 1000 of token 0.0.5000',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: {
        type: details.type,
        tokenId: details.tokenId,
      },
    });
  });

  it('ContractExecuteTransaction (no ABI)', function() {
    // Function selector for "increment()" = keccak256("increment()").slice(0,4)
    const selector = Buffer.from('d09de08a', 'hex'); // increment()
    const tx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString('0.0.6000'))
      .setGas(100000)
      .setFunctionParameters(selector);
    const frozen = freezeOffline(tx);

    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);

    expect(typeName).to.equal('ContractExecuteTransaction');
    expect(details.type).to.equal('ContractExecuteTransaction');
    expect(details.contractId).to.equal('0.0.6000');
    expect(details.gas).to.equal(100000);
    // Without an ABI, function name is not decoded but selector is preserved
    // in the raw function-parameters bytes — dApp decoder surfaces this via
    // `functionSelector`. The Node decoder doesn't expose it as a top-level
    // field today, but the bytes are recoverable from the frozen tx.

    writeFixture('contract-execute-no-abi', {
      description: 'ContractExecute increment() with no ABI provided',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: {
        type: details.type,
        contractId: details.contractId,
        gas: details.gas,
      },
    });
  });

  it('ScheduleSignTransaction', function() {
    const tx = new ScheduleSignTransaction()
      .setScheduleId('0.0.7000');
    const frozen = freezeOffline(tx);

    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);

    expect(typeName).to.equal('ScheduleSignTransaction');
    expect(details.type).to.equal('ScheduleSignTransaction');
    expect(details.scheduleId).to.equal('0.0.7000');

    writeFixture('schedule-sign', {
      description: 'Schedule sign for 0.0.7000',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: {
        type: details.type,
        scheduleId: details.scheduleId,
      },
    });
  });

  it('AccountCreateTransaction', function() {
    const newKey = PrivateKey.generateED25519().publicKey;
    const tx = new AccountCreateTransaction()
      .setKey(newKey)
      .setInitialBalance(Hbar.fromTinybars(10000));
    const frozen = freezeOffline(tx);

    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);

    expect(typeName).to.equal('AccountCreateTransaction');
    expect(details.type).to.equal('AccountCreateTransaction');

    writeFixture('account-create', {
      description: 'Create new account with 10000 tinybars initial balance',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: {
        type: details.type,
      },
    });
  });

  it('AccountUpdateTransaction (key rotation)', function() {
    const newKey = PrivateKey.generateED25519().publicKey;
    const tx = new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString('0.0.1001'))
      .setKey(newKey);
    const frozen = freezeOffline(tx);
    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);
    expect(typeName).to.equal('AccountUpdateTransaction');
    expect(details.type).to.equal('AccountUpdateTransaction');

    writeFixture('account-update', {
      description: 'Account-update for 0.0.1001 (single-key rotation)',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: { type: details.type },
    });
  });

  it('AccountDeleteTransaction', function() {
    const tx = new AccountDeleteTransaction()
      .setAccountId(AccountId.fromString('0.0.1001'))
      .setTransferAccountId(AccountId.fromString('0.0.1002'));
    const frozen = freezeOffline(tx);
    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);
    expect(typeName).to.equal('AccountDeleteTransaction');
    expect(details.type).to.equal('AccountDeleteTransaction');

    writeFixture('account-delete', {
      description: 'Delete 0.0.1001, sweep balance to 0.0.1002',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: { type: details.type },
    });
  });

  it('TokenCreateTransaction', function() {
    const tx = new TokenCreateTransaction()
      .setTokenName('WalkthroughToken')
      .setTokenSymbol('WTK')
      .setDecimals(8)
      .setInitialSupply(1000000)
      .setTreasuryAccountId(AccountId.fromString('0.0.1001'));
    const frozen = freezeOffline(tx);
    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);
    expect(typeName).to.equal('TokenCreateTransaction');
    expect(details.type).to.equal('TokenCreateTransaction');

    writeFixture('token-create', {
      description: 'Create fungible token WTK with 1M initial supply',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: { type: details.type },
    });
  });

  it('TokenBurnTransaction (fungible)', function() {
    const tx = new TokenBurnTransaction()
      .setTokenId(TokenId.fromString('0.0.5000'))
      .setAmount(500);
    const frozen = freezeOffline(tx);
    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);
    expect(typeName).to.equal('TokenBurnTransaction');
    expect(details.type).to.equal('TokenBurnTransaction');

    writeFixture('token-burn', {
      description: 'Burn 500 of token 0.0.5000',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: { type: details.type },
    });
  });

  it('ContractCreateTransaction (with bytecode)', function() {
    const tx = new ContractCreateTransaction()
      .setBytecode(Buffer.from('608060405234801561001057600080fd5b50', 'hex'))
      .setGas(100000);
    const frozen = freezeOffline(tx);
    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);
    expect(typeName).to.equal('ContractCreateTransaction');
    expect(details.type).to.equal('ContractCreateTransaction');

    writeFixture('contract-create', {
      description: 'ContractCreate with inline bytecode (Counter-style)',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: { type: details.type },
    });
  });

  it('AccountAllowanceApproveTransaction (HBAR allowance)', function() {
    const tx = new AccountAllowanceApproveTransaction()
      .approveHbarAllowance(
        AccountId.fromString('0.0.1001'),
        AccountId.fromString('0.0.1002'),
        Hbar.fromTinybars(1000)
      );
    const frozen = freezeOffline(tx);
    const typeName = getTransactionTypeName(frozen);
    const details = SharedDecoder.extractTransactionDetails(frozen, typeName);
    expect(typeName).to.equal('AccountAllowanceApproveTransaction');
    expect(details.type).to.equal('AccountAllowanceApproveTransaction');

    writeFixture('account-allowance-approve', {
      description: 'HBAR allowance: 0.0.1001 → 0.0.1002 for 1000 tinybars',
      inputBase64: Buffer.from(frozen.toBytes()).toString('base64'),
      expectedShape: { type: details.type },
    });
  });

  it('produces 13 fixture JSON files', function() {
    ensureFixtureDir();
    const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).to.be.at.least(13);
  });
});
