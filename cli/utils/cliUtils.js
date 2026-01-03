/**
 * CLI Utilities Module
 *
 * Provides standardized exit codes, JSON output formatting,
 * and common CLI patterns for all command-line tools.
 */

const chalk = require('chalk');
const path = require('path');
const logger = require('../../shared/logger');

// Load version from package.json
const packageJson = require(path.join(__dirname, '../../package.json'));
const VERSION = packageJson.version;
const PACKAGE_NAME = packageJson.name;

/**
 * Standard exit codes for consistent CLI behavior
 * Following common Unix conventions with Hedera-specific codes
 */
const ExitCodes = {
  SUCCESS: 0,              // Operation completed successfully
  VALIDATION_ERROR: 1,     // Invalid input, arguments, or configuration
  NETWORK_ERROR: 2,        // Network connectivity or Hedera node issues
  AUTH_ERROR: 3,           // Authentication failed (wrong PIN, invalid key)
  TIMEOUT: 4,              // Operation timed out
  USER_CANCELLED: 5,       // User cancelled the operation
  THRESHOLD_NOT_MET: 6,    // Signature threshold not reached
  TRANSACTION_REJECTED: 7, // Transaction rejected by network or participant
  SESSION_ERROR: 8,        // Session creation/management error
  FILE_ERROR: 9,           // File read/write error
  INTERNAL_ERROR: 10       // Unexpected internal error
};

/**
 * JSON output formatter for structured CLI output
 */
class JsonOutput {
  constructor(enabled = false) {
    this.enabled = enabled;
    this.data = {};
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Set a data field in the output
   */
  set(key, value) {
    this.data[key] = value;
    return this;
  }

  /**
   * Add an error message
   */
  addError(message, code = null) {
    this.errors.push({ message, code });
    return this;
  }

  /**
   * Add a warning message
   */
  addWarning(message) {
    this.warnings.push(message);
    return this;
  }

  /**
   * Build the final output object
   */
  build(success = true) {
    const output = {
      success,
      version: VERSION,
      timestamp: new Date().toISOString(),
      data: this.data
    };

    if (this.errors.length > 0) {
      output.errors = this.errors;
    }

    if (this.warnings.length > 0) {
      output.warnings = this.warnings;
    }

    return output;
  }

  /**
   * Print the JSON output to stdout
   */
  print(success = true) {
    if (this.enabled) {
      console.log(JSON.stringify(this.build(success), null, 2));
    }
  }

  /**
   * Print error and exit
   */
  exitWithError(message, exitCode = ExitCodes.INTERNAL_ERROR) {
    this.addError(message, exitCode);
    this.print(false);
    process.exit(exitCode);
  }
}

/**
 * Parse common CLI flags that should be present in all tools
 * Returns an object with parsed common flags and remaining args
 */
function parseCommonFlags(args) {
  const result = {
    json: false,
    version: false,
    help: false,
    verbose: false,
    quiet: false,
    trace: false,    // Most detailed logging
    yes: false,      // Skip confirmations
    dryRun: false,   // Show what would happen
    exportLogs: null, // Path to export logs
    logFile: null,    // Path for live log file
    remainingArgs: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--json':
        result.json = true;
        break;
      case '--version':
      case '-V':
        result.version = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--verbose':
      case '-v':
        result.verbose = true;
        break;
      case '--quiet':
      case '-q':
        result.quiet = true;
        break;
      case '--trace':
        result.trace = true;
        break;
      case '--yes':
      case '-y':
        result.yes = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--export-logs':
        // Next argument is the file path
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result.exportLogs = args[++i];
        } else {
          // Default to timestamped file in current directory
          result.exportLogs = `multisig-logs-${Date.now()}.json`;
        }
        break;
      case '--log-file':
        // Next argument is the file path
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result.logFile = args[++i];
        }
        break;
      default:
        result.remainingArgs.push(arg);
    }
  }

  return result;
}

/**
 * Print version information
 */
