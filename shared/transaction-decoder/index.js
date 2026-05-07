/**
 * Shared Transaction Decoder
 *
 * Universal transaction decoder that works in both Node.js and browser environments.
 * Provides cryptographically verified transaction decoding and metadata validation.
 *
 * Based on dapp/lib/transaction-decoder.ts with full transaction type support.
 */

const {
  Transaction,
  TransferTransaction,
  TokenAssociateTransaction,
  TokenDissociateTransaction,
  AccountCreateTransaction,
  AccountUpdateTransaction,
  AccountDeleteTransaction,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractDeleteTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenBurnTransaction,
  TokenUpdateTransaction,
  TokenDeleteTransaction,
  TopicCreateTransaction,
  TopicUpdateTransaction,
  TopicDeleteTransaction,
  TopicMessageSubmitTransaction,
  FileCreateTransaction,
  FileUpdateTransaction,
  FileDeleteTransaction,
  FileAppendTransaction,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  ScheduleDeleteTransaction,
  AccountAllowanceApproveTransaction,
  AccountAllowanceDeleteTransaction,
  TokenFreezeTransaction,
  TokenUnfreezeTransaction,
} = require('@hashgraph/sdk');

// Lazy-load ethers — only needed when contractInterface/ABI is provided for
// smart contract decoding. Avoids loading 1.2MB+ module for non-contract usage.
let ethers = null;
function getEthers() {
  if (!ethers) {
    ethers = require('ethers').ethers;
  }
  return ethers;
}
const { sha256, generateChecksum, bufferToHex } = require('./crypto');

/**
 * @typedef {Object} DecodedTransaction
 * @property {string} type - Transaction type name
 * @property {string} checksum - SHA-256 checksum (full hash)
 * @property {string} shortChecksum - Truncated checksum (16 chars)
 * @property {Uint8Array} bytes - Raw transaction bytes
 * @property {TransactionDetails} details - Extracted transaction details
 */

/**
 * @typedef {Object} TransactionDetails
 * @property {string} type - Transaction type
 * @property {string} [transactionId] - Transaction ID
 * @property {string[]} [nodeAccountIds] - Node account IDs
 * @property {string} [maxTransactionFee] - Max fee
 * @property {string} [transactionMemo] - Memo
 * @property {number} [validStartTimestamp] - Unix timestamp in seconds
 * @property {number} [transactionValidDuration] - Duration in seconds
 * @property {number} [expiresAt] - Unix timestamp when transaction expires
 * @property {Array<{accountId: string, amount: string}>} [transfers] - HBAR transfers
 * @property {Array<{tokenId: string, transfers: Array<{accountId: string, amount: string}>}>} [tokenTransfers] - Token transfers
 * @property {Array<{tokenId: string, transfers: Array<{senderAccountId: string, receiverAccountId: string, serialNumber: number}>}>} [nftTransfers] - NFT transfers
 * @property {string[]} [tokenIds] - Token IDs (for associate/dissociate)
 * @property {string} [accountId] - Account ID
 * @property {string} [contractId] - Contract ID
 * @property {number} [gas] - Gas limit
 * @property {string} [functionName] - Contract function name
 * @property {Object} [functionParams] - Decoded function parameters
 * @property {string} [amount] - Payable amount
 * @property {boolean} [selectorVerified] - Whether function selector was cryptographically verified
 */

/**
 * Get transaction type name using instanceof checks (minification-safe)
 *
 * @param {Transaction} transaction - Hedera transaction
 * @returns {string} Transaction type name
 */
function getTransactionTypeName(transaction) {
  // Transfer types
  if (transaction instanceof TransferTransaction) return 'TransferTransaction';

  // Token types
  if (transaction instanceof TokenAssociateTransaction) return 'TokenAssociateTransaction';
  if (transaction instanceof TokenDissociateTransaction) return 'TokenDissociateTransaction';
  if (transaction instanceof TokenCreateTransaction) return 'TokenCreateTransaction';
  if (transaction instanceof TokenMintTransaction) return 'TokenMintTransaction';
  if (transaction instanceof TokenBurnTransaction) return 'TokenBurnTransaction';
  if (transaction instanceof TokenUpdateTransaction) return 'TokenUpdateTransaction';
  if (transaction instanceof TokenDeleteTransaction) return 'TokenDeleteTransaction';

  // Account types
  if (transaction instanceof AccountCreateTransaction) return 'AccountCreateTransaction';
  if (transaction instanceof AccountUpdateTransaction) return 'AccountUpdateTransaction';
  if (transaction instanceof AccountDeleteTransaction) return 'AccountDeleteTransaction';

  // Contract types
  if (transaction instanceof ContractCreateTransaction) return 'ContractCreateTransaction';
  if (transaction instanceof ContractExecuteTransaction) return 'ContractExecuteTransaction';
  if (transaction instanceof ContractDeleteTransaction) return 'ContractDeleteTransaction';

  // Topic types
  if (transaction instanceof TopicCreateTransaction) return 'TopicCreateTransaction';
  if (transaction instanceof TopicUpdateTransaction) return 'TopicUpdateTransaction';
  if (transaction instanceof TopicDeleteTransaction) return 'TopicDeleteTransaction';
  if (transaction instanceof TopicMessageSubmitTransaction) return 'TopicMessageSubmitTransaction';

  // File types
  if (transaction instanceof FileCreateTransaction) return 'FileCreateTransaction';
  if (transaction instanceof FileUpdateTransaction) return 'FileUpdateTransaction';
  if (transaction instanceof FileDeleteTransaction) return 'FileDeleteTransaction';
  if (transaction instanceof FileAppendTransaction) return 'FileAppendTransaction';

  // Schedule types
  if (transaction instanceof ScheduleCreateTransaction) return 'ScheduleCreateTransaction';
  if (transaction instanceof ScheduleSignTransaction) return 'ScheduleSignTransaction';
  if (transaction instanceof ScheduleDeleteTransaction) return 'ScheduleDeleteTransaction';

  // Allowance types
  if (transaction instanceof AccountAllowanceApproveTransaction) return 'AccountAllowanceApproveTransaction';
  if (transaction instanceof AccountAllowanceDeleteTransaction) return 'AccountAllowanceDeleteTransaction';

  // Token freeze/unfreeze types
  if (transaction instanceof TokenFreezeTransaction) return 'TokenFreezeTransaction';
  if (transaction instanceof TokenUnfreezeTransaction) return 'TokenUnfreezeTransaction';

  // Fallback - try constructor.name
  const constructorName = transaction.constructor.name;
  if (constructorName && constructorName.length > 1) {
    return constructorName;
  }

  return 'UnknownTransaction';
}

