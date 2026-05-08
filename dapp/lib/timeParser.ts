/**
 * Human-friendly expiration-time parser for the dApp's scheduled-tx UI.
 *
 * TypeScript port of `cli/utils/timeParser.js`. Same accepted formats:
 *   - Duration suffixes: "60s", "30m", "2h", "30d", "8w"
 *   - ISO-8601 timestamps: "2026-06-30T12:00:00Z", "2026-06-30"
 *
 * Returns a JS Date in the future. Enforces the Hedera HIP-423 max
 * expiration horizon (~62 days) when used for scheduled-transaction
 * expiration times — pass `{ enforceScheduleHorizon: false }` to skip.
 *
 * Kept in lockstep with the CLI's parser so a coordinator can copy
 * an expiration string between `hedera-multisig schedule create`
 * and the dApp without surprise.
 */

// HIP-423 cap: scheduling.maxExpirationFutureSeconds = 5,356,800 (62 days)
export const MAX_SCHEDULE_DURATION_SECONDS = 5_356_800;

const DURATION_PATTERN = /^(\d+)([smhdw])$/i;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

export interface ParseOptions {
  enforceScheduleHorizon?: boolean;
}

export function parseExpirationTime(
  input: string | null | undefined,
  options: ParseOptions = {},
): Date | null {
  if (input === null || input === undefined || input === '') return null;

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
    if (enforceHorizon) validateScheduleHorizon(date, trimmed);
    return date;
  }

  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime())) {
    if (isoDate.getTime() <= Date.now()) {
      throw new Error(`expiration-time "${trimmed}" is in the past.`);
    }
    if (enforceHorizon) validateScheduleHorizon(isoDate, trimmed);
    return isoDate;
  }

  throw new Error(
    `Invalid expiration-time: "${trimmed}". ` +
      'Use a duration suffix like "30d" / "2h" / "60s" / "8w", ' +
      'or an ISO-8601 timestamp like "2026-06-30T12:00:00Z".',
  );
}

function validateScheduleHorizon(date: Date, original: string): void {
  const futureSeconds = (date.getTime() - Date.now()) / 1000;
  if (futureSeconds > MAX_SCHEDULE_DURATION_SECONDS) {
    const days = Math.ceil(futureSeconds / 86_400);
    throw new Error(
      `Expiration "${original}" is ${days} days in the future, which exceeds the ` +
        'Hedera HIP-423 limit of ~62 days ' +
        `(scheduling.maxExpirationFutureSeconds = ${MAX_SCHEDULE_DURATION_SECONDS}s).`,
    );
  }
}

/**
 * Format a Date as a relative duration string ("in 23h 45m", "in 8d 3h").
 * Used by the schedule expiration banner on /create + /session/[id].
 * Returns "expired" if the date is in the past.
 */
export function formatRelativeFuture(date: Date | number): string {
  const target = typeof date === 'number' ? date : date.getTime();
  const ms = target - Date.now();
  if (ms <= 0) return 'expired';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days >= 1) return `in ${days}d ${hours}h`;
  if (hours >= 1) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}
