/**
 * Transaction terminal display utility.
 *
 * Decoding logic moved to `shared/transaction-decoder/` in v2.1.0 (Phase A10/A11).
 * This module retains only the small terminal-display adapter that
 * `SignatureCollector` uses during interactive ceremonies. It consumes the
 * `txDetails` shape produced by `SharedDecoder.extractTransactionDetails`
 * (i.e. the canonical shape — not the legacy one).
 *
 * For richer multi-section output (tables, time remaining, signature progress)
 * use `ui/TransactionDisplay.displayFull()` instead.
 */

class TransactionDecoder {
  /**
   * Render a brief, human-readable summary of a frozen transaction.
   *
   * @param {Object} txDetails - Output of `SharedDecoder.extractTransactionDetails`
   * @param {Object} [options]
   * @param {boolean} [options.verbose=false] - Include selector + raw calldata
   * @param {boolean} [options.compact=false] - One-line summary
   */
  static display(txDetails, options = { verbose: false, compact: false }) {
    if (!txDetails) {
      console.log('(no transaction details)');
      return;
    }
    if (options.compact) {
      this._displayCompact(txDetails);
      return;
    }

    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║          TRANSACTION DETAILS FOR SIGNING              ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log(`📄 Type: ${txDetails.type || 'Unknown'}`);

    if (txDetails.transactionId) {
      console.log(`🔖 Transaction ID: ${txDetails.transactionId}`);
    }

    if (txDetails.contractId) {
      console.log(`📋 Contract: ${txDetails.contractId}`);
    }

    if (txDetails.functionName) {
      const verifiedFlag = txDetails.selectorVerified === true ? ' ✓ ABI-verified' :
                           txDetails.selectorVerified === false ? ' ⚠ unverified' : '';
      console.log(`⚙️  Function: ${txDetails.functionName}${verifiedFlag}`);
    }

    if (txDetails.functionParams && txDetails.functionParams.length > 0) {
      console.log('\n📝 PARAMETERS:');
      txDetails.functionParams.forEach((param, idx) => {
        const name = param.name || `arg${idx}`;
        console.log(`   ${name} (${param.type || 'unknown'}): ${param.value}`);
      });
    }

    // HBAR transfers (canonical shape: array of { accountId, amount })
    if (Array.isArray(txDetails.transfers) && txDetails.transfers.length > 0) {
      console.log('\n💰 HBAR TRANSFERS:');
      txDetails.transfers.forEach((t) => {
        const tinybars = t.amount;
        const hbar = (parseInt(tinybars, 10) / 100000000).toFixed(8);
        const direction = parseInt(tinybars, 10) > 0 ? 'to' : 'from';
        console.log(`   ${hbar} HBAR ${direction} ${t.accountId}`);
      });
    }

    // Token transfers (canonical shape: array of { tokenId, transfers: [{accountId, amount}] })
    if (Array.isArray(txDetails.tokenTransfers) && txDetails.tokenTransfers.length > 0) {
      console.log('\n🪙 TOKEN TRANSFERS:');
      txDetails.tokenTransfers.forEach((group) => {
        console.log(`   Token ${group.tokenId}:`);
        group.transfers.forEach((t) => {
          console.log(`     ${t.amount} to/from ${t.accountId}`);
        });
      });
    }

    // NFT transfers
    if (Array.isArray(txDetails.nftTransfers) && txDetails.nftTransfers.length > 0) {
      console.log('\n🖼️  NFT TRANSFERS:');
      txDetails.nftTransfers.forEach((group) => {
        console.log(`   Token ${group.tokenId}:`);
        group.transfers.forEach((t) => {
          console.log(`     #${t.serialNumber}: ${t.senderAccountId} → ${t.receiverAccountId}`);
        });
      });
    }

    if (txDetails.gas) {
      console.log('\n⛽ GAS:');
      const gasLimit = typeof txDetails.gas === 'object' ? txDetails.gas.limit : txDetails.gas;
      if (gasLimit) {
        console.log(`   Limit: ${Number(gasLimit).toLocaleString()}`);
      }
    }

    if (txDetails.transactionMemo) {
      console.log(`\n💬 Memo: ${txDetails.transactionMemo}`);
    }

    if (options.verbose) {
      console.log('\n🔍 RAW DATA:');
      if (txDetails.functionSelector) {
        console.log(`   Function Selector: ${txDetails.functionSelector}`);
      }
      if (txDetails.encodedParams) {
        const truncated = txDetails.encodedParams.length > 66
          ? txDetails.encodedParams.substring(0, 66) + '...'
          : txDetails.encodedParams;
        console.log(`   Encoded Parameters: ${truncated}`);
      }
      if (txDetails.maxTransactionFee) {
        console.log(`   Max Transaction Fee: ${txDetails.maxTransactionFee} tinybars`);
      }
    }

    console.log('\n─────────────────────────────────────────────────────────');
    console.log('⚠️  VERIFY DETAILS ABOVE BEFORE SIGNING ⚠️');
    console.log('─────────────────────────────────────────────────────────\n');
  }

  static _displayCompact(txDetails) {
    console.log(`\n${txDetails.type || 'Unknown'}: ${txDetails.functionName || ''}`);
    if (txDetails.contractId) console.log(`Contract: ${txDetails.contractId}`);
    if (Array.isArray(txDetails.transfers) && txDetails.transfers.length > 0) {
      console.log(`HBAR transfers: ${txDetails.transfers.length}`);
    }
    console.log('');
  }
}

module.exports = TransactionDecoder;