/**
 * Transaction Decoder Class
 */
class TransactionDecoder {
  /**
   * Decode frozen transaction from base64
   *
   * @param {string} frozenTransactionBase64 - Frozen transaction as base64 string
   * @param {ethers.Interface} [contractInterface] - Optional ABI for contract function decoding
   * @returns {Promise<DecodedTransaction>} Decoded transaction with checksum
   */
  static async decode(frozenTransactionBase64, contractInterface = null) {
    try {
      // Decode from base64
      const txBytes = Buffer.from(frozenTransactionBase64, 'base64');

      // Parse transaction
      const transaction = Transaction.fromBytes(txBytes);

      // Generate checksums
      const fullChecksum = await sha256(txBytes);
      const shortChecksum = await generateChecksum(txBytes);

      // Get transaction type name
      const typeName = getTransactionTypeName(transaction);

      // Extract transaction details
      const details = this.extractTransactionDetails(transaction, typeName, contractInterface);

      return {
        type: typeName,
        checksum: fullChecksum,
        shortChecksum: shortChecksum,
        bytes: txBytes,
        details: details,
      };
    } catch (error) {
      throw new Error(`Transaction decoding failed: ${error.message}`);
    }
  }

  /**
   * Extract transaction details from parsed transaction
   *
   * @param {Transaction} transaction - Parsed Hedera transaction
   * @param {string} typeName - Transaction type name
   * @param {ethers.Interface} [contractInterface] - Optional ABI for contract decoding
   * @returns {TransactionDetails} Transaction details object
   */
  static extractTransactionDetails(transaction, typeName, contractInterface = null) {
    // Extract valid start time from transaction ID
    const txId = transaction.transactionId;
    let validStartTimestamp;
    let transactionValidDuration = 120; // Default 120 seconds
    let expiresAt;

    if (txId) {
      const txIdStr = txId.toString();
      const match = txIdStr.match(/@(\d+)\./);
      if (match) {
        validStartTimestamp = parseInt(match[1], 10);
      }

      // Try to get the actual valid duration
      const duration = transaction.transactionValidDuration;
      if (duration) {
        transactionValidDuration = typeof duration === 'number'
          ? duration
          : (duration.seconds || duration._seconds || 120);
      }

      if (validStartTimestamp) {
        expiresAt = validStartTimestamp + transactionValidDuration;
      }
    }

    const details = {
      type: typeName,
      transactionId: transaction.transactionId?.toString(),
      nodeAccountIds: transaction.nodeAccountIds?.map((id) => id.toString()) || [],
      maxTransactionFee: transaction.maxTransactionFee?.toString() || '0',
      transactionMemo: transaction.transactionMemo || '',
      validStartTimestamp,
      transactionValidDuration,
      expiresAt,
    };

    // Decode based on transaction type using instanceof
    if (transaction instanceof TransferTransaction) {
      this._decodeTransferTransaction(transaction, details);
    } else if (transaction instanceof TokenAssociateTransaction) {
      this._decodeTokenAssociateTransaction(transaction, details);
    } else if (transaction instanceof TokenDissociateTransaction) {
      this._decodeTokenDissociateTransaction(transaction, details);
    } else if (transaction instanceof ContractExecuteTransaction) {
      this._decodeContractExecuteTransaction(transaction, details, contractInterface);
    } else if (transaction instanceof ContractCreateTransaction) {
      this._decodeContractCreateTransaction(transaction, details);
    } else if (transaction instanceof AccountCreateTransaction) {
      this._decodeAccountCreateTransaction(transaction, details);
    } else if (transaction instanceof AccountUpdateTransaction) {
      this._decodeAccountUpdateTransaction(transaction, details);
    } else if (transaction instanceof AccountDeleteTransaction) {
      this._decodeAccountDeleteTransaction(transaction, details);
    } else if (transaction instanceof TokenCreateTransaction) {
      this._decodeTokenCreateTransaction(transaction, details);
    } else if (transaction instanceof TokenMintTransaction) {
      this._decodeTokenMintTransaction(transaction, details);
    } else if (transaction instanceof TokenBurnTransaction) {
      this._decodeTokenBurnTransaction(transaction, details);
    } else if (transaction instanceof TokenUpdateTransaction) {
      this._decodeTokenUpdateTransaction(transaction, details);
    } else if (transaction instanceof TokenDeleteTransaction) {
      this._decodeTokenDeleteTransaction(transaction, details);
    } else if (transaction instanceof ContractDeleteTransaction) {
      this._decodeContractDeleteTransaction(transaction, details);
    } else if (transaction instanceof ScheduleCreateTransaction) {
      this._decodeScheduleCreateTransaction(transaction, details, contractInterface);
    } else if (transaction instanceof ScheduleSignTransaction) {
      this._decodeScheduleSignTransaction(transaction, details);
    } else if (transaction instanceof AccountAllowanceApproveTransaction) {
      this._decodeAccountAllowanceApproveTransaction(transaction, details);
    } else if (transaction instanceof AccountAllowanceDeleteTransaction) {
      this._decodeAccountAllowanceDeleteTransaction(transaction, details);
    } else if (transaction instanceof TokenFreezeTransaction) {
      this._decodeTokenFreezeTransaction(transaction, details);
    } else if (transaction instanceof TokenUnfreezeTransaction) {
      this._decodeTokenUnfreezeTransaction(transaction, details);
    }
    // Topic and File types are identified but not decoded in detail

    return details;
  }

