'use client';

import { useMemo, useState } from 'react';
import {
  estimateTxSize,
  HEDERA_TX_SIZE_CAP_BYTES,
  type TxSizeStatus,
} from '../../lib/tx-size-estimator';
import { DEFAULT_SUBSET_SIZE, type NodeStrategy } from '../../lib/node-selection';

export interface NodeStrategyValue {
  strategy: NodeStrategy;
  subsetSize: number;
  nodeIds: string;
}

interface FreezeStrategyProps {
  /** Transaction-builder context for the size estimator. */
  txType: string;
  signerCount: number;
  /** Current strategy form state. */
  value: NodeStrategyValue;
  onChange: (next: NodeStrategyValue) => void;
}

/**
 * One-line freeze-strategy summary with disclosure for advanced controls.
 *
 * Phase K (post-critique): replaces the previous two-component split
 * (`TxSizeEstimateBar` + `NodeStrategyAdvanced`) where the estimator
 * sat ABOVE the lever that controlled it — causality ran upward,
 * confusing users.
 *
 * Now: default state is a single hairline-divided line with the
 * strategy summary + size readout. Advanced disclosure reveals the
 * lever inline, so changing it updates the readout in the same panel.
 *
 * Auto-expands when the size estimate hits amber/red so the warning
 * never hides — the operator sees the problem before they click inject.
 */
