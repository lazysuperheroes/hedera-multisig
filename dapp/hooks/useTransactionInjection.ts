import { useState, useCallback } from 'react';
import { DEFAULT_NETWORK } from '../lib/walletconnect-config';
import { resolveFeePayer, type TransactionType } from '../lib/fee-payer';
import { saveTxHistoryEntry } from './useTxHistory';
import {
  selectNodeAccountIds,
  DEFAULT_SUBSET_SIZE,
  type NodeStrategy,
} from '../lib/node-selection';
import { createMirrorHealthClient } from '../lib/mirror-node';

interface NodeSelection {
  strategy?: NodeStrategy;
  subsetSize?: number;
  nodeIds?: string[];
}

interface ScheduleParams {
  /** Duration ("24h", "30d") or ISO-8601 timestamp. Validated upstream. */
  expirationInput: string;
  scheduleMemo?: string;
  payerAccountId?: string;
  /** Public key string (DER or raw hex) for ScheduleCreate's setAdminKey. */
  adminKey?: string;
}

interface InjectParams {
  txType: TransactionType;
  txFields: Record<string, string>;
  walletAccountId: string | null;
  sessionId?: string;
  /**
   * Node-freeze strategy. Default: single-node freeze for wallet
   * compatibility — see shared/node-selection.js for rationale. Bump
   * `subsetSize` for CLI-only ceremonies that don't involve a wallet.
   *
   * Ignored when `scheduled` is set: scheduled transactions don't
   * use a multi-node freeze; the inner transaction body has no
   * nodeAccountIds and the network picks at execution time.
   */
  nodeSelection?: NodeSelection;
  /**
   * When set, the inner tx is built unfrozen, wrapped in a
   * ScheduleCreateTransaction with these options, and the wallet
   * submits the ScheduleCreate to the network. The resulting
   * scheduleId is announced to the WS session via SCHEDULE_ANNOUNCE
   * instead of the realtime TRANSACTION_INJECT.
   */
  scheduled?: ScheduleParams;
}

interface UseTransactionInjectionReturn {
  isInjecting: boolean;
  injectError: string | null;
  injectionDone: boolean;
  inject: (params: InjectParams) => Promise<void>;
  /**
   * Phase D13a: paste-frozen-base64 injection path. The coordinator pastes a
   * pre-frozen `ContractExecuteTransaction` (or any other) produced offline —
   * e.g. by `examples/walkthrough-contract/07-prepare-multisig-increment.js`
   * — and the dApp pushes it through `TRANSACTION_INJECT` without rebuilding.
   * No wallet required.
   */
  injectFrozenBase64: (
    base64: string,
    options?: { sessionId?: string; label?: string; abiJson?: string }
  ) => Promise<void>;
  /** Clear injectionDone / injectError so the next inject starts clean.
   * Used after a coordinator-initiated TRANSACTION_RESET. */
  reset: () => void;
}

const TX_TYPE_LABELS: Record<TransactionType, string> = {
  'hbar-transfer': 'TransferTransaction',
  'token-transfer': 'TransferTransaction',
  'nft-transfer': 'TransferTransaction',
  'token-association': 'TokenAssociateTransaction',
  'contract-call': 'ContractExecuteTransaction',
};

