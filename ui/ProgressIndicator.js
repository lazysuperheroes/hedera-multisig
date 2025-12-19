/**
 * Progress Indicator
 *
 * Provides visual feedback for multi-signature workflows including:
 * - Countdown timers for transaction expiration
 * - Spinners for async operations
 * - Progress bars for multi-step processes
 */

const chalk = require('chalk');

class ProgressIndicator {
  constructor() {
    this.activeTimer = null;
    this.spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.spinnerIndex = 0;
    this.spinnerInterval = null;
  }

  /**
   * Start a countdown timer showing time remaining until transaction expiry
   * @param {number} expiryTimestamp - Unix timestamp when transaction expires
   * @param {function} onExpired - Callback when timer reaches zero
   * @returns {NodeJS.Timer} Timer instance
   */
  startCountdown(expiryTimestamp, onExpired = null) {
    this.stopCountdown(); // Clear any existing timer

    const updateInterval = 1000; // Update every second

    this.activeTimer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = expiryTimestamp - now;

      if (remaining <= 0) {
        this.stopCountdown();
        process.stdout.write('\r' + chalk.red.bold('⏰ Transaction EXPIRED') + '\n');
        if (onExpired) onExpired();
        return;
      }

      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      // Color code based on urgency
      let coloredTime;
      if (remaining > 60) {
        coloredTime = chalk.green(timeStr);
      } else if (remaining > 30) {
        coloredTime = chalk.yellow(timeStr);
      } else {
        coloredTime = chalk.red.bold(timeStr);
      }

      process.stdout.write('\r⏱  Time remaining: ' + coloredTime + '  ');
    }, updateInterval);

    return this.activeTimer;
  }

  /**
   * Stop the countdown timer
   */
  stopCountdown() {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
      process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear line
    }
  }

  /**
   * Show a spinner for async operations
   * @param {string} message - Message to display alongside spinner
   */
  startSpinner(message = 'Processing') {
    this.stopSpinner(); // Clear any existing spinner

    this.spinnerInterval = setInterval(() => {
      const frame = this.spinnerFrames[this.spinnerIndex];
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;

      process.stdout.write('\r' + chalk.cyan(frame) + ' ' + message + '  ');
    }, 80);
  }

  /**
   * Stop the spinner
   */
  stopSpinner() {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
      process.stdout.write('\r' + ' '.repeat(100) + '\r'); // Clear line
    }
  }

  /**
   * Show a progress bar
   * @param {number} current - Current step number
   * @param {number} total - Total number of steps
   * @param {string} label - Description of current step
   */
  showProgress(current, total, label = '') {
    const percentage = Math.floor((current / total) * 100);
    const barLength = 30;
    const filledLength = Math.floor((current / total) * barLength);
    const emptyLength = barLength - filledLength;

    const bar = chalk.green('█'.repeat(filledLength)) + chalk.gray('░'.repeat(emptyLength));
    const stepInfo = chalk.cyan(`[${current}/${total}]`);
    const percentStr = chalk.yellow(`${percentage}%`);

    console.log(`${stepInfo} ${bar} ${percentStr} ${label}`);
  }

  /**
   * Display a signature collection status
   * @param {number} collected - Number of signatures collected
   * @param {number} required - Number of signatures required
   * @param {Array<string>} signerLabels - Labels for each signer
   */
  showSignatureStatus(collected, required, signerLabels = []) {
    console.log('\n' + chalk.bold.underline('Signature Collection Status:'));
    console.log(chalk.cyan(`Required: ${required} signatures`));
    console.log(chalk.green(`Collected: ${collected} of ${required}`));

    if (signerLabels.length > 0) {
      console.log('\nSigners:');
      signerLabels.forEach((label, index) => {
        const status = index < collected
          ? chalk.green('✓ Signed')
          : chalk.gray('○ Pending');
        console.log(`  ${status} - ${label}`);
      });
    }

    const percentage = Math.floor((collected / required) * 100);
    const barLength = 20;
    const filledLength = Math.floor((collected / required) * barLength);
    const emptyLength = barLength - filledLength;
    const bar = chalk.green('█'.repeat(filledLength)) + chalk.gray('░'.repeat(emptyLength));

    console.log(`\n${bar} ${percentage}%`);
  }

  /**
   * Show a success message
   * @param {string} message - Success message to display
   */
  success(message) {
    console.log(chalk.green('✓ ') + message);
  }

  /**
   * Show an info message
   * @param {string} message - Info message to display
   */
  info(message) {
    console.log(chalk.cyan('ℹ ') + message);
  }

  /**
   * Show a warning message
   * @param {string} message - Warning message to display
   */
  warning(message) {
    console.log(chalk.yellow('⚠ ') + message);
  }

  /**
   * Show an error message
   * @param {string} message - Error message to display
   */
  error(message) {
    console.log(chalk.red('✗ ') + message);
  }

  /**
   * Clean up all active timers/spinners
   */
  cleanup() {
    this.stopCountdown();
    this.stopSpinner();
  }
}

module.exports = ProgressIndicator;