  /**
   * Decode TransferTransaction
   * @private
   */
  static _decodeTransferTransaction(tx, details) {
    // Hbar transfers - _hbarTransfers is an array of Transfer objects
    // Phase F3: amount is now raw tinybars (string-typed for big-int safety),
    // not the SDK's "1000 tℏ" formatted toString(). Use formatHbarTinybars()
    // exported from this module for display.
    const hbarTransfers = tx._hbarTransfers;
    if (hbarTransfers && Array.isArray(hbarTransfers) && hbarTransfers.length > 0) {
      details.transfers = [];
      for (const transfer of hbarTransfers) {
        const tinybars = typeof transfer.amount?.toTinybars === 'function'
          ? transfer.amount.toTinybars().toString()
          : transfer.amount.toString();
        details.transfers.push({
          accountId: transfer.accountId.toString(),
          amount: tinybars,
        });
      }
    }

    // Token transfers
    const tokenTransfers = tx._tokenTransfers;
    if (tokenTransfers && Array.isArray(tokenTransfers) && tokenTransfers.length > 0) {
      details.tokenTransfers = [];
      const byToken = new Map();
      for (const transfer of tokenTransfers) {
        const tokenId = transfer.tokenId.toString();
        if (!byToken.has(tokenId)) {
          byToken.set(tokenId, []);
        }
        byToken.get(tokenId).push({
          accountId: transfer.accountId.toString(),
          amount: transfer.amount.toString(),
        });
      }
      for (const [tokenId, transfers] of byToken) {
        details.tokenTransfers.push({ tokenId, transfers });
      }
    }

    // NFT transfers
    const nftTransfers = tx._nftTransfers;
    if (nftTransfers && Array.isArray(nftTransfers) && nftTransfers.length > 0) {
      details.nftTransfers = [];
      const byToken = new Map();
      for (const transfer of nftTransfers) {
        const tokenId = transfer.tokenId.toString();
        if (!byToken.has(tokenId)) {
          byToken.set(tokenId, []);
        }
        byToken.get(tokenId).push({
          senderAccountId: transfer.sender.toString(),
          receiverAccountId: transfer.receiver.toString(),
          serialNumber: typeof transfer.serial?.toNumber === 'function'
            ? transfer.serial.toNumber()
            : Number(transfer.serial),
        });
      }
      for (const [tokenId, transfers] of byToken) {
        details.nftTransfers.push({ tokenId, transfers });
      }
    }
  }

  /**
   * Decode TokenAssociateTransaction
   * @private
   */
  static _decodeTokenAssociateTransaction(tx, details) {
    details.accountId = tx._accountId?.toString();
    details.tokenIds = tx._tokenIds?.map((id) => id.toString()) || [];
  }

  /**
   * Decode TokenDissociateTransaction
   * @private
   */
  static _decodeTokenDissociateTransaction(tx, details) {
    details.accountId = tx._accountId?.toString();
    details.tokenIds = tx._tokenIds?.map((id) => id.toString()) || [];
  }

  /**
   * Decode ContractExecuteTransaction
   * @private
   */
  static _decodeContractExecuteTransaction(tx, details, contractInterface) {
    details.contractId = tx._contractId?.toString();
    details.gas = tx._gas?.toNumber();
    details.amount = tx._payableAmount?.toString() || '0';

    // Decode function call if ABI provided. `abiVerified` is true only
    // when both the selector matches AND the re-encoded calldata is
    // byte-identical to the original (round-trip integrity). Anything
    // less than that is shown to the signer as "not verified".
    if (contractInterface && tx._functionParameters) {
      try {
        const decoded = this.decodeSolidityFunction(tx._functionParameters, contractInterface);
        details.functionName = decoded.name;
        details.functionParams = decoded.params;
        details.abiVerified = decoded.abiVerified;
        details.selectorVerified = decoded.selectorVerified; // legacy alias
      } catch (error) {
        console.error('Failed to decode contract function:', error.message);
        details.functionName = 'Unknown';
        details.abiVerified = false;
        details.selectorVerified = false;
        // Re-throw security-critical mismatches so the participant sees
        // them as a hard refusal rather than a silent "Unknown function".
        const msg = error.message || '';
        if (
          msg.includes('FUNCTION SELECTOR MISMATCH') ||
          msg.includes('ABI ROUND-TRIP MISMATCH') ||
          msg.includes('ABI ROUND-TRIP FAILED')
        ) {
          throw error;
        }
      }
    }
  }

