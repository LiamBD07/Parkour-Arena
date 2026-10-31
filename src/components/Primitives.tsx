import { useEffect, useRef, type ReactNode } from 'react';
import { X, ChevronRight, Hexagon } from 'lucide-react';
import { ArenaEngine, type EngineOptions } from '../game/engine';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? 'compact' : ''}`}>
      <svg viewBox="0 0 56 44" aria-hidden="true">
        <path d="M2 39 23 4h12L14 39zm24 0L37 20l16 19H39l-4-6-3 6z" fill="currentColor" />
        <path d="M39 4h12l-5 8H34z" fill="currentColor" opacity=".45" />
      </svg>
      {!compact && (
        <span>
          PARKOUR
          <span>
            ARENA<span className="brand-dot">®</span>
          </span>
        </span>
      )}
    </span>
  );
}
export function Credits({ amount, small = false }: { amount: number | string; small?: boolean }) {
  return (
    <span className={`credits ${small ? 'small' : ''}`}>
      <Hexagon size={small ? 14 : 17} strokeWidth={2.4} />
      <span>{typeof amount === 'number' ? amount.toLocaleString() : amount}</span>
    </span>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>
          {title}
          <span className="title-dot">.</span>
        </h1>
      </div>
      {children}
    </div>
  );
}
export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]',
          ) || [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = scroll;
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
      >
        <button className="icon-button modal-close" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
export function Scene({
  options,
  className = '',
  engineRef,
  onError,
}: {
  options: EngineOptions;
  className?: string;
  engineRef?: React.RefObject<ArenaEngine | null>;
  onError?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    let engine: ArenaEngine | undefined;
    try {
      engine = new ArenaEngine(ref.current, options);
      if (engineRef) engineRef.current = engine;
    } catch {
      onError?.();
    }
    return () => {
      engine?.dispose();
      if (engineRef) engineRef.current = null;
    };
    // The caller memoizes options to preserve the WebGL context across UI updates.
  }, [options]);
  return <div className={`scene ${className}`} ref={ref} />;
}
export function ArrowLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="arrow-link" onClick={onClick}>
      {children}
      <ChevronRight size={17} />
    </button>
  );
}
