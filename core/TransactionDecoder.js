const { AccountId, ContractId } = require('@hashgraph/sdk');

/**
 * TransactionDecoder - Decode and display Hedera transactions for user verification
 *
 * Provides detailed, human-readable information about transactions before signing.
 * Critical for user trust - users should never blindly sign transactions.
 */
class TransactionDecoder {
  /**
   * Decode a Hedera transaction into human-readable details
   *
   * @param {Transaction} transaction - Hedera SDK transaction
   * @param {Interface} contractInterface - ethers.js Interface for ABI decoding (optional)
   * @returns {TransactionDetails} Decoded transaction details
   *
   * @typedef {Object} TransactionDetails
   * @property {string} type - Transaction type (e.g., 'ContractExecuteTransaction')
   * @property {string} contract - Contract ID (if contract transaction)
   * @property {string} function - Function name (if decodable)
   * @property {Object} parameters - Decoded function parameters (if available)
   * @property {Object} gas - Gas limit and estimated cost
   * @property {Object} transfers - HBAR and token transfers
   * @property {Object} raw - Raw transaction data and breakdown
   */
  static decode(transaction, contractInterface = null) {
    const type = transaction.constructor.name;
    const details = {
      type,
      contract: null,
      function: null,
      parameters: {},
      gas: {
        limit: null,
        estimatedCost: null
      },
      transfers: {
        hbar: null,
        tokens: []
      },
      raw: {
        functionSelector: null,
        encodedParams: null,
        bytesBreakdown: []
      }
    };

    // Decode based on transaction type
    if (type === 'ContractExecuteTransaction') {
      this._decodeContractExecute(transaction, contractInterface, details);
    } else if (type === 'ContractCreateTransaction') {
      this._decodeContractCreate(transaction, details);
    } else if (type === 'TransferTransaction') {
      this._decodeTransfer(transaction, details);
    } else if (type === 'TokenAssociateTransaction') {
      this._decodeTokenAssociate(transaction, details);
    } else if (type === 'AccountCreateTransaction') {
      this._decodeAccountCreate(transaction, details);
    } else {
      // Generic transaction details
      details.raw.info = 'Transaction type not fully supported for detailed decoding';
    }

    return details;
  }

  /**
   * Decode ContractExecuteTransaction
   * @private
   */
  static _decodeContractExecute(transaction, contractInterface, details) {
    // Extract contract ID
    if (transaction._contractId) {
      details.contract = transaction._contractId.toString();
    }

    // Extract gas limit
    if (transaction._gas) {
      details.gas.limit = transaction._gas.toNumber();
      // Estimate cost (rough estimate: gas * 0.0000001 HBAR)
      const estimatedHbar = (details.gas.limit * 0.0000001).toFixed(4);
      details.gas.estimatedCost = `~${estimatedHbar} HBAR (~$${(estimatedHbar * 0.10).toFixed(2)} USD)`;
    }

    // Extract payable amount (HBAR transfer)
    if (transaction._payableAmount && transaction._payableAmount.toTinybars() > 0) {
      const hbar = transaction._payableAmount.toBigNumber().toString();
      const hbarFormatted = (parseInt(hbar) / 100000000).toFixed(2);
      details.transfers.hbar = `${hbarFormatted} HBAR to ${details.contract}`;
    }

    // Extract and decode function parameters
    if (transaction._functionParameters) {
      const funcParams = transaction._functionParameters;

      // Get function selector (first 4 bytes)
      if (funcParams.length >= 4) {
        details.raw.functionSelector = '0x' + Buffer.from(funcParams.slice(0, 4)).toString('hex');
      }

      // Get encoded parameters (remaining bytes)
      if (funcParams.length > 4) {
        details.raw.encodedParams = '0x' + Buffer.from(funcParams.slice(4)).toString('hex');
      }

      // If we have a contract interface, decode the function call
      if (contractInterface && details.raw.functionSelector) {
        try {
          const fullCalldata = '0x' + Buffer.from(funcParams).toString('hex');
          const decoded = contractInterface.parseTransaction({ data: fullCalldata });

          if (decoded) {
            details.function = decoded.name;

            // Extract parameter names and values
            decoded.args.forEach((value, index) => {
              const param = decoded.fragment.inputs[index];
              let formattedValue = this._formatParameterValue(value, param.type);
              details.parameters[param.name || `param${index}`] = formattedValue;
            });
          }
        } catch (error) {
          details.function = 'Unable to decode function';
          details.parameters.error = error.message;
        }
      } else {
        details.function = 'Function selector: ' + (details.raw.functionSelector || 'unknown');
      }

      // Create bytes breakdown
      this._createBytesBreakdown(funcParams, details);
    }
  }