  /**
   * Decode ContractCreateTransaction
   * @private
   */
  static _decodeContractCreateTransaction(tx, details) {
    details.gas = tx._gas?.toNumber();
    details.amount = tx._initialBalance?.toString() || '0';
    if (tx._bytecode) {
      details.bytecodeSize = tx._bytecode.length;
    }
  }

  /**
   * Decode AccountCreateTransaction
   * @private
   */
  static _decodeAccountCreateTransaction(tx, details) {
    details.amount = tx._initialBalance?.toString() || '0';
    if (tx._key) {
      details.hasKey = true;
    }
  }

  /**
   * Decode AccountUpdateTransaction
   * @private
   */
  static _decodeAccountUpdateTransaction(tx, details) {
    details.accountId = tx._accountId?.toString();
    if (tx._key) {
      details.hasKey = true;
    }
  }

  /**
   * Decode AccountDeleteTransaction
   * @private
   */
  static _decodeAccountDeleteTransaction(tx, details) {
    details.accountId = tx._accountId?.toString();
    details.transferAccountId = tx._transferAccountId?.toString();
  }

  /**
   * Decode TokenCreateTransaction
   * @private
   */
  static _decodeTokenCreateTransaction(tx, details) {
    details.tokenName = tx._tokenName || null;
    details.tokenSymbol = tx._tokenSymbol || null;
    details.decimals = tx._decimals != null ? tx._decimals : null;
    details.initialSupply = tx._initialSupply?.toString() || '0';
    details.treasuryAccountId = tx._treasuryAccountId?.toString();
    details.hasAdminKey = !!tx._adminKey;
    details.hasSupplyKey = !!tx._supplyKey;
    details.hasFreezeKey = !!tx._freezeKey;
    details.hasWipeKey = !!tx._wipeKey;
    details.hasPauseKey = !!tx._pauseKey;
    details.hasFeeScheduleKey = !!tx._feeScheduleKey;
  }

  /**
   * Decode TokenMintTransaction
   * @private
   */
  static _decodeTokenMintTransaction(tx, details) {
    details.tokenId = tx._tokenId?.toString();
    details.amount = tx._amount?.toString() || '0';
    // NFT metadata for non-fungible minting
    if (tx._metadata && tx._metadata.length > 0) {
      details.nftMetadataCount = tx._metadata.length;
    }
  }

  /**
   * Decode TokenBurnTransaction
   * @private
   */
  static _decodeTokenBurnTransaction(tx, details) {
    details.tokenId = tx._tokenId?.toString();
    details.amount = tx._amount?.toString() || '0';
    if (tx._serials && tx._serials.length > 0) {
      details.serialNumbers = tx._serials.map(s =>
        typeof s?.toNumber === 'function' ? s.toNumber() : Number(s)
      );
    }
  }

  /**
   * Decode TokenUpdateTransaction
   * @private
   */
  static _decodeTokenUpdateTransaction(tx, details) {
    details.tokenId = tx._tokenId?.toString();
    details.tokenName = tx._tokenName || null;
    details.tokenSymbol = tx._tokenSymbol || null;
    details.treasuryAccountId = tx._treasuryAccountId?.toString() || null;
    details.hasAdminKey = !!tx._adminKey;
  }

  /**
   * Decode TokenDeleteTransaction
   * @private
   */
  static _decodeTokenDeleteTransaction(tx, details) {
    details.tokenId = tx._tokenId?.toString();
  }

  /**
   * Decode ContractDeleteTransaction
   * @private
   */
  static _decodeContractDeleteTransaction(tx, details) {
    details.contractId = tx._contractId?.toString();
    details.transferAccountId = tx._transferAccountId?.toString() || null;
    details.transferContractId = tx._transferContractId?.toString() || null;
  }

  /**
   * Decode ScheduleCreateTransaction
   * @private
   */
  static _decodeScheduleCreateTransaction(tx, details, contractInterface) {
    details.payerAccountId = tx._payerAccountId?.toString() || null;
    details.scheduleMemo = tx._scheduleMemo || null;
    details.hasAdminKey = !!tx._adminKey;
    details.expirationTime = tx._expirationTime?.seconds?.toNumber?.() || null;

    // Recursively decode the inner (scheduled) transaction
    if (tx._scheduledTransaction) {
      const innerType = getTransactionTypeName(tx._scheduledTransaction);
      details.scheduledTransactionType = innerType;
      details.scheduledTransaction = {};
      this.extractTransactionDetails(tx._scheduledTransaction, details.scheduledTransaction, contractInterface);
      details.scheduledTransaction.type = innerType;
    }
  }

  /**
   * Decode ScheduleSignTransaction
   * @private
   */
  static _decodeScheduleSignTransaction(tx, details) {
    details.scheduleId = tx._scheduleId?.toString();
  }

