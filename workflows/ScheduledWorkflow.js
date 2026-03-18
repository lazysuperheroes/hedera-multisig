/**
 * Scheduled Workflow
 *
 * Async multi-sig signing via Hedera ScheduleCreate/ScheduleSign.
 * Removes the 120-second constraint by wrapping transactions in a schedule
 * that can collect signatures over hours or days.
 *
 * Flow:
 * 1. Create inner transaction (transfer, contract call, etc.)
 * 2. Wrap in ScheduleCreateTransaction
 * 3. Submit to Hedera — returns a Schedule ID
 * 4. Share schedule ID with signers
 * 5. Each signer submits ScheduleSignTransaction at their convenience
 * 6. Network auto-executes when threshold is met
 *
 * No WebSocket coordination required — each signer acts independently.
 */

const {
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  ScheduleInfoQuery,
  Transaction,
  TransactionId,
} = require('@hashgraph/sdk');

const chalk = require('chalk');
const ProgressIndicator = require('../ui/ProgressIndicator');

class ScheduledWorkflow {
  /**
   * @param {Client} client - Hedera client with operator credentials
   * @param {Object} options
   * @param {string} [options.scheduleMemo] - Memo for the scheduled transaction
   * @param {boolean} [options.verbose] - Show progress output
   */
  constructor(client, options = {}) {
    this.client = client;
    this.options = {
      verbose: options.verbose !== false,
      scheduleMemo: options.scheduleMemo || '',
      ...options
    };
    this.progress = new ProgressIndicator();
  }

  /**
   * Create a scheduled transaction from an inner transaction.
   * The inner transaction is NOT frozen — the schedule wraps it.
   *
   * @param {Transaction} innerTransaction - The transaction to schedule (e.g., TransferTransaction)
   * @param {Object} options
   * @param {AccountId} [options.payerAccountId] - Payer for the scheduled tx (defaults to operator)
   * @param {Date} [options.expirationTime] - When the schedule expires (default: network default)
   * @returns {Promise<{ scheduleId: string, transactionId: string, innerTransaction: Object }>}
   */
  async createSchedule(innerTransaction, options = {}) {
    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('\n━━━ Create Scheduled Transaction ━━━\n'));
      }

      this.progress.startSpinner('Creating scheduled transaction');

      // Build the ScheduleCreateTransaction
      const scheduleTx = new ScheduleCreateTransaction()
        .setScheduledTransaction(innerTransaction);

      if (this.options.scheduleMemo) {
        scheduleTx.setScheduleMemo(this.options.scheduleMemo);
      }

      if (options.payerAccountId) {
        scheduleTx.setPayerAccountId(options.payerAccountId);
      }

      if (options.expirationTime) {
        scheduleTx.setExpirationTime(options.expirationTime);
      }

      // Execute the schedule creation
      const txResponse = await scheduleTx.execute(this.client);
      const receipt = await txResponse.getReceipt(this.client);

      this.progress.stopSpinner();

      const scheduleId = receipt.scheduleId.toString();
      const transactionId = txResponse.transactionId.toString();

      if (this.options.verbose) {
        console.log(chalk.green(`\n✅ Schedule created successfully!`));
        console.log(chalk.white(`   Schedule ID: ${scheduleId}`));
        console.log(chalk.white(`   Transaction ID: ${transactionId}`));
        console.log(chalk.yellow(`\n   Share this Schedule ID with signers.`));
        console.log(chalk.yellow(`   They can sign at their convenience using:`));
        console.log(chalk.cyan(`   hedera-multisig schedule sign --schedule-id ${scheduleId}\n`));
      }

      return {
        success: true,
        scheduleId,
        transactionId,
      };

    } catch (error) {
      this.progress.stopSpinner();
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sign a scheduled transaction.
   * Each signer calls this independently with their own key.
   *
   * @param {string} scheduleId - The schedule ID to sign
   * @param {PrivateKey} privateKey - Signer's private key
   * @returns {Promise<{ success: boolean, transactionId?: string }>}
   */
  async signSchedule(scheduleId, privateKey) {
    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan(`\n━━━ Sign Schedule ${scheduleId} ━━━\n`));
      }

      this.progress.startSpinner('Submitting schedule signature');

      const signTx = new ScheduleSignTransaction()
        .setScheduleId(scheduleId)
        .freezeWith(this.client);

      const signedTx = await signTx.sign(privateKey);
      const txResponse = await signedTx.execute(this.client);
      const receipt = await txResponse.getReceipt(this.client);

      this.progress.stopSpinner();

      const transactionId = txResponse.transactionId.toString();

      if (this.options.verbose) {
        console.log(chalk.green(`\n✅ Schedule signed successfully!`));
        console.log(chalk.white(`   Transaction ID: ${transactionId}`));
        console.log(chalk.white(`   Status: ${receipt.status.toString()}\n`));
      }

      return {
        success: true,
        transactionId,
        status: receipt.status.toString(),
      };

    } catch (error) {
      this.progress.stopSpinner();

      // Check if the schedule was already executed (threshold met by this signature)
      if (error.message && error.message.includes('SCHEDULE_ALREADY_EXECUTED')) {
        if (this.options.verbose) {
          console.log(chalk.green(`\n✅ Schedule was executed! Threshold met with this signature.\n`));
        }
        return {
          success: true,
          executed: true,
          message: 'Schedule executed — threshold met',
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Query the status of a scheduled transaction.
   *
   * @param {string} scheduleId - The schedule ID to query
   * @returns {Promise<{ scheduleId: string, executed: boolean, deleted: boolean, signatories: string[], memo: string }>}
   */
  async getScheduleInfo(scheduleId) {
    try {
      const info = await new ScheduleInfoQuery()
        .setScheduleId(scheduleId)
        .execute(this.client);

      const signatories = [];
      if (info.signatories) {
        for (const key of info.signatories) {
          signatories.push(key.toString());
        }
      }

      return {
        success: true,
        scheduleId: info.scheduleId.toString(),
        executed: info.executedAt != null,
        deleted: info.deletedAt != null,
        memo: info.scheduleMemo || '',
        signatories,
        creatorAccountId: info.creatorAccountId?.toString(),
        payerAccountId: info.payerAccountId?.toString(),
        expirationTime: info.expirationTime?.toDate()?.toISOString() || null,
        executedAt: info.executedAt?.toDate()?.toISOString() || null,
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = ScheduledWorkflow;
