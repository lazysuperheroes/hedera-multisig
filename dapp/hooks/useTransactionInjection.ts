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

  return { isInjecting, injectError, injectionDone, inject };
}
