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
  thresholdMet?: boolean;
}

export function SignatureProgress({
  signaturesCollected,
  signaturesRequired,
  participantsConnected,
  participantsReady,
  thresholdMet = false,
}: SignatureProgressProps) {
  const progress = signaturesRequired > 0 ? (signaturesCollected / signaturesRequired) * 100 : 0;
  const isComplete = thresholdMet || signaturesCollected >= signaturesRequired;

  return (
    <div className="bg-white border-2 border-gray-300 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Signature Collection Progress</h3>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {signaturesCollected} / {signaturesRequired} signatures
          </span>
          <span className="text-sm font-medium text-gray-700">{Math.round(progress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isComplete ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>

      {/* Threshold Status */}
      {isComplete ? (
        <div className="bg-green-50 border-2 border-green-500 rounded p-4 mb-4">
          <div className="flex items-center space-x-3">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <p className="font-semibold text-green-800">Threshold Met!</p>
              <p className="text-sm text-green-700">
                Collected {signaturesCollected} of {signaturesRequired} required signatures
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 border-2 border-blue-300 rounded p-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="animate-pulse">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-blue-800">Collecting Signatures...</p>
              <p className="text-sm text-blue-700">
                Need {signaturesRequired - signaturesCollected} more signature
                {signaturesRequired - signaturesCollected !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Participant Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 rounded p-3">
          <div className="text-xs text-gray-500 mb-1">Participants Connected</div>
          <div className="text-2xl font-bold text-gray-800">{participantsConnected}</div>
        </div>
        <div className="bg-gray-50 rounded p-3">
          <div className="text-xs text-gray-500 mb-1">Participants Ready</div>
          <div className="text-2xl font-bold text-gray-800">{participantsReady}</div>
        </div>
      </div>

      {/* Signature List */}
      {signaturesCollected > 0 && (
        <div className="mt-4">
          <div className="text-xs text-gray-500 mb-2">Signatures Collected:</div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: signaturesCollected }).map((_, index) => (
              <div
                key={index}
                className="flex items-center space-x-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
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
                className="flex items-center space-x-1 px-2 py-1 bg-gray-100 text-gray-400 rounded text-xs"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
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
