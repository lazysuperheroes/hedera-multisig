/**
 * Structured Logger Module
 *
 * Provides configurable logging with levels, file output, and chalk formatting.
 * Designed for both interactive CLI use and background server operation.
 *
 * Log Levels (in order of severity):
 *   error: 0 - Errors that prevent operation
 *   warn:  1 - Warnings that don't stop operation
 *   info:  2 - Important operational information
 *   debug: 3 - Detailed debugging information
 *   trace: 4 - Very detailed tracing (performance, flow)
 *
 * Usage:
 *   const { createLogger } = require('../shared/logger');
 *   const logger = createLogger('WebSocketServer');
 *   logger.info('Server started on port %d', port);
 *   logger.debug('Client connected', { clientId, ip });
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// Log level constants
const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

// Level name mapping
const LEVEL_NAMES = ['error', 'warn', 'info', 'debug', 'trace'];

// Chalk colors for each level
const LEVEL_COLORS = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.cyan,
  debug: chalk.gray,
  trace: chalk.dim
};

// Emoji prefixes for interactive mode
const LEVEL_EMOJI = {
  error: '❌',
  warn: '⚠️ ',
  info: 'ℹ️ ',
  debug: '🔍',
  trace: '📍'
};

/**
 * Global logger configuration
 */
const config = {
  level: LogLevel.INFO,          // Current log level
  useColors: true,               // Use chalk colors
  useEmoji: true,                // Use emoji prefixes
  useTimestamp: false,           // Include timestamp in output
  fileOutput: null,              // File path for log output
  fileStream: null,              // File write stream
  jsonMode: false,               // Output as JSON (for automation)
  quiet: false,                  // Suppress all output except errors
  logBuffer: [],                 // Buffer for export
  maxBufferSize: 1000,           // Max entries to keep in buffer
  isTTY: process.stdout.isTTY    // Detect if running in terminal
};

/**
 * Format a log message with optional data
 *
 * @param {string} message - Log message (supports %s, %d, %j placeholders)
 * @param {any[]} args - Arguments for placeholder substitution
 * @returns {string} Formatted message
 */
function formatMessage(message, args) {
  if (args.length === 0) return message;

  let formatted = message;
  let argIndex = 0;

  // Handle printf-style placeholders
  formatted = formatted.replace(/%([sdj%])/g, (match, type) => {
    if (type === '%') return '%';
    if (argIndex >= args.length) return match;

    const arg = args[argIndex++];
    switch (type) {
      case 's': return String(arg);
      case 'd': return Number(arg);
      case 'j': return safeStringify(arg);
      default: return match;
    }
  });

  // Append remaining arguments as JSON if any
  if (argIndex < args.length) {
    const remaining = args.slice(argIndex);
    const extraData = remaining.length === 1 ? remaining[0] : remaining;
    formatted += ' ' + safeStringify(extraData);
  }

  return formatted;
}

/**
 * Safely stringify objects (handles circular references)
 *
 * @param {any} obj - Object to stringify
 * @returns {string} JSON string
 */
function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    // Handle BigInt
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, 2);
}

/**
 * Get current timestamp in ISO format
 *
 * @returns {string} ISO timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Write log entry to file
 *
 * @param {Object} entry - Log entry object
 */
function writeToFile(entry) {
  if (!config.fileStream) return;

  try {
    config.fileStream.write(JSON.stringify(entry) + '\n');
  } catch (error) {
    // Silently fail file writes to avoid infinite loops
  }
}

/**
 * Add entry to buffer for later export
 *
 * @param {Object} entry - Log entry object
 */
function addToBuffer(entry) {
  config.logBuffer.push(entry);
  if (config.logBuffer.length > config.maxBufferSize) {
    config.logBuffer.shift(); // Remove oldest entry
  }
}

/**
 * Core logging function
 *
 * @param {number} level - Log level
 * @param {string} component - Component name
 * @param {string} message - Log message
 * @param {any[]} args - Additional arguments
 */
