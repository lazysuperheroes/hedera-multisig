/**
 * Human-friendly time-input parser for CLI flags.
 *
 * Accepts:
 *   - Duration suffixes: "60s", "30m", "2h", "30d", "8w"
 *   - ISO-8601 timestamps: "2026-06-30T12:00:00Z", "2026-06-30"
 *
 * Returns a JS Date in the future. Enforces the Hedera HIP-423 max
 * expiration horizon (~62 days) for scheduled-transaction expiration times.
 */

// HIP-423 cap: scheduling.maxExpirationFutureSeconds = 5,356,800 (62 days)
const MAX_SCHEDULE_DURATION_SECONDS = 5356800;

const DURATION_PATTERN = /^(\d+)([smhdw])$/i;

const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 3600 * 1000,
  d: 86400 * 1000,
  w: 7 * 86400 * 1000,
};

/**
 * Parse a duration or ISO-8601 timestamp into a future Date.
 *
 * @param {string} input - Duration suffix or ISO-8601 string
 * @param {Object} [options]
 * @param {boolean} [options.enforceScheduleHorizon=true] - Cap at HIP-423 max
 * @returns {Date} Future Date
 * @throws {Error} on invalid format, past time, or horizon violation
 */
function parseExpirationTime(input, options = {}) {
  if (input === null || input === undefined || input === '') {
    return null;
  }

  const enforceHorizon = options.enforceScheduleHorizon !== false;
  const trimmed = String(input).trim();

  const durationMatch = trimmed.match(DURATION_PATTERN);
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2].toLowerCase();
    if (value <= 0) {
      throw new Error(`Invalid duration "${trimmed}": value must be positive.`);
    }
    const ms = value * UNIT_MS[unit];
    const date = new Date(Date.now() + ms);
    if (enforceHorizon) {
      validateScheduleHorizon(date, trimmed);
    }
    return date;
  }

  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime())) {
    if (isoDate.getTime() <= Date.now()) {
      throw new Error(`expiration-time "${trimmed}" is in the past.`);
    }
    if (enforceHorizon) {
      validateScheduleHorizon(isoDate, trimmed);
    }
    return isoDate;
  }

  throw new Error(
    `Invalid expiration-time: "${trimmed}". ` +
    `Use a duration suffix like "30d" / "2h" / "60s" / "8w", ` +
    `or an ISO-8601 timestamp like "2026-06-30T12:00:00Z".`
  );
}

function validateScheduleHorizon(date, original) {
  const futureSeconds = (date.getTime() - Date.now()) / 1000;
  if (futureSeconds > MAX_SCHEDULE_DURATION_SECONDS) {
    const days = Math.ceil(futureSeconds / 86400);
    throw new Error(
      `Expiration "${original}" is ${days} days in the future, which exceeds the ` +
      `Hedera HIP-423 limit of ~62 days ` +
      `(scheduling.maxExpirationFutureSeconds = ${MAX_SCHEDULE_DURATION_SECONDS}s).`
    );
  }
}

module.exports = {
  parseExpirationTime,
  MAX_SCHEDULE_DURATION_SECONDS,
};
