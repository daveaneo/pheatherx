'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/uiStore';

const variantStyles = {
  default: 'bg-carbon-gray border-carbon-gray/50',
  success: 'bg-electric-teal/10 border-electric-teal/30 text-electric-teal',
  error: 'bg-deep-magenta/10 border-deep-magenta/30 text-deep-magenta',
  warning: 'bg-feather-gold/10 border-feather-gold/30 text-feather-gold',
};

const variantIcons = {
  default: null,
  success: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
};

export function ToastContainer() {
  const toasts = useUiStore(state => state.toasts);
  const removeToast = useUiStore(state => state.removeToast);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={cn(
            'flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg animate-slide-up min-w-[300px] max-w-[400px]',
            variantStyles[toast.variant]
          )}
        >
          {variantIcons[toast.variant] && (
            <div className="flex-shrink-0 mt-0.5">{variantIcons[toast.variant]}</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium">{toast.title}</p>
            {toast.description && (
              <p className="text-sm opacity-80 mt-1">{toast.description}</p>
            )}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 text-feather-white/60 hover:text-feather-white"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
