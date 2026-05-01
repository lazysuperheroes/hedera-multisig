import { useState, useCallback } from 'react';
import { DEFAULT_NETWORK } from '../lib/walletconnect-config';
import { saveTxHistoryEntry } from './useTxHistory';

type TransactionType =
  | 'hbar-transfer'
  | 'token-transfer'
  | 'nft-transfer'
  | 'token-association'
  | 'contract-call';

interface InjectParams {
  txType: TransactionType;
  txFields: Record<string, string>;
  walletAccountId: string;
  sessionId?: string;
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
  injectFrozenBase64: (base64: string, options?: { sessionId?: string; label?: string }) => Promise<void>;
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
    const { txType, txFields, walletAccountId, sessionId } = params;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setInjectError('WebSocket is not connected.');
      return;
    }

    if (!walletAccountId) {
      setInjectError('Connect your wallet first. The operator account pays fees.');
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
      const operatorId = AccountId.fromString(walletAccountId);

      // Build the appropriate transaction
      let tx: InstanceType<typeof TransferTransaction> |
              InstanceType<typeof TokenAssociateTransaction> |
              InstanceType<typeof ContractExecuteTransaction>;

      switch (txType) {
        case 'hbar-transfer': {
          const from = txFields.from || walletAccountId;
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
          const from = txFields.from || walletAccountId;
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
          const from = txFields.from || walletAccountId;
          const to = txFields.to;
          if (!tokenId) throw new Error('Token ID is required.');
          if (!to) throw new Error('Recipient account is required.');
          if (serial <= 0) throw new Error('Serial number is required.');
          const nftId = new NftId(TokenId.fromString(tokenId), serial);
          tx = new TransferTransaction().addNftTransfer(nftId, AccountId.fromString(from), AccountId.fromString(to));
          break;
        }

        case 'token-association': {
          const account = txFields.account || walletAccountId;
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
        ws.send(JSON.stringify({
          type: 'TRANSACTION_INJECT',
          payload: { frozenTransaction: frozenBase64 },
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
        details: { ...txFields, transactionType: txType },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      setInjectError(message);
      throw err; // Re-throw so caller can handle toast
    } finally {
      setIsInjecting(false);
    }
  }, [wsRef]);

  const injectFrozenBase64 = useCallback(async (base64: string, options?: { sessionId?: string; label?: string }) => {
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
        ws.send(JSON.stringify({
          type: 'TRANSACTION_INJECT',
          payload: { frozenTransaction: trimmed },
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

  return { isInjecting, injectError, injectionDone, inject, injectFrozenBase64 };
}
