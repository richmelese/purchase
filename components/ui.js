'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { api } from '@/lib/api';
import Icon from './icons';
import { FY_MONTHS, fiscalYearLabel } from '@/lib/shared/ethiopian';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'info') => {
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
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
export function useFetch(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api.get(url)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
export function PageHeader({ title, subtitle, children }) {
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

/** `fill` stretches the card to the bottom of the window; its table scrolls inside. */
export function Card({ title, actions, children, bodyClass = 'card-body', className = '', fill = false }) {
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

/** KPI tile. `icon` is an Icon name; `accent` one of blue, orange, violet, green, red, teal, amber. */
export function Stat({ label, value, sub, tone, icon, accent = 'blue', href }) {
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

export function Field({ label, required, error, hint, className = '', children }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}{required && <span className="req">*</span>}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/** Password field with a show / hide toggle. Accepts the same props as <input>. */
export function PasswordInput({ className = '', ...rest }) {
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

export function Select({ options, placeholder, value, onChange, ...rest }) {
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

const TONES = {
  good: ['Reported', 'In stock', 'Paid', 'Same month', 'Paid on the month', 'Cash'],
  warn: ['Not Reported', 'Low stock', 'Pending', 'Partially paid', 'Credit'],
  bad: ['Out of stock', 'Penalty risk', 'Different month', 'Overdue', 'Unpaid'],
  info: ['Goods WH', 'Service WH', 'Supplier', 'Customer', 'Both'],
};
export function Badge({ children, tone }) {
  const t = tone || Object.keys(TONES).find((k) => TONES[k].includes(children));
  return <span className={`badge ${t ? `badge-${t}` : ''}`}>{children}</span>;
}

export function Modal({ title, subtitle, icon, onClose, children, footer, width, className = '' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Rendered into <body> so no sticky header, table head or sidebar layer can sit on top of it.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
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

export function Loading({ error }) {
  if (error) return <div className="alert alert-error">{error.message}</div>;
  return <div className="empty">Loading…</div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/** Fiscal-year + optional month filter. */
export function PeriodFilter({ fy, month, onChange, allowAllMonths = true, showMonth = true }) {
  const { data: years } = useFetch('/fiscal-years');
  return (
    <div className="row">
      <select value={fy || ''} onChange={(e) => onChange({ fy: +e.target.value, month })} aria-label="Fiscal year">
        {(years || (fy ? [fy] : [])).map((y) => <option key={y} value={y}>{fiscalYearLabel(y)}</option>)}
      </select>
      {showMonth && (
        <select value={month ?? ''} onChange={(e) => onChange({ fy, month: e.target.value === '' ? '' : +e.target.value })} aria-label="Month">
          {allowAllMonths && <option value="">All months</option>}
          {FY_MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
      )}
    </div>
  );
}

/** Resolves the current fiscal year from the server once. */
export function useCurrentFy() {
  const { data } = useFetch('/settings');
  return data ? data.current_fy : null;
}
