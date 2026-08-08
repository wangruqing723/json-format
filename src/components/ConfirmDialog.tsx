import { useCallback, useEffect, useRef, useState } from 'react';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null;
  onResolve: (confirmed: boolean) => void;
}

export function ConfirmDialog({ request, onResolve }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!request) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [request]);

  if (!request) return null;

  const cancelLabel = request.cancelLabel ?? '取消';
  const confirmLabel = request.confirmLabel ?? '确定';
  const resolve = (confirmed: boolean) => onResolve(confirmed);

  return (
    <div className="dialog-backdrop confirm-backdrop" onMouseDown={() => resolve(false)}>
      <section
        className="confirm-dialog glass-panel-heavy"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            resolve(false);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            resolve(true);
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="confirm-icon"><span aria-hidden="true">!</span></div>
        <div className="confirm-copy">
          <h2 id="confirm-dialog-title">{request.title}</h2>
          <p id="confirm-dialog-message">{request.message}</p>
        </div>
        <div className="confirm-actions">
          <button ref={cancelRef} className="secondary-button" type="button" onClick={() => resolve(false)}>{cancelLabel}</button>
          <button className={request.tone === 'danger' ? 'danger-button' : 'primary-button'} type="button" onClick={() => resolve(true)}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmRequest) => new Promise<boolean>((resolve) => {
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setRequest(next);
  }), []);

  const onResolve = useCallback((confirmed: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolver?.(confirmed);
  }, []);

  return { confirm, dialog: <ConfirmDialog request={request} onResolve={onResolve} /> };
}