export function useTransactionInjection(
  wsRef: React.MutableRefObject<WebSocket | null>
): UseTransactionInjectionReturn {
  const [isInjecting, setIsInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [injectionDone, setInjectionDone] = useState(false);

  const inject = useCallback(async (params: InjectParams) => {
    const { txType, txFields, walletAccountId, sessionId, nodeSelection, scheduled } = params;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setInjectError('WebSocket is not connected.');
      return;
    }

    // Operator (= fee payer / `TransactionId` account) is resolved by a
    // single shared helper so the build hook and the FeePayerCallout
    // component always agree.
    const resolved = resolveFeePayer(txType, txFields, walletAccountId);
    const operatorAccountStr = resolved.accountId || '';
    if (!operatorAccountStr) {
      setInjectError(
        'No fee payer set. Fill the From / Account / Caller field, connect a ' +
        'wallet, or use the Override option in the Fee payer line.'
      );
      return;
    }

    setIsInjecting(true);
    setInjectError(null);

    try {
      // Dynamically import Hedera SDK
      const {
        Client,
        TransferTransaction,
        TokenAssociateTransaction,
        ContractExecuteTransaction,
        AccountId,
        Hbar,
        TransactionId,
        NftId,
        TokenId,
      } = await import('@hashgraph/sdk');

      const network = DEFAULT_NETWORK;
      const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
      const operatorId = AccountId.fromString(operatorAccountStr);

      // Build the appropriate transaction
      let tx: InstanceType<typeof TransferTransaction> |
              InstanceType<typeof TokenAssociateTransaction> |
              InstanceType<typeof ContractExecuteTransaction>;

      switch (txType) {
        case 'hbar-transfer': {
          const from = txFields.from || operatorAccountStr;
          const to = txFields.to;
          const amount = parseFloat(txFields.amount || '0');
          if (!to) throw new Error('Recipient account is required.');
          if (amount <= 0) throw new Error('Amount must be greater than 0.');
          tx = new TransferTransaction()
            .addHbarTransfer(AccountId.fromString(from), new Hbar(-amount))
            .addHbarTransfer(AccountId.fromString(to), new Hbar(amount));
          break;
        }

        case 'token-transfer': {
          const tokenId = txFields.tokenId;
          const from = txFields.from || operatorAccountStr;
          const to = txFields.to;
          const amount = parseInt(txFields.amount || '0', 10);
          if (!tokenId) throw new Error('Token ID is required.');
          if (!to) throw new Error('Recipient account is required.');
          if (amount <= 0) throw new Error('Amount must be greater than 0.');
          tx = new TransferTransaction()
            .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(from), -amount)
            .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(to), amount);
          break;
        }

        case 'nft-transfer': {
          const tokenId = txFields.tokenId;
          const serial = parseInt(txFields.serial || '0', 10);
          const from = txFields.from || operatorAccountStr;
          const to = txFields.to;
          if (!tokenId) throw new Error('Token ID is required.');
          if (!to) throw new Error('Recipient account is required.');
          if (serial <= 0) throw new Error('Serial number is required.');
          const nftId = new NftId(TokenId.fromString(tokenId), serial);
          tx = new TransferTransaction().addNftTransfer(nftId, AccountId.fromString(from), AccountId.fromString(to));
          break;
        }

        case 'token-association': {
          const account = txFields.account || operatorAccountStr;
          const tokenIds = (txFields.tokenIds || '').split(',').map((t) => t.trim()).filter(Boolean);
          if (tokenIds.length === 0) throw new Error('At least one Token ID is required.');
          tx = new TokenAssociateTransaction()
            .setAccountId(AccountId.fromString(account))
            .setTokenIds(tokenIds.map((tid) => TokenId.fromString(tid)));
          break;
        }

        case 'contract-call': {
          const contractId = txFields.contractId;
          const gas = parseInt(txFields.gas || '100000', 10);
          const fnData = txFields.functionData || '';
          if (!contractId) throw new Error('Contract ID is required.');
          const contractTx = new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(gas);
          if (fnData) {
            contractTx.setFunctionParameters(Buffer.from(fnData.replace(/^0x/, ''), 'hex'));
          }
          tx = contractTx;
          break;
        }

        default:
          throw new Error('Unknown transaction type.');
      }

      // Generate transaction ID BEFORE freezing (multi-sig hash stability)
      tx.setTransactionId(TransactionId.generate(operatorId));

      // ── Scheduled-mode branch (HIP-423) ─────────────────────────────
      // The inner transaction stays UNFROZEN with no nodeAccountIds —
      // those concepts don't apply to a scheduled tx, the network picks
      // a node at execution time. Wrap the inner tx in a
      // ScheduleCreateTransaction, have the connected wallet
      // sign+execute it directly to the network, extract the
      // scheduleId from the receipt, and announce it to the WS session
      // via SCHEDULE_ANNOUNCE so participants can sign asynchronously.
      if (scheduled) {
        const { parseExpirationTime } = await import('../lib/timeParser');
        const expiresAt = parseExpirationTime(scheduled.expirationInput);
        if (!expiresAt) {
          throw new Error('Schedule expiration is required.');
        }

        // Loosely-typed SDK access — the chained-setter shape on
        // ScheduleCreateTransaction trips TS strict-mode through the
        // `import('@hashgraph/sdk')` boundary. We only need the four
        // method names we actually call; everything else is typed as
        // `unknown` and asserted on use.
        type ScheduleTx = {
          setScheduledTransaction: (tx: unknown) => ScheduleTx;
          setExpirationTime: (d: Date) => ScheduleTx;
          setScheduleMemo: (s: string) => ScheduleTx;
          setPayerAccountId: (id: unknown) => ScheduleTx;
          setAdminKey: (k: unknown) => ScheduleTx;
          executeWithSigner: (signer: unknown) => Promise<{
            getReceiptWithSigner: (signer: unknown) => Promise<{ scheduleId: { toString(): string } | null }>;
          }>;
        };
        const sdk = await import('@hashgraph/sdk');
        const sdkAny = sdk as unknown as {
          ScheduleCreateTransaction: new () => ScheduleTx;
          PublicKey: { fromString: (s: string) => unknown };
        };

        const scheduleTx = new sdkAny.ScheduleCreateTransaction();
        scheduleTx.setScheduledTransaction(tx);
        scheduleTx.setExpirationTime(expiresAt);
        if (scheduled.scheduleMemo) {
          scheduleTx.setScheduleMemo(scheduled.scheduleMemo);
        }
        if (scheduled.payerAccountId) {
          scheduleTx.setPayerAccountId(AccountId.fromString(scheduled.payerAccountId));
        }
        if (scheduled.adminKey) {
          try {
            scheduleTx.setAdminKey(sdkAny.PublicKey.fromString(scheduled.adminKey));
          } catch (e) {
            throw new Error(`Invalid admin key: ${(e as Error).message}`);
          }
        }

        // Have the connected wallet sign + execute the
        // ScheduleCreate. The wallet pays this fee — separate from
        // the inner tx's fee, which is paid by `payerAccountId` (or
        // the threshold account by default) at execution time.
        const { getDAppConnector } = await import('../lib/walletconnect');
        const dappConnector = getDAppConnector();
        if (!dappConnector || !dappConnector.signers || dappConnector.signers.length === 0) {
          throw new Error('Wallet not connected — connect HashPack (or another wallet) first.');
        }
        const signer = dappConnector.signers[0] as unknown;

        const response = await scheduleTx.executeWithSigner(signer);
        const receipt = await response.getReceiptWithSigner(signer);
        const scheduleId = receipt.scheduleId?.toString();
        if (!scheduleId) {
          throw new Error('ScheduleCreate succeeded but no scheduleId in receipt — re-run.');
        }

        // Pre-decode the inner tx fields so participants can review
        // without re-fetching from the network. Same shape as the
        // realtime path's metadata/abi handling.
        const innerTxDetails: Record<string, unknown> = {
          type: TX_TYPE_LABELS[txType] || txType,
          ...txFields,
        };
        let innerAbi: unknown[] | null = null;
        if (txType === 'contract-call' && txFields.abiJson) {
          try {
            const parsed = JSON.parse(txFields.abiJson);
            if (Array.isArray(parsed)) innerAbi = parsed;
          } catch {
            // Skip; user already saw the form-level ABI error.
          }
        }

        // Announce to the WS session. Server promotes session.mode to
        // 'scheduled' and broadcasts SCHEDULE_CREATED to participants.
        await new Promise<void>((resolve, reject) => {
          const ws = wsRef.current!;
          const timeout = setTimeout(() => {
            reject(new Error('Schedule announcement timed out.'));
          }, 15000);

          const handler = (event: MessageEvent) => {
            try {
              const msg = JSON.parse(event.data as string);
              if (msg.type === 'SCHEDULE_CREATED') {
                clearTimeout(timeout);
                ws.removeEventListener('message', handler);
                resolve();
              } else if (msg.type === 'INJECTION_FAILED' || msg.type === 'ERROR') {
                clearTimeout(timeout);
                ws.removeEventListener('message', handler);
                reject(new Error(msg.payload?.message || 'Schedule announcement failed.'));
              }
            } catch { /* ignore */ }
          };
          ws.addEventListener('message', handler);

          ws.send(JSON.stringify({
            type: 'SCHEDULE_ANNOUNCE',
            payload: {
              scheduleId,
              expirationTime: Math.floor(expiresAt.getTime() / 1000),
              scheduleMemo: scheduled.scheduleMemo || null,
              payerAccountId: scheduled.payerAccountId || null,
              adminKey: scheduled.adminKey || null,
              innerTxDetails,
              innerTxBase64: null, // future: serialize the inner-tx body for signature-side decoding
              ...(innerAbi ? { abi: innerAbi } : {}),
            },
          }));
        });

        setInjectionDone(true);
        saveTxHistoryEntry({
          timestamp: new Date().toISOString(),
          transactionId: scheduleId,
          transactionType: `Scheduled${TX_TYPE_LABELS[txType] || txType}`,
          status: 'PENDING',
          network: DEFAULT_NETWORK,
          sessionId: sessionId || undefined,
          details: {
            ...txFields,
            transactionType: txType,
            scheduled: true,
            scheduleId,
            expirationTime: expiresAt.toISOString(),
          },
        });
        return; // Skip the realtime freeze/inject path below.
      }

      // ── Realtime branch (default) ───────────────────────────────────
      // Multi-node freeze (canonical Hedera multi-sig pattern). Each
      // SignedTransaction body carries a distinct nodeAccountID, so
      // signers produce one ED25519 signature per body and the
      // executor can submit to any of the targeted nodes.
      //
      // Default = random subset of 6: 1−p^6 ≈ 1−10⁻⁸ availability for
      // p=0.01 per-node downtime, comfortably under the 6 KB tx-size
      // cap (5-of-9 multi-sig × subset 6 ≈ 4 KB; full 30+ mainnet
      // freeze would blow past 22 KB and never submit).
      //
      // The audit trail (SessionMonitor) records "Frozen against N
      // nodes [strategy]" so coordinators can verify the choice.
      const strategy: NodeStrategy = nodeSelection?.strategy || 'subset';
      const subsetSize = nodeSelection?.subsetSize ?? DEFAULT_SUBSET_SIZE;
      const nodeIds = nodeSelection?.nodeIds;
      // Pass a `mirrorClient` so node selection promotes the healthiest
      // candidate to index 0. Critical for the wallet-signer fallback
      // path: HashPack only signs body[0] of a multi-node freeze, the
      // server downgrades to single-node submission against that body,
      // and the body's nodeAccountId needs to be alive. When mirror is
      // unreachable, `selectNodeAccountIds` silently degrades to its
      // pre-existing shuffle behaviour (still better than always [0]).
      const mirrorClient = createMirrorHealthClient(DEFAULT_NETWORK);
      const selectedNodes = await selectNodeAccountIds(client, {
        strategy,
        subsetSize,
        nodeIds,
        mirrorClient,
      });
      // SDK typing for setNodeAccountIds expects AccountId[]; cast via
      // unknown[] avoids structural-equality mismatches when the dynamic
      // import returns a slightly different AccountId class identity
      // than the one TypeScript inferred at parse time.
      (tx as unknown as { setNodeAccountIds(ids: unknown[]): unknown })
        .setNodeAccountIds(selectedNodes as unknown[]);

      // Freeze the transaction
      const frozenTx = await tx.freezeWith(client);
      const frozenBytes = frozenTx.toBytes();
      const frozenBase64 =
        typeof Buffer !== 'undefined'
          ? Buffer.from(frozenBytes).toString('base64')
          : btoa(String.fromCharCode(...frozenBytes));

      // Send TRANSACTION_INJECT via WebSocket
      await new Promise<void>((resolve, reject) => {
        const ws = wsRef.current!;
        const timeout = setTimeout(() => {
          reject(new Error('Transaction injection timed out.'));
        }, 15000);

        const handler = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === 'TRANSACTION_RECEIVED') {
              clearTimeout(timeout);
              ws.removeEventListener('message', handler);
              resolve();
            } else if (msg.type === 'INJECTION_FAILED' || msg.type === 'ERROR') {
              clearTimeout(timeout);
              ws.removeEventListener('message', handler);
              reject(new Error(msg.payload?.message || 'Injection failed.'));
            }
          } catch {
            // ignore
          }
        };

        ws.addEventListener('message', handler);
        // For contract calls, pass the parsed ABI so participants get the
        // verified function-name display. The server stores it on the
        // session so late-joiners get it too.
        let abiForInject: unknown[] | null = null;
        if (txType === 'contract-call' && txFields.abiJson) {
          try {
            const parsed = JSON.parse(txFields.abiJson);
            if (Array.isArray(parsed)) abiForInject = parsed;
          } catch {
            // Form-level ABI parsing already surfaces errors to the user;
            // injecting without ABI is a graceful fallback.
          }
        }
        // Audit-trail metadata: which strategy was used and how many
        // nodes the freeze targeted. Surfaced in SessionMonitor so a
        // coordinator can prove "yes, this multi-sig was bound to a
        // 6-node subset" after the fact.
        const nodeStrategyMeta = {
          nodeStrategy: strategy,
          nodeCount: selectedNodes.length,
          nodeAccountIds: selectedNodes.map((n) => n.toString()),
        };

        ws.send(JSON.stringify({
          type: 'TRANSACTION_INJECT',
          payload: {
            frozenTransaction: frozenBase64,
            metadata: { customFields: nodeStrategyMeta },
            ...(abiForInject ? { abi: abiForInject } : {}),
          },
        }));
      });

      setInjectionDone(true);

      // Save to local transaction history
      saveTxHistoryEntry({
        timestamp: new Date().toISOString(),
        transactionId: frozenTx.transactionId?.toString() || 'unknown',
        transactionType: TX_TYPE_LABELS[txType] || txType,
        status: 'PENDING',
        network: DEFAULT_NETWORK,
        sessionId: sessionId || undefined,
        details: {
          ...txFields,
          transactionType: txType,
          nodeStrategy: strategy,
          nodeCount: selectedNodes.length,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      setInjectError(message);
      throw err; // Re-throw so caller can handle toast
    } finally {
      setIsInjecting(false);
    }
  }, [wsRef]);

  const injectFrozenBase64 = useCallback(async (
    base64: string,
    options?: { sessionId?: string; label?: string; abiJson?: string }
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setInjectError('WebSocket is not connected.');
      return;
    }
    const trimmed = base64.trim();
    if (!trimmed) {
      setInjectError('Paste the frozen-transaction base64 string before injecting.');
      return;
    }
    // Loose base64 sanity check (length divisible by 4, allowed chars). Server
    // does the real validation on `Transaction.fromBytes()`.
    if (!/^[A-Za-z0-9+/]+=*$/.test(trimmed.replace(/\s+/g, '')) || trimmed.length < 8) {
      setInjectError('That does not look like base64. Expected a long string of letters, digits, +, /, =.');
      return;
    }

    setIsInjecting(true);
    setInjectError(null);

    try {
      // Try to decode the transaction client-side to extract the txId for
      // history. If it fails (older SDK / unknown type), still inject — the
      // server is authoritative.
      let extractedTxId = 'unknown';
      try {
        const { Transaction } = await import('@hashgraph/sdk');
        const decoded = Transaction.fromBytes(Buffer.from(trimmed, 'base64'));
        extractedTxId = decoded.transactionId?.toString() || 'unknown';
      } catch {
        // ignore
      }

      await new Promise<void>((resolve, reject) => {
        const ws = wsRef.current!;
        const timeout = setTimeout(() => reject(new Error('Transaction injection timed out.')), 15000);

        const handler = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === 'TRANSACTION_RECEIVED') {
              clearTimeout(timeout);
              ws.removeEventListener('message', handler);
              resolve();
            } else if (msg.type === 'INJECTION_FAILED' || msg.type === 'ERROR') {
              clearTimeout(timeout);
              ws.removeEventListener('message', handler);
              reject(new Error(msg.payload?.message || 'Injection failed.'));
            }
          } catch { /* ignore */ }
        };

        ws.addEventListener('message', handler);
        // Optional ABI for paste-mode contract calls: the operator may
        // have a Counter.json (or similar) handy from the prep script;
        // passing it lets participants see verified function names.
        let pasteAbi: unknown[] | null = null;
        if (options?.abiJson && options.abiJson.trim()) {
          try {
            const parsed = JSON.parse(options.abiJson);
            if (Array.isArray(parsed)) pasteAbi = parsed;
          } catch {
            // Bad JSON — skip ABI rather than failing the inject.
          }
        }
        ws.send(JSON.stringify({
          type: 'TRANSACTION_INJECT',
          payload: {
            frozenTransaction: trimmed,
            ...(pasteAbi ? { abi: pasteAbi } : {}),
          },
        }));
      });

      setInjectionDone(true);
      saveTxHistoryEntry({
        timestamp: new Date().toISOString(),
        transactionId: extractedTxId,
        transactionType: 'PrebuiltFrozen',
        status: 'PENDING',
        network: DEFAULT_NETWORK,
        sessionId: options?.sessionId,
        details: { source: 'paste-base64', label: options?.label || null },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      setInjectError(message);
      throw err;
    } finally {
      setIsInjecting(false);
    }
  }, [wsRef]);

  const reset = useCallback(() => {
    setIsInjecting(false);
    setInjectError(null);
    setInjectionDone(false);
  }, []);

  return { isInjecting, injectError, injectionDone, inject, injectFrozenBase64, reset };
}
