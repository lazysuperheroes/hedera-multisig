'use client';

interface Step {
  key: string;
  label: string;
}

interface StepProgressProps {
  steps: Step[];
  currentIndex: number;
}

export function StepProgress({ steps, currentIndex }: StepProgressProps) {
  return (
    <nav aria-label="Progress" className="step-progress mb-8">
      <ol className="step-progress-list flex items-center">
        {steps.map((s, i) => {
          const isActive = i === currentIndex;
          const isDone = i < currentIndex;

          return (
            <li key={s.key} className="step-progress-item flex items-center flex-1 last:flex-none">
              {/* Step marker + label */}
              <div className="step-progress-marker-wrap flex flex-col items-center min-w-[56px] sm:min-w-[64px]">
                <div
                  className={`step-progress-marker w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                    isDone
                      ? 'bg-success text-white'
                      : isActive
                      ? 'bg-accent text-white ring-4 ring-blue-100 dark:ring-blue-900/50'
                      : 'bg-surface-recessed text-foreground-subtle'
                  }`}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isDone ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <div className={`step-progress-label text-xs sm:text-sm mt-1.5 text-center font-medium transition-colors duration-300 ${
                  isActive
                    ? 'text-accent'
                    : isDone
                    ? 'text-success'
                    : 'text-foreground-subtle'
                }`}>
                  {s.label}
                </div>
              </div>

              {/* Connector */}
              {i < steps.length - 1 && (
                <div className="step-progress-rail flex-1 h-1.5 rounded-full bg-surface-recessed min-w-[16px] sm:min-w-[24px] mx-1 overflow-hidden self-start mt-5">
                  <div className={`step-progress-rail-fill h-full rounded-full transition-all duration-500 ${isDone ? 'bg-success w-full' : 'w-0'}`} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
