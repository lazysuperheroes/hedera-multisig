'use client';

import { useState, useCallback } from 'react';
import { Icon } from './Icon';

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

  const iconPx = { sm: 16, md: 18, lg: 22 }[size];

  const buttonSizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  if (variant === 'button') {
    return (
      <button
        onClick={handleCopy}
        className={`
          inline-flex items-center gap-1.5 rounded-md
          bg-surface-recessed hover:bg-border text-foreground transition-colors
          ${buttonSizeClasses[size]} ${className}
        `}
        title={copied ? 'Copied!' : `Copy ${label || 'to clipboard'}`}
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={iconPx} />
        <span>{copied ? 'Copied!' : (label || 'Copy')}</span>
      </button>
    );
  }

  if (variant === 'inline') {
    return (
      <button
        onClick={handleCopy}
        className={`inline-flex items-center gap-1 text-accent hover:opacity-80 transition-opacity ${className}`}
        title={copied ? 'Copied!' : `Copy ${label || 'to clipboard'}`}
      >
        <span className="font-mono">{text}</span>
        <Icon name={copied ? 'check' : 'content_copy'} size={iconPx} />
      </button>
    );
  }

  // Default: icon only
  return (
    <button
      onClick={handleCopy}
      className={`
        p-2 rounded-md transition-colors
        ${copied ? 'text-success' : 'text-foreground-subtle hover:text-foreground'}
        hover:bg-surface-recessed
        ${className}
      `}
      title={copied ? 'Copied!' : `Copy ${label || 'to clipboard'}`}
      aria-label={copied ? 'Copied' : `Copy ${label || 'to clipboard'}`}
    >
      <Icon name={copied ? 'check' : 'content_copy'} size={iconPx} />
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

  const displayText =
    truncate && text.length > 20
      ? `${text.slice(0, 10)}…${text.slice(-8)}`
      : text;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="font-mono text-sm bg-surface-recessed px-2 py-1 rounded cursor-pointer hover:bg-border transition-colors"
        onClick={handleCopy}
        title={text}
      >
        {displayText}
      </span>
      <button
        onClick={handleCopy}
        className={`
          p-1 rounded transition-colors
          ${copied ? 'text-success' : 'text-foreground-subtle hover:text-foreground'}
          hover:bg-surface-recessed
        `}
        title={copied ? 'Copied!' : `Copy ${label || text}`}
        aria-label={copied ? 'Copied' : `Copy ${label || text}`}
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={16} />
      </button>
    </div>
  );
}

export default CopyButton;