  /**
   * Decode AccountAllowanceApproveTransaction
   * @private
   */
  static _decodeAccountAllowanceApproveTransaction(tx, details) {
    details.hbarApprovals = [];
    details.tokenApprovals = [];
    details.nftApprovals = [];

    // Hbar allowances
    if (tx._hbarApprovals && tx._hbarApprovals.length > 0) {
      for (const approval of tx._hbarApprovals) {
        details.hbarApprovals.push({
          ownerAccountId: approval.ownerAccountId?.toString() || null,
          spenderAccountId: approval.spenderAccountId?.toString() || null,
          amount: approval.amount?.toString() || '0',
        });
      }
    }

    // Token allowances
    if (tx._tokenApprovals && tx._tokenApprovals.length > 0) {
      for (const approval of tx._tokenApprovals) {
        details.tokenApprovals.push({
          tokenId: approval.tokenId?.toString() || null,
          ownerAccountId: approval.ownerAccountId?.toString() || null,
          spenderAccountId: approval.spenderAccountId?.toString() || null,
          amount: approval.amount?.toString() || '0',
        });
      }
    }

    // NFT allowances
    if (tx._nftApprovals && tx._nftApprovals.length > 0) {
      for (const approval of tx._nftApprovals) {
        details.nftApprovals.push({
          tokenId: approval.tokenId?.toString() || null,
          ownerAccountId: approval.ownerAccountId?.toString() || null,
          spenderAccountId: approval.spenderAccountId?.toString() || null,
          serialNumbers: approval.serialNumbers?.map(s =>
            typeof s?.toNumber === 'function' ? s.toNumber() : Number(s)
          ) || [],
          allSerials: approval.allSerials || false,
        });
      }
    }
  }

  /**
   * Decode AccountAllowanceDeleteTransaction
   * @private
   */
  static _decodeAccountAllowanceDeleteTransaction(tx, details) {
    details.nftAllowanceDeletions = [];

    // NFT allowance deletions
    if (tx._nftAllowanceDeletions && tx._nftAllowanceDeletions.length > 0) {
      for (const deletion of tx._nftAllowanceDeletions) {
        details.nftAllowanceDeletions.push({
          tokenId: deletion.tokenId?.toString() || null,
          ownerAccountId: deletion.ownerAccountId?.toString() || null,
          serialNumbers: deletion.serialNumbers?.map(s =>
            typeof s?.toNumber === 'function' ? s.toNumber() : Number(s)
          ) || [],
          allSerials: deletion.allSerials || false,
        });
      }
    }
  }

  /**
   * Decode TokenFreezeTransaction
   * @private
   */
  static _decodeTokenFreezeTransaction(tx, details) {
    details.tokenId = tx._tokenId?.toString() || null;
    details.accountId = tx._accountId?.toString() || null;
  }

  /**
   * Decode TokenUnfreezeTransaction
   * @private
   */
  static _decodeTokenUnfreezeTransaction(tx, details) {
    details.tokenId = tx._tokenId?.toString() || null;
    details.accountId = tx._accountId?.toString() || null;
  }

  /**
   * Decode a Solidity function call using ABI with **full round-trip
   * verification**.
   *
   * Two things we check, and the difference matters for the
   * "ABI verified" claim shown to signers:
   *
   *   1. **Selector match** — `iface.parseTransaction({data})` succeeds,
   *      meaning the first 4 bytes of calldata correspond to *some*
   *      fragment in the supplied ABI. (This alone is not enough — see
   *      below.)
   *
   *   2. **Encoded round-trip equality** — we re-encode the decoded
   *      `(name, args)` via `iface.encodeFunctionData(name, args)` and
   *      assert byte-for-byte equality with the original calldata. This
   *      is the actual verification: it proves
   *
   *        - every byte after the selector is accounted for (no trailing
   *          junk that ethers might silently ignore for fixed-size types),
   *        - the argument *types* declared in the ABI match the actual
   *          on-the-wire encoding (e.g. an ABI claiming `uint128` for
   *          what's really `uint256` would diverge here),
   *        - the decoded args, when handed to a reviewer, are an exact
   *          and exhaustive description of the call.
   *
   * Without (2), a malicious or wrong ABI could decode partial /
   * misinterpreted calldata into plausible-looking args while the actual
   * tx semantics differ. With (2), the participant either sees verified
   * args or sees `abiVerified: false` and a clear error.
   *
   * @param {Uint8Array|Buffer} functionData
   * @param {ethers.Interface} contractInterface
   * @returns {{name: string, params: Object, selectorVerified: boolean, abiVerified: boolean}}
   * @throws {Error} If selector doesn't match the ABI, or if the
   *   re-encoded calldata diverges from the original (security-critical).
   */
  static decodeSolidityFunction(functionData, contractInterface) {
    const dataHex = ('0x' + bufferToHex(functionData)).toLowerCase();
    const actualSelector = dataHex.slice(0, 10);

    const decoded = contractInterface.parseTransaction({ data: dataHex });
    if (!decoded) {
      throw new Error('Could not decode function call');
    }

    // (1) Defense-in-depth selector check. Under normal ethers behavior
    //     parseTransaction has already matched on this; this assert
    //     would only fail if the Interface implementation drifts.
    const expectedSelector = decoded.selector.toLowerCase();
    if (actualSelector !== expectedSelector) {
      throw new Error(
        `FUNCTION SELECTOR MISMATCH!\n` +
        `ABI claims function: ${decoded.name}(${decoded.fragment.inputs.map(i => i.type).join(',')})\n` +
        `Expected selector: ${expectedSelector}\n` +
        `Actual selector: ${actualSelector}\n\n` +
        `The ABI does not match the actual contract function being called.\n` +
        `DO NOT SIGN THIS TRANSACTION — The function name may be fraudulent.`
      );
    }

    // (2) Round-trip equality. This is the substantive check: re-encode
    //     using the same Interface and compare byte-for-byte.
    let reencoded;
    try {
      reencoded = contractInterface.encodeFunctionData(decoded.name, decoded.args).toLowerCase();
    } catch (err) {
      throw new Error(
        `ABI ROUND-TRIP FAILED while re-encoding ${decoded.name}: ${err.message}\n` +
        `The supplied ABI cannot reproduce the calldata it just decoded — treat as untrusted.\n` +
        `DO NOT SIGN THIS TRANSACTION.`
      );
    }
    if (reencoded !== dataHex) {
      const sigStr = `${decoded.name}(${decoded.fragment.inputs.map(i => i.type).join(',')})`;
      throw new Error(
        `ABI ROUND-TRIP MISMATCH!\n` +
        `ABI fragment: ${sigStr}\n` +
        `Original calldata:  ${dataHex}\n` +
        `Re-encoded calldata: ${reencoded}\n\n` +
        `The supplied ABI matches the function selector but produces different calldata\n` +
        `when re-encoding the decoded args. This usually means the ABI claims wrong\n` +
        `argument types, or the calldata has trailing bytes the ABI doesn't account for.\n` +
        `DO NOT SIGN THIS TRANSACTION — argument values shown to you may be misleading.`
      );
    }

    // Extract parameter values for display.
    const params = {};
    decoded.fragment.inputs.forEach((input, index) => {
      let value = decoded.args[index];
      if (typeof value === 'bigint') {
        value = value.toString();
      }
      params[input.name || `param${index}`] = value;
    });

    return {
      name: decoded.name,
      params,
      // `abiVerified` is the canonical field — true only when both the
      // selector and the round-trip pass. `selectorVerified` is kept for
      // back-compat with consumers that read the older field name; it
      // now means the same thing (round-trip is a strict superset of
      // selector verification).
      abiVerified: true,
      selectorVerified: true,
    };
  }

