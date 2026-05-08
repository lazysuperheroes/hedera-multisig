/**
 * SignatureProgress Component
 *
 * Displays signature collection progress towards threshold.
 * Shows participant status and completion indicators.
 */

'use client';

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

  return (
    <div className="bg-surface border-2 border-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Signature Collection Progress</h3>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground-muted tabular-nums">
            {signaturesCollected} / {signaturesRequired} signatures
          </span>
          <span className="text-sm font-medium text-foreground-muted tabular-nums">{Math.round(progress)}%</span>
        </div>
        <div
          className="w-full bg-surface-recessed rounded-full h-4 overflow-hidden"
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
      </div>

      {/* Threshold Status */}
      {isComplete ? (
        <div className="bg-success-soft border-2 border-success rounded p-4 mb-4">
          <div className="flex items-center space-x-3">
            <svg className="w-6 h-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <p className="font-semibold text-success-soft-fg">Threshold Met!</p>
              <p className="text-sm text-success-soft-fg">
                Collected {signaturesCollected} of {signaturesRequired} required signatures
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-info-soft border-2 border-info rounded p-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="animate-pulse">
              <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-info-soft-fg">Collecting Signatures...</p>
              <p className="text-sm text-info-soft-fg">
                Need {signaturesRequired - signaturesCollected} more signature
                {signaturesRequired - signaturesCollected !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Participant Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-recessed rounded p-3">
          <div className="text-xs text-foreground-subtle dark:text-foreground-subtle mb-1">Participants Connected</div>
          <div className="text-2xl font-bold text-foreground tabular-nums">
            {participantsConnected}
            {denom !== null && (
              <span className="text-base font-medium text-foreground-muted">
                {' / '}{denom}
              </span>
            )}
          </div>
        </div>
        <div className="bg-surface-recessed rounded p-3">
          <div className="text-xs text-foreground-subtle dark:text-foreground-subtle mb-1">Participants Ready</div>
          <div className="text-2xl font-bold text-foreground tabular-nums">
            {participantsReady}
            {denom !== null && (
              <span className="text-base font-medium text-foreground-muted">
                {' / '}{denom}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Signature List */}
      {signaturesCollected > 0 && (
        <div className="mt-4">
          <div className="text-xs text-foreground-subtle dark:text-foreground-subtle mb-2">Signatures Collected:</div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: signaturesCollected }).map((_, index) => (
              <div
                key={index}
                className="flex items-center space-x-1 px-2 py-1 bg-success-soft text-success-soft-fg rounded text-xs"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Signature {index + 1}</span>
              </div>
            ))}
            {Array.from({ length: signaturesRequired - signaturesCollected }).map((_, index) => (
              <div
                key={`pending-${index}`}
                className="flex items-center space-x-1 px-2 py-1 bg-surface-recessed text-foreground-subtle rounded text-xs"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Pending</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SignatureProgress;