function log(level, component, message, args) {
  // Check if this level should be logged
  if (level > config.level) return;
  if (config.quiet && level > LogLevel.ERROR) return;

  const levelName = LEVEL_NAMES[level];
  const timestamp = getTimestamp();
  const formattedMessage = formatMessage(message, args);

  // Create log entry
  const entry = {
    timestamp,
    level: levelName,
    component,
    message: formattedMessage
  };

  // Add to buffer for export
  addToBuffer(entry);

  // Write to file if configured
  writeToFile(entry);

  // Console output
  if (config.jsonMode) {
    // JSON output for automation
    console.log(JSON.stringify(entry));
  } else {
    // Human-readable output
    let output = '';

    // Timestamp (optional)
    if (config.useTimestamp) {
      output += chalk.gray(`[${timestamp}] `);
    }

    // Level with color/emoji
    const levelColor = LEVEL_COLORS[levelName];
    if (config.useEmoji && config.isTTY) {
      output += `${LEVEL_EMOJI[levelName]} `;
    }
    if (config.useColors && config.isTTY) {
      output += levelColor(`[${levelName.toUpperCase()}]`) + ' ';
    } else {
      output += `[${levelName.toUpperCase()}] `;
    }

    // Component
    if (component) {
      if (config.useColors && config.isTTY) {
        output += chalk.blue(`[${component}]`) + ' ';
      } else {
        output += `[${component}] `;
      }
    }

    // Message
    output += formattedMessage;

    // Use appropriate console method
    if (level === LogLevel.ERROR) {
      console.error(output);
    } else if (level === LogLevel.WARN) {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

/**
 * Create a logger instance for a specific component
 *
 * @param {string} component - Component name (e.g., 'WebSocketServer', 'SigningClient')
 * @returns {Object} Logger instance with level methods
 */
function createLogger(component) {
  return {
    error: (message, ...args) => log(LogLevel.ERROR, component, message, args),
    warn: (message, ...args) => log(LogLevel.WARN, component, message, args),
    info: (message, ...args) => log(LogLevel.INFO, component, message, args),
    debug: (message, ...args) => log(LogLevel.DEBUG, component, message, args),
    trace: (message, ...args) => log(LogLevel.TRACE, component, message, args),

    // Check if a level is enabled
    isErrorEnabled: () => LogLevel.ERROR <= config.level,
    isWarnEnabled: () => LogLevel.WARN <= config.level,
    isInfoEnabled: () => LogLevel.INFO <= config.level,
    isDebugEnabled: () => LogLevel.DEBUG <= config.level,
    isTraceEnabled: () => LogLevel.TRACE <= config.level,

    // Child logger with sub-component
    child: (subComponent) => createLogger(`${component}:${subComponent}`)
  };
}

/**
 * Configure the global logger settings
 *
 * @param {Object} options - Configuration options
 * @param {string} [options.level] - Log level ('error', 'warn', 'info', 'debug', 'trace')
 * @param {boolean} [options.colors] - Enable/disable colors
 * @param {boolean} [options.emoji] - Enable/disable emoji
 * @param {boolean} [options.timestamp] - Include timestamps
 * @param {string} [options.file] - File path for log output
 * @param {boolean} [options.json] - Output as JSON
 * @param {boolean} [options.quiet] - Quiet mode (errors only)
 */
function configure(options = {}) {
  if (options.level !== undefined) {
    const levelIndex = LEVEL_NAMES.indexOf(options.level.toLowerCase());
    if (levelIndex !== -1) {
      config.level = levelIndex;
    }
  }

  if (options.colors !== undefined) {
    config.useColors = options.colors;
  }

  if (options.emoji !== undefined) {
    config.useEmoji = options.emoji;
  }

  if (options.timestamp !== undefined) {
    config.useTimestamp = options.timestamp;
  }

  if (options.json !== undefined) {
    config.jsonMode = options.json;
    if (options.json) {
      config.useColors = false;
      config.useEmoji = false;
    }
  }

  if (options.quiet !== undefined) {
    config.quiet = options.quiet;
  }

  if (options.file) {
    setLogFile(options.file);
  }
}

/**
 * Set log file output
 *
 * @param {string} filePath - Path to log file
 */
function setLogFile(filePath) {
  // Close existing stream
  if (config.fileStream) {
    config.fileStream.end();
  }

  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open file stream (append mode)
    config.fileStream = fs.createWriteStream(filePath, { flags: 'a' });
    config.fileOutput = filePath;
  } catch (error) {
    console.error(`Failed to open log file: ${error.message}`);
  }
}

/**
 * Export buffered logs to a file
 *
 * @param {string} filePath - Output file path
 * @returns {Promise<number>} Number of entries exported
 */
async function exportLogs(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const output = config.logBuffer.map(entry => JSON.stringify(entry)).join('\n');
      fs.writeFileSync(filePath, output, 'utf8');
      resolve(config.logBuffer.length);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Get current log buffer
 *
 * @returns {Object[]} Array of log entries
 */
function getLogBuffer() {
  return [...config.logBuffer];
}

/**
 * Clear the log buffer
 */
function clearLogBuffer() {
  config.logBuffer = [];
}

/**
 * Close the logger (cleanup file streams)
 */
function close() {
  if (config.fileStream) {
    config.fileStream.end();
    config.fileStream = null;
  }
}

/**
 * Set log level from CLI flags
 *
 * @param {Object} flags - Parsed CLI flags
 * @param {boolean} [flags.verbose] - Enable debug level
 * @param {boolean} [flags.quiet] - Enable quiet mode
 * @param {boolean} [flags.trace] - Enable trace level
 */
function setLevelFromFlags(flags) {
  if (flags.quiet) {
    config.quiet = true;
    config.level = LogLevel.ERROR;
  } else if (flags.trace) {
    config.level = LogLevel.TRACE;
  } else if (flags.verbose) {
    config.level = LogLevel.DEBUG;
  }
}

// Default logger for quick use
const defaultLogger = createLogger('App');

module.exports = {
  // Logger creation
  createLogger,
  configure,

  // File operations
  setLogFile,
  exportLogs,
  getLogBuffer,
  clearLogBuffer,
  close,

  // CLI integration
  setLevelFromFlags,

  // Constants
  LogLevel,
  LEVEL_NAMES,

  // Default logger methods (convenience)
  error: defaultLogger.error,
  warn: defaultLogger.warn,
  info: defaultLogger.info,
  debug: defaultLogger.debug,
  trace: defaultLogger.trace
};