  /**
   * Extract all amounts from transaction details
   *
   * @param {TransactionDetails} txDetails - Transaction details
   * @returns {Array<{accountId: string, amount: string, tokenId?: string, type: string}>}
   */
  static extractAmounts(txDetails) {
    const amounts = [];

    // Hbar transfers
    if (txDetails.transfers) {
      txDetails.transfers.forEach((transfer) => {
        amounts.push({
          accountId: transfer.accountId,
          amount: transfer.amount,
          type: 'hbar',
        });
      });
    }

    // Token transfers
    if (txDetails.tokenTransfers) {
      txDetails.tokenTransfers.forEach((tokenTransfer) => {
        tokenTransfer.transfers.forEach((transfer) => {
          amounts.push({
            accountId: transfer.accountId,
            amount: transfer.amount,
            tokenId: tokenTransfer.tokenId,
            type: 'token',
          });
        });
      });
    }

    // NFT transfers
    if (txDetails.nftTransfers) {
      txDetails.nftTransfers.forEach((nftTransfer) => {
        nftTransfer.transfers.forEach((transfer) => {
          amounts.push({
            accountId: transfer.senderAccountId,
            amount: `-1 NFT (serial: ${transfer.serialNumber})`,
            tokenId: nftTransfer.tokenId,
            type: 'nft',
          });
          amounts.push({
            accountId: transfer.receiverAccountId,
            amount: `+1 NFT (serial: ${transfer.serialNumber})`,
            tokenId: nftTransfer.tokenId,
            type: 'nft',
          });
        });
      });
    }

    // Contract payable amount
    if (txDetails.amount && txDetails.amount !== '0') {
      amounts.push({
        accountId: txDetails.contractId || 'contract',
        amount: txDetails.amount,
        type: 'hbar',
      });
    }

    return amounts;
  }

  /**
   * Extract all account IDs from transaction details
   *
   * @param {TransactionDetails} txDetails - Transaction details
   * @returns {string[]} Unique account IDs
   */
  static extractAccounts(txDetails) {
    const accounts = new Set();

    // From transfers
    if (txDetails.transfers) {
      txDetails.transfers.forEach((t) => accounts.add(t.accountId));
    }

    // From token transfers
    if (txDetails.tokenTransfers) {
      txDetails.tokenTransfers.forEach((tt) => {
        tt.transfers.forEach((t) => accounts.add(t.accountId));
      });
    }

    // From NFT transfers
    if (txDetails.nftTransfers) {
      txDetails.nftTransfers.forEach((nft) => {
        nft.transfers.forEach((t) => {
          accounts.add(t.senderAccountId);
          accounts.add(t.receiverAccountId);
        });
      });
    }

    // From token associate/dissociate
    if (txDetails.accountId) {
      accounts.add(txDetails.accountId);
    }

    // From contract
    if (txDetails.contractId) {
      accounts.add(txDetails.contractId);
    }

    return Array.from(accounts);
  }