function printVersion(json = false) {
  if (json) {
    console.log(JSON.stringify({
      name: PACKAGE_NAME,
      version: VERSION,
      node: process.version
    }, null, 2));
  } else {
    console.log(`${PACKAGE_NAME} v${VERSION}`);
  }
}

/**
 * Exit handler that respects JSON mode
 */
function exitWithError(message, exitCode = ExitCodes.INTERNAL_ERROR, jsonOutput = null) {
  if (jsonOutput && jsonOutput.enabled) {
    jsonOutput.exitWithError(message, exitCode);
  } else {
    console.error(chalk.red(`❌ Error: ${message}`));
    process.exit(exitCode);
  }
}

/**
 * Exit handler for success
 */
function exitWithSuccess(message = null, jsonOutput = null) {
  if (jsonOutput && jsonOutput.enabled) {
    jsonOutput.print(true);
  } else if (message) {
    console.log(chalk.green(`✅ ${message}`));
  }
  process.exit(ExitCodes.SUCCESS);
}

/**
 * Create a formatted help section for common flags
 */
function getCommonFlagsHelp() {
  return `
Common Options:
  --json               Output results as JSON (for scripting/automation)
  -V, --version        Show version information
  -v, --verbose        Enable verbose/debug output
  -q, --quiet          Suppress non-essential output
  --trace              Enable trace-level logging (most detailed)
  -y, --yes            Skip confirmation prompts (non-interactive mode)
  --dry-run            Show what would happen without executing
  --export-logs [path] Export debug logs to file on exit
  --log-file <path>    Write logs to file in real-time
  -h, --help           Show this help message`;
}

/**
 * Initialize logging based on parsed CLI flags
 * Call this early in your CLI tool after parsing flags
 *
 * @param {Object} flags - Parsed flags from parseCommonFlags
 * @param {string} component - Component name for the logger
 * @returns {Object} Logger instance for the component
 */
function initializeLogging(flags, component = 'CLI') {
  // Configure log level based on flags
  logger.setLevelFromFlags({
    verbose: flags.verbose,
    quiet: flags.quiet,
    trace: flags.trace
  });

  // Configure JSON mode if requested
  if (flags.json) {
    logger.configure({ json: true });
  }

  // Set up live log file if requested
  if (flags.logFile) {
    logger.setLogFile(flags.logFile);
  }

  // Set up export on exit if requested
  if (flags.exportLogs) {
    setupLogExport(flags.exportLogs);
  }

  // Return a logger instance for the component
  return logger.createLogger(component);
}

/**
 * Set up automatic log export on process exit
 *
 * @param {string} filePath - Path to export logs to
 */
function setupLogExport(filePath) {
  const handleExit = async () => {
    try {
      const count = await logger.exportLogs(filePath);
      // Use console directly since we're shutting down
      console.error(`Exported ${count} log entries to ${filePath}`);
    } catch (error) {
      console.error(`Failed to export logs: ${error.message}`);
    } finally {
      logger.close();
    }
  };

  // Handle various exit scenarios
  process.on('exit', () => {
    // Synchronous cleanup only - can't await here
    const buffer = logger.getLogBuffer();
    if (buffer.length > 0) {
      try {
        const fs = require('fs');
        const output = buffer.map(entry => JSON.stringify(entry)).join('\n');
        fs.writeFileSync(filePath, output, 'utf8');
      } catch (e) {
        // Ignore errors during exit
      }
    }
  });

  // For SIGINT/SIGTERM we can do async cleanup
  process.on('SIGINT', async () => {
    await handleExit();
    process.exit(130);
  });

  process.on('SIGTERM', async () => {
    await handleExit();
    process.exit(143);
  });
}

/**
 * Get the package version
 */
function getVersion() {
  return VERSION;
}

/**
 * Get the package name
 */
function getPackageName() {
  return PACKAGE_NAME;
}

module.exports = {
  ExitCodes,
  JsonOutput,
  parseCommonFlags,
  printVersion,
  exitWithError,
  exitWithSuccess,
  getCommonFlagsHelp,
  getVersion,
  getPackageName,
  initializeLogging,
  setupLogExport,
  VERSION,
  PACKAGE_NAME
};