  /**
   * Decode ContractCreateTransaction
   * @private
   */
  static _decodeContractCreate(transaction, details) {
    details.function = 'Contract Deployment';

    if (transaction._gas) {
      details.gas.limit = transaction._gas.toNumber();
      const estimatedHbar = (details.gas.limit * 0.0000001).toFixed(4);
      details.gas.estimatedCost = `~${estimatedHbar} HBAR (~$${(estimatedHbar * 0.10).toFixed(2)} USD)`;
    }

    if (transaction._initialBalance && transaction._initialBalance.toTinybars() > 0) {
      const hbar = transaction._initialBalance.toBigNumber().toString();
      const hbarFormatted = (parseInt(hbar) / 100000000).toFixed(2);
      details.transfers.hbar = `${hbarFormatted} HBAR (initial balance)`;
    }

    if (transaction._bytecode) {
      details.parameters.bytecodeSize = `${transaction._bytecode.length} bytes`;
    }
  }

  /**
   * Decode TransferTransaction
   * @private
   */
  static _decodeTransfer(transaction, details) {
    details.function = 'Transfer';

    // Extract HBAR transfers
    if (transaction._hbarTransfers && transaction._hbarTransfers.size > 0) {
      const transfers = [];
      transaction._hbarTransfers.forEach((amount, accountId) => {
        const hbar = amount.toBigNumber().toString();
        const hbarFormatted = (parseInt(hbar) / 100000000).toFixed(2);
        transfers.push(`${hbarFormatted} HBAR ${parseInt(hbar) > 0 ? 'to' : 'from'} ${accountId.toString()}`);
      });
      details.transfers.hbar = transfers.join(', ');
    }

    // Extract token transfers
    if (transaction._tokenTransfers && transaction._tokenTransfers.size > 0) {
      transaction._tokenTransfers.forEach((transfers, tokenId) => {
        transfers.forEach((amount, accountId) => {
          details.transfers.tokens.push({
            token: tokenId.toString(),
            amount: amount.toString(),
            recipient: accountId.toString()
          });
        });
      });
    }
  }

  /**
   * Decode TokenAssociateTransaction
   * @private
   */
  static _decodeTokenAssociate(transaction, details) {
    details.function = 'Associate Tokens';

    if (transaction._accountId) {
      details.parameters.account = transaction._accountId.toString();
    }

    if (transaction._tokenIds && transaction._tokenIds.length > 0) {
      details.parameters.tokens = transaction._tokenIds.map(t => t.toString()).join(', ');
    }
  }

  /**
   * Decode AccountCreateTransaction
   * @private
   */
  static _decodeAccountCreate(transaction, details) {
    details.function = 'Create Account';

    if (transaction._initialBalance && transaction._initialBalance.toTinybars() > 0) {
      const hbar = transaction._initialBalance.toBigNumber().toString();
      const hbarFormatted = (parseInt(hbar) / 100000000).toFixed(2);
      details.transfers.hbar = `${hbarFormatted} HBAR (initial balance)`;
    }

    if (transaction._key) {
      details.parameters.publicKey = 'Key configured';
    }
  }

