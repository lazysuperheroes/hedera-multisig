/**
 * Toast Component
 *
 * Toast notification system for user feedback.
 * Shows success, error, info, and warning messages.
 */

'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

function Toast({ toast, onClose }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const duration = toast.duration || 5000;
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onClose(toast.id), 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onClose]);

  const colors = {
    success: 'bg-success-soft border-success text-success-soft-fg',
    error: 'bg-destructive-soft border-destructive text-destructive-soft-fg',
    info: 'bg-info-soft border-info text-info-soft-fg',
    warning: 'bg-warning-soft border-warning text-warning-soft-fg',
  };

  // Icon glyphs from the canonical Material Symbols set, replacing
  // four hand-rolled SVG paths. Filled variant = bolder semantic
  // weight on small notification surface.
  const icons = {
    success: <Icon name="check_circle" size={20} fill={1} aria-hidden />,
    error: <Icon name="error" size={20} fill={1} aria-hidden />,
    info: <Icon name="info" size={20} fill={1} aria-hidden />,
    warning: <Icon name="warning" size={20} fill={1} aria-hidden />,
  };

  return (
    <div
      role="alert"
      className={`${colors[toast.type]} border-l-4 rounded-md shadow-lg p-4 mb-3 transition-[opacity,transform] duration-300 ${
        isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'
      }`}
    >
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">{icons[toast.type]}</div>
        <div className="flex-1">
          <h4 className="font-semibold text-sm">{toast.title}</h4>
          {toast.message && <p className="text-sm mt-1 opacity-90">{toast.message}</p>}
        </div>
        <button
          onClick={() => {
            setIsExiting(true);
            setTimeout(() => onClose(toast.id), 300);
          }}
          aria-label="Dismiss"
          className="flex-shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity"
        >
          <Icon name="close" size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function ToastContainer({ toasts, onClose }: { toasts: ToastMessage[]; onClose: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm w-full" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}

export default Toast;
