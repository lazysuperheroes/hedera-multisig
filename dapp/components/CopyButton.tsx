'use client';

import { useState, useCallback } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'icon' | 'button' | 'inline';
}

export function CopyButton({
  text,
  label,
  className = '',
  size = 'md',
  variant = 'icon',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const buttonSizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  if (variant === 'button') {
    return (
      <button
        onClick={handleCopy}
        className={`inline-flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors ${buttonSizeClasses[size]} ${className}`}
        title={copied ? 'Copied!' : `Copy ${label || 'to clipboard'}`}
      >
        {copied ? (
          <>
            <svg className={sizeClasses[size]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Copied!</span>
          </>
        ) : (
          <>
            <svg className={sizeClasses[size]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>{label || 'Copy'}</span>
          </>
        )}
      </button>
    );
  }

  if (variant === 'inline') {
    return (
      <button
        onClick={handleCopy}
        className={`inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 transition-colors ${className}`}
        title={copied ? 'Copied!' : `Copy ${label || 'to clipboard'}`}
      >
        <span className="font-mono">{text}</span>
        {copied ? (
          <svg className={sizeClasses[size]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className={sizeClasses[size]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    );
  }

  // Default: icon only
  return (
    <button
      onClick={handleCopy}
      className={`p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors ${className}`}
      title={copied ? 'Copied!' : `Copy ${label || 'to clipboard'}`}
    >
      {copied ? (
        <svg className={`${sizeClasses[size]} text-green-600`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className={sizeClasses[size]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

/**
 * Copyable text with inline copy button
 */
export function CopyableText({
  text,
  label,
  truncate = false,
  className = '',
}: {
  text: string;
  label?: string;
  truncate?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const displayText = truncate && text.length > 20
    ? `${text.slice(0, 10)}...${text.slice(-8)}`
    : text;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="font-mono text-sm bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200 transition-colors"
        onClick={handleCopy}
        title={text}
      >
        {displayText}
      </span>
      <button
        onClick={handleCopy}
        className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
        title={copied ? 'Copied!' : `Copy ${label || text}`}
      >
        {copied ? (
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

export default CopyButton;
