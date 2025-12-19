/**
 * Transaction Display
 *
 * Rich, formatted display of Hedera transactions for review before signing.
 * Provides clear visibility into transaction parameters, fees, and details.
 */

const chalk = require('chalk');
const { Hbar } = require('@hashgraph/sdk');

class TransactionDisplay {
  /**
   * Display full transaction details in a formatted view
   * @param {Object} txDetails - Transaction details from TransactionDecoder
   */
  static displayFull(txDetails) {
    console.log('\n' + chalk.bold.cyan('═'.repeat(80)));
    console.log(chalk.bold.cyan('  TRANSACTION REVIEW'));
    console.log(chalk.bold.cyan('═'.repeat(80)) + '\n');

    // Transaction Type & ID
    this._displaySection('Transaction Information', [
      ['Type', txDetails.transactionType || 'Unknown'],
      ['Transaction ID', txDetails.transactionId || 'Not set'],
      ['Memo', txDetails.memo || '(none)']
    ]);

    // Account Information
    if (txDetails.accountId || txDetails.operatorAccountId) {
      this._displaySection('Account Information', [
        ['Operator Account', txDetails.operatorAccountId || 'Not set'],
        ['Target Account', txDetails.accountId || 'N/A']
      ]);
    }

    // Contract Information (if contract call)
    if (txDetails.contractId || txDetails.functionName) {
      const functionDisplay = txDetails.functionName
        ? `${txDetails.functionName}(${txDetails.functionParameters ? txDetails.functionParameters.length + ' params' : '0 params'})`
        : 'N/A';

      this._displaySection('Contract Call Information', [
        ['Contract ID', txDetails.contractId || 'Not set'],
        ['Function', functionDisplay],
        ['Gas Limit', txDetails.gas || 'Default']
      ]);

      if (txDetails.functionParameters && txDetails.functionParameters.length > 0) {
        console.log(chalk.white.bold('  Function Parameters:'));
        txDetails.functionParameters.forEach((param, index) => {
          console.log(chalk.gray(`    [${index}] `) + this._formatParameter(param));
        });
        console.log();
      }
    }

    // Token Transfer Information
    if (txDetails.tokenTransfers && txDetails.tokenTransfers.length > 0) {
      console.log(chalk.white.bold('  Token Transfers:'));
      txDetails.tokenTransfers.forEach((transfer, index) => {
        const amount = transfer.amount ? this._formatTokenAmount(transfer.amount, transfer.decimals) : 'N/A';
        console.log(chalk.gray(`    [${index}] `) +
          chalk.cyan(`Token ${transfer.tokenId}: `) +
          `${transfer.from} → ${transfer.to} : ${amount}`);
      });
      console.log();
    }

    // HBAR Transfer Information
    if (txDetails.hbarTransfers && txDetails.hbarTransfers.length > 0) {
      console.log(chalk.white.bold('  HBAR Transfers:'));
      txDetails.hbarTransfers.forEach((transfer, index) => {
        const amount = transfer.amount ? Hbar.fromTinybars(transfer.amount).toString() : 'N/A';
        console.log(chalk.gray(`    [${index}] `) +
          `${transfer.from} → ${transfer.to} : ${chalk.green(amount)}`);
      });
      console.log();
    }

    // Fee Information
    this._displaySection('Transaction Fees', [
      ['Max Transaction Fee', txDetails.maxTransactionFee
        ? Hbar.fromTinybars(txDetails.maxTransactionFee).toString()
        : 'Default'],
      ['Estimated Fee', txDetails.estimatedFee || 'Not calculated']
    ]);

    // Timing Information
    if (txDetails.validStart || txDetails.expirationTime) {
      const validStart = txDetails.validStart
        ? new Date(txDetails.validStart * 1000).toLocaleString()
        : 'Not set';
      const expiration = txDetails.expirationTime
        ? new Date(txDetails.expirationTime * 1000).toLocaleString()
        : 'Not set';
      const timeRemaining = txDetails.expirationTime
        ? this._formatTimeRemaining(txDetails.expirationTime)
        : 'N/A';

      this._displaySection('Timing Information', [
        ['Valid Start', validStart],
        ['Expires At', expiration],
        ['Time Remaining', timeRemaining]
      ]);
    }

    // Signature Requirements
    if (txDetails.requiredSignatures || txDetails.signatureThreshold) {
      this._displaySection('Signature Requirements', [
        ['Required Signers', txDetails.requiredSignatures || 'Not specified'],
        ['Threshold', txDetails.signatureThreshold || 'Not specified'],
        ['Collected Signatures', txDetails.collectedSignatures || '0']
      ]);
    }

    console.log(chalk.bold.cyan('═'.repeat(80)) + '\n');
  }

  /**
   * Display compact transaction summary
   * @param {Object} txDetails - Transaction details from TransactionDecoder
   */
  static displaySummary(txDetails) {
    console.log('\n' + chalk.bold('Transaction Summary:'));
    console.log(chalk.cyan('  Type: ') + (txDetails.transactionType || 'Unknown'));

    if (txDetails.contractId) {
      console.log(chalk.cyan('  Contract: ') + txDetails.contractId);
      if (txDetails.functionName) {
        console.log(chalk.cyan('  Function: ') + txDetails.functionName);
      }
    }

    if (txDetails.accountId) {
      console.log(chalk.cyan('  Account: ') + txDetails.accountId);
    }

    if (txDetails.maxTransactionFee) {
      const fee = Hbar.fromTinybars(txDetails.maxTransactionFee).toString();
      console.log(chalk.cyan('  Max Fee: ') + fee);
    }

    if (txDetails.expirationTime) {
      const timeRemaining = this._formatTimeRemaining(txDetails.expirationTime);
      const color = this._getTimeColor(txDetails.expirationTime);
      console.log(chalk.cyan('  Expires: ') + chalk[color](timeRemaining));
    }

    console.log();
  }