  /**
   * Validate coordinator-provided metadata against actual transaction
   *
   * @param {TransactionDetails} txDetails - Verified transaction details
   * @param {Object} metadata - Coordinator-provided metadata
   * @returns {{valid: boolean, warnings: string[], mismatches: Object}}
   */
  static validateMetadata(txDetails, metadata) {
    const warnings = [];
    const mismatches = {};

    if (!metadata || Object.keys(metadata).length === 0) {
      return { valid: true, warnings: [], mismatches: {} };
    }

    // Check for urgency language (social engineering indicator)
    const urgencyPatterns = [
      /urgent/i, /immediately/i, /asap/i, /hurry/i,
      /quickly/i, /now/i, /emergency/i
    ];

    const metadataText = JSON.stringify(metadata).toLowerCase();
    urgencyPatterns.forEach((pattern) => {
      if (pattern.test(metadataText)) {
        warnings.push(`URGENCY LANGUAGE DETECTED: "${pattern.source}" - Be cautious of social engineering`);
      }
    });

    // Validate amounts if provided
    if (metadata.amount) {
      const actualAmounts = this.extractAmounts(txDetails);
      let claimedValue = null;

      if (typeof metadata.amount === 'object' && metadata.amount.value) {
        claimedValue = metadata.amount.value.toString().replace(/[^\d.-]/g, '');
      } else if (typeof metadata.amount === 'string') {
        claimedValue = metadata.amount.replace(/[^\d.-]/g, '');
      }

      if (claimedValue && actualAmounts.length > 0) {
        const claimedNum = Math.abs(parseFloat(claimedValue));
        const foundMatch = actualAmounts.some((a) => {
          const actualNum = Math.abs(parseFloat(a.amount.replace(/[^\d.-]/g, '')));
          return Math.abs(actualNum - claimedNum) < 0.0001;
        });

        if (!foundMatch) {
          mismatches.amounts = {
            metadata: metadata.amount,
            actual: actualAmounts.map((a) => a.amount),
          };
          warnings.push(`AMOUNT MISMATCH: Metadata claims "${claimedValue}", but no matching amount found`);
        }
      }
    }

    // Validate transaction type if provided
    const typeAliases = {
      TransferTransaction: ['HBAR Transfer', 'Transfer', 'Crypto Transfer', 'Token Transfer'],
      TokenAssociateTransaction: ['Token Associate', 'Token Association'],
      TokenDissociateTransaction: ['Token Dissociate', 'Token Dissociation'],
      ContractExecuteTransaction: ['Contract Call', 'Contract Execute', 'Smart Contract Call'],
      ContractCreateTransaction: ['Contract Deploy', 'Contract Create', 'Smart Contract Deploy'],
      AccountCreateTransaction: ['Account Create', 'Create Account'],
      AccountUpdateTransaction: ['Account Update', 'Update Account'],
    };

    if (metadata.type && metadata.type !== txDetails.type) {
      const aliases = typeAliases[txDetails.type] || [];
      const isValidAlias = aliases.some(
        (alias) => alias.toLowerCase() === metadata.type.toLowerCase()
      );

      if (!isValidAlias) {
        mismatches.type = {
          metadata: metadata.type,
          actual: txDetails.type,
        };
        warnings.push(`TYPE MISMATCH: Metadata claims "${metadata.type}", but transaction is "${txDetails.type}"`);
      }
    }

    // Validate function name if provided
    if (metadata.functionName && txDetails.functionName) {
      if (metadata.functionName !== txDetails.functionName) {
        mismatches.functionName = {
          metadata: metadata.functionName,
          actual: txDetails.functionName,
        };
        warnings.push(`FUNCTION MISMATCH: Metadata claims "${metadata.functionName}", but transaction calls "${txDetails.functionName}"`);
      }
    }

    // General warning about metadata trust
    if (Object.keys(metadata).length > 0) {
      warnings.push('METADATA IS UNVERIFIED: Always verify transaction details in the VERIFIED section');
    }

    return {
      valid: Object.keys(mismatches).length === 0,
      warnings: warnings,
      mismatches: mismatches,
    };
  }

  /**
   * Format amount for display
   *
   * @param {string} amount - Amount in tinybars or smallest unit
   * @param {string} [type='hbar'] - Amount type
   * @returns {string} Formatted amount
   */
  static formatAmount(amount, type = 'hbar') {
    if (type === 'nft') {
      return amount;
    }

    try {
      const amountBigInt = BigInt(amount);

      if (type === 'hbar') {
        const hbar = Number(amountBigInt) / 100_000_000;
        return `${hbar >= 0 ? '+' : ''}${hbar.toFixed(8)} HBAR`;
      } else {
        return `${amountBigInt >= 0 ? '+' : ''}${amountBigInt.toString()} tokens`;
      }
    } catch (error) {
      return amount;
    }
  }
}

/**
 * Format raw tinybars as a human-readable HBAR string.
 *
 * Phase F3: canonical formatter shared between Node and dApp callers.
 * The decoder always emits raw tinybars (string-typed, big-int safe);
 * UI layers call this when they need user-facing copy.
 *
 * @param {string|number|bigint} tinybars - Raw tinybars (string-typed for safety)
 * @param {Object} [options]
 * @param {boolean} [options.showSign=true] - Prefix non-negative values with "+"
 * @param {boolean} [options.showUnit=true] - Append " ℏ"
 * @param {number} [options.precision=8] - Fractional digits (1 ℏ = 10^8 tinybars)
 * @returns {string} e.g. "+10.00000000 ℏ", "-1.50000000 ℏ", or raw integer if parse fails
 */
function formatHbarTinybars(tinybars, options = {}) {
  const showSign = options.showSign !== false;
  const showUnit = options.showUnit !== false;
  const precision = options.precision ?? 8;

  try {
    const tinybarsBig = BigInt(tinybars);
    const negative = tinybarsBig < 0n;
    const abs = negative ? -tinybarsBig : tinybarsBig;
    const integerPart = abs / 100_000_000n;
    const fractionPart = abs % 100_000_000n;
    const fractionStr = fractionPart.toString().padStart(8, '0').slice(0, precision);
    const signStr = negative ? '-' : (showSign ? '+' : '');
    const unit = showUnit ? ' ℏ' : '';
    if (precision === 0) return `${signStr}${integerPart.toString()}${unit}`;
    return `${signStr}${integerPart.toString()}.${fractionStr}${unit}`;
  } catch {
    return String(tinybars);
  }
}

