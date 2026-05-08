/**
 * ScheduleOptions — quiet HIP-423 schedule toggle.
 *
 * The project's bread-and-butter is real-time signing ceremonies, so
 * this affordance is intentionally understated:
 *   - Collapsed by default. Live ceremony users never see the body.
 *   - Off by default. Even with the disclosure expanded, the inject
 *     path stays real-time unless the toggle is flipped.
 *   - When ON, three fields fold out: expiration, memo, and an
 *     "advanced" sub-disclosure for admin key + payer override.
 *
 * The expiration parser is shared with `cli/utils/timeParser.js` (via
 * `dapp/lib/timeParser.ts`), so duration strings like "24h" / "30d"
 * round-trip cleanly between CLI and dApp.
 */

'use client';

import { useState } from 'react';
import { parseExpirationTime, formatRelativeFuture } from '../../lib/timeParser';

export interface ScheduleOptionsValue {
  enabled: boolean;
  expirationInput: string;   // raw user input, e.g. "24h" / "2026-06-30T12:00:00Z"
  scheduleMemo: string;
  payerAccountId: string;
  adminKey: string;
}

export const SCHEDULE_OPTIONS_DEFAULT: ScheduleOptionsValue = {
  enabled: false,
  expirationInput: '24h',
  scheduleMemo: '',
  payerAccountId: '',
  adminKey: '',
};

export interface ScheduleOptionsProps {
  value: ScheduleOptionsValue;
  onChange: (v: ScheduleOptionsValue) => void;
}

/**
 * Validate the expiration input. Returns an error string for inline
 * display or null if valid. Does NOT throw — the form should never
 * crash on a typo.
 */
export function validateExpirationInput(input: string): { ok: true; date: Date | null } | { ok: false; error: string } {
  if (!input || !input.trim()) {
    return { ok: true, date: null };
  }
  try {
    const date = parseExpirationTime(input);
    return { ok: true, date };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const labelClass = 'block text-sm font-medium text-foreground mb-2';
const inputClass =
  'w-full px-3 py-2 rounded-md border border-border bg-surface text-foreground ' +
  'placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-accent';

export function ScheduleOptions({ value, onChange }: ScheduleOptionsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = <K extends keyof ScheduleOptionsValue>(k: K, v: ScheduleOptionsValue[K]) =>
    onChange({ ...value, [k]: v });

  const validation = validateExpirationInput(value.expirationInput);
  const previewSuffix =
    validation.ok && validation.date
      ? ` — ${formatRelativeFuture(validation.date)} (${validation.date.toUTCString().replace(/:\d\d GMT/, ' GMT')})`
      : '';

  return (
    <details className="rounded-md border border-border bg-surface-recessed open:bg-surface">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground-muted hover:text-foreground">
        <span className="treasury-label">Schedule for later (HIP-423)</span>
        <span className="console-label">--scheduled</span>
        {value.enabled && (
          <span className="ml-2 inline-flex items-center rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info-soft-fg">
            ON
          </span>
        )}
        <span className="ml-2 text-xs text-foreground-subtle">
          Async multi-sig over hours or days, no 120s window
        </span>
      </summary>

      <div className="px-4 pb-4 pt-1 space-y-4 text-sm">
        <p className="text-xs text-foreground-subtle leading-relaxed">
          For most ceremonies leave this off — the real-time flow is faster
          and cheaper. Use scheduled when signers can&apos;t coordinate live
          (cross-timezone treasury, asynchronous approvals). The transaction
          gets wrapped in a <code className="font-mono">ScheduleCreateTransaction</code>{' '}
          submitted by your wallet; participants sign at their convenience
          via <code className="font-mono">ScheduleSignTransaction</code> and
          Hedera executes it once threshold is met or it expires.
        </p>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <span className="text-sm font-medium text-foreground">
            Schedule this transaction for async signing
          </span>
        </label>

        {value.enabled && (
          <>
            <div>
              <label htmlFor="schedule-expiration" className={labelClass}>
                Expiration <span className="text-destructive">*</span>
                <span className="ml-2 text-xs font-normal text-foreground-subtle">
                  {previewSuffix}
                </span>
              </label>
              <input
                id="schedule-expiration"
                type="text"
                className={inputClass}
                placeholder="24h, 7d, 2026-06-30T12:00:00Z…"
                value={value.expirationInput}
                onChange={(e) => set('expirationInput', e.target.value)}
                aria-invalid={!validation.ok}
                aria-describedby="schedule-expiration-help"
              />
              <p id="schedule-expiration-help" className="mt-1 text-xs text-foreground-subtle">
                Duration suffix (<code>s/m/h/d/w</code>) or ISO-8601. Max ~62 days
                (HIP-423). Default: 24h.
              </p>
              {!validation.ok && (
                <p className="mt-1 text-xs text-destructive-soft-fg">{validation.error}</p>
              )}
            </div>

            <div>
              <label htmlFor="schedule-memo" className={labelClass}>
                Memo <span className="text-xs font-normal text-foreground-subtle">(optional)</span>
              </label>
              <input
                id="schedule-memo"
                type="text"
                className={inputClass}
                placeholder="e.g. Q2 vendor payment, payroll batch 14"
                maxLength={100}
                value={value.scheduleMemo}
                onChange={(e) => set('scheduleMemo', e.target.value)}
              />
              <p className="mt-1 text-xs text-foreground-subtle">
                Visible on HashScan + mirror node. Max 100 chars.
              </p>
            </div>

            <details
              open={showAdvanced}
              onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
              className="rounded-md border border-border bg-surface-recessed"
            >
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground-muted hover:text-foreground">
                Advanced schedule options
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-3">
                <div>
                  <label htmlFor="schedule-payer" className={labelClass}>
                    Payer override
                    <span className="ml-2 text-xs font-normal text-foreground-subtle">
                      (defaults to the threshold account)
                    </span>
                  </label>
                  <input
                    id="schedule-payer"
                    type="text"
                    className={inputClass}
                    placeholder="0.0.xxxxx"
                    value={value.payerAccountId}
                    onChange={(e) => set('payerAccountId', e.target.value)}
                  />
                  <p className="mt-1 text-xs text-foreground-subtle">
                    Pays the inner transaction&apos;s fee at execution time. Your
                    wallet pays the schedule-creation fee separately.
                  </p>
                </div>

                <div>
                  <label htmlFor="schedule-admin" className={labelClass}>
                    Admin key
                    <span className="ml-2 text-xs font-normal text-foreground-subtle">
                      (optional, public key string)
                    </span>
                  </label>
                  <input
                    id="schedule-admin"
                    type="text"
                    className={inputClass}
                    placeholder="302a300506032b6570032100…"
                    value={value.adminKey}
                    onChange={(e) => set('adminKey', e.target.value)}
                  />
                  <p className="mt-1 text-xs text-foreground-subtle">
                    Authorizes deletion of the schedule before it executes. Leave
                    blank if you don&apos;t need this — the schedule will execute
                    or expire on its own.
                  </p>
                </div>
              </div>
            </details>
          </>
        )}
      </div>
    </details>
  );
}
