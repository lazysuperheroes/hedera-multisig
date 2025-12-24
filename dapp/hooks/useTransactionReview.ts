/**
 * useTransactionReview Hook
 *
 * React hook for transaction decoding and metadata validation.
 * Wraps TransactionDecoder for easy use in React components.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  TransactionDecoder,
  DecodedTransaction,
  MetadataValidation,
  ExtractedAmount,
} from '../lib/transaction-decoder';

export interface UseTransactionReviewOptions {
  frozenTransactionBase64: string;
  metadata?: Record<string, any>;
  contractInterface?: any; // ethers Interface
}

export interface TransactionReviewState {
  decoded: DecodedTransaction | null;
  validation: MetadataValidation | null;
  amounts: ExtractedAmount[];
  accounts: string[];
  loading: boolean;
  error: string | null;
}

export function useTransactionReview(options: UseTransactionReviewOptions | null) {
  const [state, setState] = useState<TransactionReviewState>({
    decoded: null,
    validation: null,
    amounts: [],
    accounts: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!options) {
      setState({
        decoded: null,
        validation: null,
        amounts: [],
        accounts: [],
        loading: false,
        error: null,
      });
      return;
    }

    async function decodeTransaction() {
      // Capture options in closure to satisfy TypeScript
      if (!options) return;

      const { frozenTransactionBase64, metadata, contractInterface } = options;

      try {
        setState((prev) => ({ ...prev, loading: true, error: null }));

        // Decode transaction
        const decoded = await TransactionDecoder.decode(
          frozenTransactionBase64,
          contractInterface
        );

        // Extract amounts and accounts
        const amounts = TransactionDecoder.extractAmounts(decoded.details);
        const accounts = TransactionDecoder.extractAccounts(decoded.details);

        // Validate metadata if provided
        let validation: MetadataValidation | null = null;
        if (metadata) {
          validation = TransactionDecoder.validateMetadata(decoded.details, metadata);
        }

        setState({
          decoded,
          validation,
          amounts,
          accounts,
          loading: false,
          error: null,
        });
      } catch (error) {
        console.error('Failed to decode transaction:', error);
        setState((prev) => ({
          ...prev,
          loading: false,
          error: (error as Error).message,
        }));
      }
    }

    decodeTransaction();
  }, [options?.frozenTransactionBase64, options?.metadata, options?.contractInterface]);

  const refresh = useCallback(() => {
    if (!options) return;

    // Re-run decode by toggling loading
    setState((prev) => ({ ...prev, loading: true }));
  }, [options]);

  return {
    state,
    refresh,
  };
}

export default useTransactionReview;
