/**
 * SignatureProgress Component
 *
 * Flat presentation of signature collection progress. The progress bar
 * is the centerpiece; supporting stats (connected, ready) sit below as
 * a quiet <dl>. Replaces the previous bordered-card-of-nested-cards
 * structure (outer card + status callout card + two stat mini-cards +
 * a pill list of "Signature 1, Signature 2…") with a single flat
 * section.
 *
 * The "who has signed" detail lives in ParticipantList, not here —
 * this component answers "how many" and "are we there yet"; the
 * sibling component answers "who specifically".
 */

'use client';

import { Icon } from './Icon';

export interface SignatureProgressProps {
  signaturesCollected: number;
  signaturesRequired: number;
  participantsConnected: number;
  participantsReady: number;
  /**
   * How many signers the session expects in total. When > 0, the two
   * participant counters render as "X / Y" so users have context (a
   * 2/3 means "1 still expected"; a bare "2" doesn't). Optional for
   * backward compat — falls back to the bare number.
   */
  participantsExpected?: number;
  thresholdMet?: boolean;
}

export function SignatureProgress({
  signaturesCollected,
  signaturesRequired,
  participantsConnected,
  participantsReady,
  participantsExpected,
  thresholdMet = false,
}: SignatureProgressProps) {
  const denom = typeof participantsExpected === 'number' && participantsExpected > 0
    ? participantsExpected
    : null;
  const progress = signaturesRequired > 0 ? (signaturesCollected / signaturesRequired) * 100 : 0;
  const isComplete = thresholdMet || signaturesCollected >= signaturesRequired;
  const remaining = Math.max(0, signaturesRequired - signaturesCollected);

  return (
    <section aria-label="Signature collection progress">
      {/* Title row — eyebrow + counter inline. The counter ("2 of 3 ·
          67%") sits where it can be read at a glance without
          disturbing the heading hierarchy below. */}
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider font-medium text-foreground-muted">
          <span className="treasury-label">Signatures</span>
          <span className="console-label">signatures</span>
        </h3>
        <div className="text-xs font-mono tabular-nums text-foreground-muted">
          <span className="text-foreground font-semibold">{signaturesCollected}</span>
          {' of '}
          <span className="text-foreground font-semibold">{signaturesRequired}</span>
          <span className="text-foreground-subtle"> · {Math.round(progress)}%</span>
        </div>
      </div>

      {/* Progress bar — the visual centerpiece. Slimmer than before
          (h-2 instead of h-4) so it reads as a meter, not a card. */}
      <div
        className="w-full bg-surface-recessed rounded-full h-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={signaturesCollected}
        aria-valuemin={0}
        aria-valuemax={signaturesRequired}
        aria-label={`${signaturesCollected} of ${signaturesRequired} signatures collected`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isComplete ? 'bg-success' : 'bg-info'
          }`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {/* Status line — flat row with Icon + prose. No nested card
          chrome; tone carried by Icon color and copy. */}
      <div className="mt-3 flex items-center gap-2 text-sm">
        {isComplete ? (
          <>
            <Icon name="check_circle" size={18} fill={1} className="text-success flex-shrink-0" />
            <span className="text-foreground">
              <span className="font-semibold">Threshold met.</span>
              <span className="text-foreground-muted"> Collected {signaturesCollected} of {signaturesRequired} required signatures.</span>
            </span>
          </>
        ) : (
          <>
            <Icon name="schedule" size={18} className="text-info flex-shrink-0" />
            <span className="text-foreground-muted">
              Need {remaining} more signature{remaining === 1 ? '' : 's'}.
            </span>
          </>
        )}
      </div>

      {/* Participant counters — quiet inline dl. Two rows; no grid of
          mini-cards. The denominator (expected total) only renders
          when known. */}
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div className="flex items-baseline gap-2">
          <dt className="text-foreground-subtle uppercase tracking-wider">Connected</dt>
          <dd className="font-mono tabular-nums text-foreground">
            {participantsConnected}{denom !== null && <span className="text-foreground-subtle">{' / '}{denom}</span>}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-foreground-subtle uppercase tracking-wider">Ready</dt>
          <dd className="font-mono tabular-nums text-foreground">
            {participantsReady}{denom !== null && <span className="text-foreground-subtle">{' / '}{denom}</span>}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default SignatureProgress;