  /**
   * Display signature collection status
   * @param {number} collected - Number of signatures collected
   * @param {number} required - Number of signatures required
   * @param {Array<Object>} signers - Array of signer information
   */
  static displaySignatureStatus(collected, required, signers = []) {
    console.log('\n' + chalk.bold('Signature Collection Status:'));

    const percentage = Math.floor((collected / required) * 100);
    const barLength = 30;
    const filledLength = Math.floor((collected / required) * barLength);
    const emptyLength = barLength - filledLength;

    const bar = chalk.green('█'.repeat(filledLength)) + chalk.gray('░'.repeat(emptyLength));
    console.log(`  ${bar} ${percentage}%`);
    console.log(chalk.cyan(`  ${collected} of ${required} required signatures collected\n`));

    if (signers.length > 0) {
      console.log(chalk.white.bold('  Signers:'));
      signers.forEach((signer, index) => {
        const status = signer.signed
          ? chalk.green('✓ Signed')
          : chalk.gray('○ Pending');
        const label = signer.label || signer.accountId || `Signer ${index + 1}`;
        console.log(`    ${status} - ${label}`);
      });
      console.log();
    }
  }

  /**
   * Display transaction execution result
   * @param {Object} receipt - Transaction receipt from execution
   * @param {Object} txDetails - Original transaction details
   */
  static displayReceipt(receipt, txDetails = {}) {
    console.log('\n' + chalk.bold.green('═'.repeat(80)));
    console.log(chalk.bold.green('  TRANSACTION EXECUTED SUCCESSFULLY'));
    console.log(chalk.bold.green('═'.repeat(80)) + '\n');

    this._displaySection('Execution Results', [
      ['Status', chalk.green('SUCCESS')],
      ['Transaction ID', receipt.transactionId?.toString() || 'Unknown'],
      ['Receipt Status', receipt.status?.toString() || 'Unknown']
    ]);

    if (receipt.contractFunctionResult) {
      console.log(chalk.white.bold('  Contract Call Results:'));
      console.log(chalk.gray('    Gas Used: ') + (receipt.contractFunctionResult.gasUsed || 'N/A'));

      if (receipt.contractFunctionResult.errorMessage) {
        console.log(chalk.red('    Error: ') + receipt.contractFunctionResult.errorMessage);
      }
      console.log();
    }

    if (receipt.transactionHash) {
      console.log(chalk.white.bold('  Transaction Hash:'));
      console.log(chalk.gray('    ' + receipt.transactionHash.toString('hex')) + '\n');
    }

    console.log(chalk.bold.green('═'.repeat(80)) + '\n');
  }

  /**
   * Display warning before signing
   * @param {Object} txDetails - Transaction details
   */
  static displaySigningWarning(txDetails) {
    console.log('\n' + chalk.yellow.bold('⚠  WARNING: Please Review Carefully Before Signing  ⚠\n'));

    console.log(chalk.white('You are about to sign a transaction that will:'));

    if (txDetails.contractId && txDetails.functionName) {
      console.log(chalk.yellow(`  • Execute function "${txDetails.functionName}" on contract ${txDetails.contractId}`));
    }

    if (txDetails.hbarTransfers && txDetails.hbarTransfers.length > 0) {
      console.log(chalk.yellow('  • Transfer HBAR between accounts'));
    }

    if (txDetails.tokenTransfers && txDetails.tokenTransfers.length > 0) {
      console.log(chalk.yellow('  • Transfer tokens between accounts'));
    }

    console.log(chalk.white('\nOnce signed and executed, this transaction CANNOT be reversed.\n'));

    console.log(chalk.cyan('Verify:'));
    console.log('  ✓ Contract ID and function name are correct');
    console.log('  ✓ All parameters and amounts are accurate');
    console.log('  ✓ You trust the transaction creator');
    console.log('  ✓ This matches your intended operation\n');
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Display a formatted section with label-value pairs
   * @private
   */
  static _displaySection(title, items) {
    console.log(chalk.white.bold(`  ${title}:`));
    items.forEach(([label, value]) => {
      const paddedLabel = (label + ':').padEnd(20);
      console.log(chalk.gray(`    ${paddedLabel}`) + value);
    });
    console.log();
  }

  /**
   * Format a parameter value for display
   * @private
   */
  static _formatParameter(param) {
    if (typeof param === 'object' && param !== null) {
      if (Buffer.isBuffer(param)) {
        return `Buffer(${param.length} bytes): ${param.toString('hex').substring(0, 32)}...`;
      }
      return JSON.stringify(param, null, 2);
    }
    return String(param);
  }

  /**
   * Format token amount with decimals
   * @private
   */
  static _formatTokenAmount(amount, decimals = 0) {
    if (!amount) return '0';
    const value = Number(amount) / Math.pow(10, decimals);
    return value.toLocaleString();
  }

  /**
   * Format time remaining until expiration
   * @private
   */
  static _formatTimeRemaining(expirationTimestamp) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = expirationTimestamp - now;

    if (remaining <= 0) {
      return chalk.red.bold('EXPIRED');
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Get color based on time remaining
   * @private
   */
  static _getTimeColor(expirationTimestamp) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = expirationTimestamp - now;

    if (remaining <= 0) return 'red';
    if (remaining < 30) return 'red';
    if (remaining < 60) return 'yellow';
    return 'green';
  }
}

module.exports = TransactionDisplay;