  /**
   * Format parameter value for display
   * @private
   */
  static _formatParameterValue(value, type) {
    // Handle BigNumber/BigInt
    if (value._isBigNumber || typeof value === 'bigint') {
      const numValue = value.toString();

      // For large numbers, add helpful context
      if (type.includes('uint') && numValue.length > 6) {
        // Could be basis points, scaled integers, etc.
        if (numValue.length === 7) {
          // Possibly thousandths of basis points (e.g., 5000000 = 5%)
          const percent = (parseInt(numValue) / 100000).toFixed(2);
          return `${numValue} (${percent}% if basis point scale)`;
        }
        return numValue;
      }

      return numValue;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (value.length > 5) {
        return `[${value.slice(0, 5).map(v => this._formatParameterValue(v, 'any')).join(', ')}, ...] (${value.length} items)`;
      }
      return `[${value.map(v => this._formatParameterValue(v, 'any')).join(', ')}]`;
    }

    // Handle addresses
    if (type === 'address') {
      return value;
    }

    // Handle strings
    if (typeof value === 'string') {
      if (value.length > 50) {
        return `"${value.substring(0, 47)}..." (${value.length} chars)`;
      }
      return `"${value}"`;
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    // Default
    return value.toString();
  }

  /**
   * Create bytes breakdown for raw data display
   * @private
   */
  static _createBytesBreakdown(funcParams, details) {
    const breakdown = [];

    // Function selector (first 4 bytes)
    if (funcParams.length >= 4) {
      breakdown.push({
        offset: 0,
        length: 4,
        field: 'functionSelector',
        value: details.raw.functionSelector
      });
    }

    // Parameters (remaining bytes, in 32-byte chunks for ABI encoding)
    if (funcParams.length > 4) {
      let offset = 4;
      let paramIndex = 0;

      while (offset < funcParams.length) {
        const chunkLength = Math.min(32, funcParams.length - offset);
        const chunk = funcParams.slice(offset, offset + chunkLength);
        const hexValue = '0x' + Buffer.from(chunk).toString('hex');

        breakdown.push({
          offset,
          length: chunkLength,
          field: `param${paramIndex}`,
          value: hexValue
        });

        offset += chunkLength;
        paramIndex++;
      }
    }

    details.raw.bytesBreakdown = breakdown;
  }

  /**
   * Display transaction details in terminal with formatting
   *
   * @param {TransactionDetails} txDetails - Decoded transaction details
   * @param {Object} options - Display options
   * @param {boolean} options.verbose - Show raw bytes breakdown (default: false)
   * @param {boolean} options.compact - Compact display mode (default: false)
   */
  static display(txDetails, options = { verbose: false, compact: false }) {
    if (options.compact) {
      this._displayCompact(txDetails);
      return;
    }

    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║          TRANSACTION DETAILS FOR SIGNING              ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log(`📄 Type: ${txDetails.type}`);

    if (txDetails.contract) {
      console.log(`📋 Contract: ${txDetails.contract}`);
    }

    if (txDetails.function) {
      console.log(`⚙️  Function: ${txDetails.function}${txDetails.function.includes('(') ? '' : '()'}\n`);
    }

    // Display parameters
    if (Object.keys(txDetails.parameters).length > 0) {
      console.log('📝 PARAMETERS:');
      for (const [key, value] of Object.entries(txDetails.parameters)) {
        console.log(`   ${key}: ${value}`);
      }
      console.log('');
    }

    // Display transfers
    console.log('💰 TRANSFERS:');
    if (txDetails.transfers.hbar) {
      console.log(`   HBAR: ${txDetails.transfers.hbar}`);
    } else {
      console.log('   HBAR: None');
    }

    if (txDetails.transfers.tokens.length > 0) {
      txDetails.transfers.tokens.forEach(t => {
        console.log(`   Token ${t.token}: ${t.amount} to ${t.recipient}`);
      });
    } else if (!txDetails.transfers.hbar) {
      console.log('   Tokens: None');
    }
    console.log('');

    // Display gas
    if (txDetails.gas.limit) {
      console.log('⛽ GAS:');
      console.log(`   Limit: ${txDetails.gas.limit.toLocaleString()}`);
      if (txDetails.gas.estimatedCost) {
        console.log(`   Estimated Cost: ${txDetails.gas.estimatedCost}`);
      }
      console.log('');
    }

    // Display raw data if verbose
    if (options.verbose) {
      console.log('🔍 RAW TRANSACTION DATA:');
      if (txDetails.raw.functionSelector) {
        console.log(`   Function Selector: ${txDetails.raw.functionSelector}`);
      }
      if (txDetails.raw.encodedParams) {
        const truncated = txDetails.raw.encodedParams.length > 66
          ? txDetails.raw.encodedParams.substring(0, 66) + '...'
          : txDetails.raw.encodedParams;
        console.log(`   Encoded Parameters: ${truncated}`);
      }

      if (txDetails.raw.bytesBreakdown.length > 0) {
        console.log('\n   Bytes Breakdown:');
        txDetails.raw.bytesBreakdown.forEach(segment => {
          console.log(`   [${segment.offset}-${segment.offset + segment.length - 1}] ${segment.field}: ${segment.value}`);
        });
      }
      console.log('');
    }

    console.log('─────────────────────────────────────────────────────────');
    console.log('⚠️  VERIFY DETAILS ABOVE BEFORE SIGNING ⚠️');
    console.log('─────────────────────────────────────────────────────────\n');
  }

  /**
   * Display compact version (for quick verification)
   * @private
   */
  static _displayCompact(txDetails) {
    console.log(`\n${txDetails.type}: ${txDetails.function || 'Unknown'}`);
    if (txDetails.contract) {
      console.log(`Contract: ${txDetails.contract}`);
    }
    if (Object.keys(txDetails.parameters).length > 0) {
      console.log(`Parameters: ${JSON.stringify(txDetails.parameters, null, 2)}`);
    }
    if (txDetails.transfers.hbar) {
      console.log(`Transfer: ${txDetails.transfers.hbar}`);
    }
    console.log('');
  }
}

module.exports = TransactionDecoder;