/**
 * Extract the `bodyBytes` of the first SignedTransaction inside a frozen
 * Hedera transaction. This is the canonical message that each multi-sig
 * participant signs and that Hedera's network verifies against.
 *
 * Background: `transaction.toBytes()` returns a `TransactionList` protobuf
 * — the OUTER wrapper around N `Transaction` entries (one per node target).
 * Each entry contains `signedTransactionBytes`, which decodes to a
 * `SignedTransaction` carrying `bodyBytes` (the actual body for that
 * specific node) plus a `sigMap`. Hedera's signature verification runs
 * against `bodyBytes`, NOT the outer TransactionList.
 *
 * For multi-sig submission to work, every signer in this codebase must
 * sign `bodyBytes` (not the full TransactionList encoding) and the
 * internal verifier must check against the same `bodyBytes`. This helper
 * is the single source of truth for that extraction.
 *
 * Implementation note: we use the SDK's public `signableNodeBodyBytesList`
 * getter on a parsed Transaction, which exposes `bodyBytes` for exactly
 * this purpose. We deliberately do NOT pull in `@hashgraph/proto` —
 * that's a peer dep of the SDK that isn't installed at the root project
 * level (only in `dapp/`), and using it broke the CLI participant with
 * `Cannot find module '@hashgraph/proto'`.
 *
 * @param {Buffer|Uint8Array|string} txBytesOrBase64 - Frozen tx bytes or base64
 * @returns {Buffer} bodyBytes of the first SignedTransaction
 */
function extractFirstBodyBytes(txBytesOrBase64) {
  let bytes;
  if (typeof txBytesOrBase64 === 'string') {
    bytes = Buffer.from(txBytesOrBase64, 'base64');
  } else if (Buffer.isBuffer(txBytesOrBase64)) {
    bytes = txBytesOrBase64;
  } else if (txBytesOrBase64) {
    bytes = Buffer.from(txBytesOrBase64);
  } else {
    throw new Error('extractFirstBodyBytes: input is empty');
  }

  const tx = Transaction.fromBytes(bytes);

  // Public SDK getter: each entry has `.bodyBytes` for the
  // corresponding node target. For canonical multi-sig signing, we use
  // the first entry — Hedera will pick whichever node receives the
  // submission and verify its signature against THAT node's bodyBytes,
  // so we sign one specific body. (For multi-node freezes, all bodies
  // differ only in `nodeAccountID`; signing a single-node freeze is the
  // canonical multi-sig pattern per the Hedera docs.)
  let list;
  try {
    list = tx.signableNodeBodyBytesList;
  } catch (err) {
    throw new Error(`Failed to read signableNodeBodyBytesList: ${err.message}`);
  }

  if (!list || list.length === 0) {
    throw new Error('Frozen transaction has no signable node bodies');
  }

  // SDK class is `SignableNodeTransactionBodyBytes` with property
  // `signableTransactionBodyBytes` (the bodyBytes for that node target).
  const first = list[0];
  const body = first && (first.signableTransactionBodyBytes || first.bodyBytes);
  if (!body || body.length === 0) {
    throw new Error('First signable node body is empty');
  }

  return Buffer.from(body);
}

/**
 * Extract `bodyBytes` of EVERY SignedTransaction inside a frozen Hedera
 * transaction — one per node target. With multi-node freezes (the
 * canonical Hedera multi-sig pattern, recommended over single-node
 * because it gives the network multiple submission paths and is robust
 * to individual node downtime), each participant produces ONE signature
 * per body and the executor passes the full array to
 * `transaction.addSignature(publicKey, signatureArray)`.
 *
 * Single-node freezes return a 1-element array — the verifier and
 * signing paths can use the same code unchanged.
 *
 * @param {Buffer|Uint8Array|string} txBytesOrBase64
 * @returns {Buffer[]} bodyBytes per SignedTransaction in the list order
 */
function extractAllBodyBytes(txBytesOrBase64) {
  let bytes;
  if (typeof txBytesOrBase64 === 'string') {
    bytes = Buffer.from(txBytesOrBase64, 'base64');
  } else if (Buffer.isBuffer(txBytesOrBase64)) {
    bytes = txBytesOrBase64;
  } else if (txBytesOrBase64) {
    bytes = Buffer.from(txBytesOrBase64);
  } else {
    throw new Error('extractAllBodyBytes: input is empty');
  }

  const tx = Transaction.fromBytes(bytes);
  let list;
  try {
    list = tx.signableNodeBodyBytesList;
  } catch (err) {
    throw new Error(`Failed to read signableNodeBodyBytesList: ${err.message}`);
  }

  if (!list || list.length === 0) {
    throw new Error('Frozen transaction has no signable node bodies');
  }

  return list.map((item, idx) => {
    const body = item && (item.signableTransactionBodyBytes || item.bodyBytes);
    if (!body || body.length === 0) {
      throw new Error(`Signable body at index ${idx} is empty`);
    }
    return Buffer.from(body);
  });
}

// Export both the class and helper functions
module.exports = {
  TransactionDecoder,
  getTransactionTypeName,
  formatHbarTinybars,
  sha256,
  generateChecksum,
  bufferToHex,
  extractFirstBodyBytes,
  extractAllBodyBytes
};