export function FreezeStrategy({
  txType,
  signerCount,
  value,
  onChange,
}: FreezeStrategyProps) {
  // Estimator reads strategy form to derive the effective node count.
  const effectiveSubsetSize = useMemo(() => {
    if (value.strategy === 'all') return 50; // upper bound; status will reflect reality
    if (value.strategy === 'specific') {
      const ids = value.nodeIds.split(',').map((s) => s.trim()).filter(Boolean);
      return Math.max(1, ids.length);
    }
    return Math.max(1, value.subsetSize);
  }, [value]);

  const estimate = useMemo(
    () =>
      estimateTxSize({
        subsetSize: effectiveSubsetSize,
        signerCount,
        txType,
      }),
    [effectiveSubsetSize, signerCount, txType]
  );

  // Default-open when the estimate is amber/red so the warning is
  // immediately visible. Operator-toggleable from there.
  const [open, setOpen] = useState(estimate.status !== 'green');

  const summary = strategySummary(value);

  return (
    <div className="mt-5 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="freeze-advanced"
        className="w-full flex items-center justify-between gap-3 text-xs text-foreground-muted hover:text-foreground transition-colors py-1 group"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-foreground-subtle">Freeze:</span>
          <span className="text-foreground truncate">{summary}</span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <SizeReadout estimate={estimate} />
          <span aria-hidden className="text-foreground-subtle text-[10px] uppercase tracking-wider opacity-60 group-hover:opacity-100 transition-opacity">
            {open ? 'hide' : 'edit'}
          </span>
        </span>
      </button>

      {estimate.exceedsCap && (
        <p
          role="alert"
          className="mt-2 text-xs text-destructive leading-snug"
        >
          Estimated size <span className="font-mono tabular-nums">{estimate.estimated.toLocaleString()} B</span> exceeds Hedera&apos;s 6 KB cap. Reduce node subset or signer count, or the network will reject the submission.
        </p>
      )}

      {open && (
        <div id="freeze-advanced" className="mt-4 space-y-4">
          <p className="text-[11px] text-foreground-subtle leading-snug">
            Multi-node freeze lets execution rotate to any healthy node if the
            first one is busy. Default is a random subset of {DEFAULT_SUBSET_SIZE} —
            resilient under per-node downtime, well under Hedera&apos;s 6 KB
            tx-size cap. Override only if you have a reason.
          </p>

          <div>
            <label htmlFor="strategy-select" className={advancedLabelClass}>
              Strategy
            </label>
            <select
              id="strategy-select"
              className={advancedInputClass}
              value={value.strategy}
              onChange={(e) =>
                onChange({ ...value, strategy: e.target.value as NodeStrategy })
              }
            >
              <option value="subset">Random subset (recommended)</option>
              <option value="all">All network nodes</option>
              <option value="specific">Specific node IDs</option>
            </select>
          </div>

          {value.strategy === 'subset' && (
            <div>
              <label htmlFor="subset-size" className={advancedLabelClass}>
                Subset size
              </label>
              <input
                id="subset-size"
                type="number"
                min={1}
                max={50}
                step={1}
                className={advancedInputClass}
                value={value.subsetSize}
                onChange={(e) =>
                  onChange({
                    ...value,
                    subsetSize: Math.max(1, parseInt(e.target.value || '1', 10) || 1),
                  })
                }
              />
              <p className="mt-1 text-[11px] text-foreground-subtle">
                Larger = more resilient, but heavier on the wire.
              </p>
            </div>
          )}

          {value.strategy === 'specific' && (
            <div>
              <label htmlFor="node-ids" className={advancedLabelClass}>
                Node account IDs (comma-separated)
              </label>
              <input
                id="node-ids"
                type="text"
                placeholder="0.0.3, 0.0.4, 0.0.5"
                className={advancedInputClass + ' font-mono'}
                value={value.nodeIds}
                onChange={(e) => onChange({ ...value, nodeIds: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-foreground-subtle">
                Each ID must exist on the active network.
              </p>
            </div>
          )}

          {/* Bigger size readout while the panel is open — shows full
              context (per-node × subset, headroom) so operators have
              the math available when they're tweaking. */}
          <div className="text-[11px] text-foreground-subtle leading-snug bg-surface-recessed rounded-md px-3 py-2 font-mono">
            <div className="flex items-baseline justify-between gap-3">
              <span>per-node body</span>
              <span className="tabular-nums text-foreground">
                {estimate.perNode.toLocaleString()} B
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span>× {effectiveSubsetSize} {effectiveSubsetSize === 1 ? 'node' : 'nodes'}</span>
              <span className="tabular-nums text-foreground">
                = {estimate.estimated.toLocaleString()} B
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border mt-1 pt-1">
              <span>headroom under {HEDERA_TX_SIZE_CAP_BYTES.toLocaleString()} B cap</span>
              <span className={`tabular-nums ${headroomColorClass(estimate.status)}`}>
                {estimate.headroom > 0 ? estimate.headroom.toLocaleString() : '0'} B
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function strategySummary(value: NodeStrategyValue): string {
  if (value.strategy === 'all') return 'all available nodes';
  if (value.strategy === 'specific') {
    const ids = value.nodeIds.split(',').map((s) => s.trim()).filter(Boolean);
    return ids.length > 0
      ? `${ids.length} specific node${ids.length === 1 ? '' : 's'}`
      : 'specific nodes (none yet)';
  }
  return `random subset of ${value.subsetSize}`;
}

function SizeReadout({
  estimate,
}: {
  estimate: ReturnType<typeof estimateTxSize>;
}) {
  // Only color the readout when it matters. Green is silent — operators
  // don't need a green dot every time they click the page.
  const colorClass =
    estimate.status === 'red'
      ? 'text-destructive'
      : estimate.status === 'amber'
      ? 'text-warning'
      : 'text-foreground-subtle';

  return (
    <span className={`text-xs font-mono tabular-nums ${colorClass}`}>
      {estimate.estimated.toLocaleString()} B
    </span>
  );
}

function headroomColorClass(status: TxSizeStatus) {
  if (status === 'red') return 'text-destructive';
  if (status === 'amber') return 'text-warning';
  return 'text-foreground';
}

const advancedLabelClass = 'block text-xs font-medium text-foreground mb-1';
const advancedInputClass =
  'w-full px-3 py-2 rounded-md bg-surface text-foreground placeholder:text-foreground-subtle ' +
  'border border-border focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent text-sm';
