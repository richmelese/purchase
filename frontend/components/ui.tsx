'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import Icon from './icons';
import { FY_MONTHS, fiscalYearLabel } from '@/lib/shared/ethiopian';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export type ToastType = 'info' | 'error';
export type ToastFn = (message: string, type?: ToastType) => void;

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

const ToastCtx = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback<ToastFn>((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type === 'error' ? 'toast-error' : ''}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = (): ToastFn => useContext(ToastCtx);

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
export function useFetch<T = any>(url: string | null | undefined, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api.get<T>(url)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Like React's setState: accepts a value or an updater `(prev) => next`.
  const setData = useCallback((data: T | ((prev: T | null) => T)) => setState((s) => ({ ...s, data: typeof data === 'function' ? (data as (prev: T | null) => T)(s.data) : data })), []);
  return { ...state, reload, setData };
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  bodyClass?: string;
  className?: string;
  fill?: boolean;
}

/** `fill` stretches the card to the bottom of the window; its table scrolls inside. */
export function Card({ title, actions, children, bodyClass = 'card-body', className = '', fill = false }: CardProps) {
  return (
    <section className={`card ${fill ? 'fill' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={`${bodyClass} ${fill ? 'fill-body' : ''}`}>{children}</div>
    </section>
  );
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'bad' | string;
  icon?: string;
  accent?: string;
  href?: string;
}

/** KPI tile. `icon` is an Icon name; `accent` one of blue, orange, violet, green, red, teal, amber. */
export function Stat({ label, value, sub, tone, icon, accent = 'blue', href }: StatProps) {
  const body = (
    <>
      {icon && <div className="stat-icon"><Icon name={icon} size={20} /></div>}
      <div className="stat-text">
        <div className="stat-label">{label}</div>
        <div className="stat-value" style={tone === 'bad' ? { color: 'var(--bad)' } : tone === 'good' ? { color: 'var(--good)' } : undefined}>{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </>
  );
  const cls = `card stat accent-${accent}`;
  return href
    ? <Link href={href} className={cls} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export interface FieldProps {
  label?: ReactNode;
  required?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Field({ label, required, error, hint, className = '', children }: FieldProps) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}{required && <span className="req">*</span>}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/** Password field with a show / hide toggle. Accepts the same props as <input>. */
export function PasswordInput({ className = '', ...rest }: { className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`password-input ${className}`}>
      <input {...rest} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </div>
  );
}

export type SelectOption = string | number | { value: string | number; label: ReactNode };

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  options: SelectOption[];
  placeholder?: string;
  value?: string | number | null;
  onChange: (value: string) => void;
}

export function Select({ options, placeholder, value, onChange, ...rest }: SelectProps) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

const TONES: Record<string, string[]> = {
  good: ['Reported', 'In stock', 'Paid', 'Same month', 'Paid on the month', 'Cash'],
  warn: ['Not Reported', 'Low stock', 'Pending', 'Partially paid', 'Credit'],
  bad: ['Out of stock', 'Penalty risk', 'Different month', 'Overdue', 'Unpaid'],
  info: ['Goods WH', 'Service WH', 'Supplier', 'Customer', 'Both'],
};
export function Badge({ children, tone }: { children?: ReactNode; tone?: string }) {
  const t = tone || Object.keys(TONES).find((k) => typeof children === 'string' && TONES[k].includes(children));
  return <span className={`badge ${t ? `badge-${t}` : ''}`}>{children}</span>;
}

export interface ModalProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string | number;
  className?: string;
}

export function Modal({ title, subtitle, icon, onClose, children, footer, width, className = '' }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Rendered into <body> so no sticky header, table head or sidebar layer can sit on top of it.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={width ? { width } : undefined}>
        <div className="modal-head">
          <div className="modal-title">
            {icon && <span className="modal-icon"><Icon name={icon} size={20} /></span>}
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Loading({ error }: { error?: ApiError | Error | null }) {
  if (error) return <div className="alert alert-error">{error.message}</div>;
  return <div className="empty">Loading…</div>;
}

export function Empty({ children }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export interface PeriodValue {
  fy: number;
  month: number | '';
}

export interface PeriodFilterProps {
  fy: number | null | undefined;
  month: number | '' | undefined;
  onChange: (next: PeriodValue) => void;
  allowAllMonths?: boolean;
  showMonth?: boolean;
}

/** Fiscal-year + optional month filter. */
export function PeriodFilter({ fy, month, onChange, allowAllMonths = true, showMonth = true }: PeriodFilterProps) {
  const { data: years } = useFetch<number[]>('/fiscal-years');
  return (
    <div className="row">
      <select value={fy || ''} onChange={(e) => onChange({ fy: +e.target.value, month: month ?? '' })} aria-label="Fiscal year">
        {(years || (fy ? [fy] : [])).map((y) => <option key={y} value={y}>{fiscalYearLabel(y)}</option>)}
      </select>
      {showMonth && (
        <select value={month ?? ''} onChange={(e) => onChange({ fy: fy as number, month: e.target.value === '' ? '' : +e.target.value })} aria-label="Month">
          {allowAllMonths && <option value="">All months</option>}
          {FY_MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
      )}
    </div>
  );
}

/** Resolves the current fiscal year from the server once. */
export function useCurrentFy(): number | null {
  const { data } = useFetch<{ current_fy: number }>('/settings');
  return data ? data.current_fy : null;
}
