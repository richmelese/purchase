'use client';

import { useEffect, useState } from 'react';

// The navy wave is drawn in the card's coordinate system (1000 × 580) and overflows it,
// so the curve runs continuously through the card and the page background at any size.
const WAVE = 'M560,-700 C540,-260 430,-60 470,40 C520,170 640,260 610,420 C590,520 560,600 575,1300 L4000,1300 L4000,-700 Z';

function Decorations() {
  return (
    <svg className="auth-deco" viewBox="0 0 1000 580" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="moon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4b5fd6" stopOpacity=".9" />
          <stop offset="1" stopColor="#1d1d66" stopOpacity=".2" />
        </linearGradient>
        <linearGradient id="crescent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1b5e" stopOpacity=".2" />
          <stop offset="1" stopColor="#14144a" stopOpacity=".95" />
        </linearGradient>
      </defs>
      <path d="M600,72 c18,-34 40,-34 52,-8 s34,26 46,-8" className="stroke thick" />
      <circle cx="760" cy="32" r="26" className="stroke" />
      <path d="M707,92 a36,36 0 0 1 72,4 a36,36 0 0 1 -72,-4 z" fill="url(#moon)" opacity=".7" />
      <path d="M892,128 l12,-26 l14,26 z" className="stroke" />
      <circle cx="680" cy="250" r="9" className="stroke" />
      <path d="M780,226 v40 M760,246 h40" className="stroke" />
      <circle cx="928" cy="266" r="96" className="stroke" />
      <path d="M922,170 a96,96 0 0 1 0,192 c-38,-36 -58,-72 -40,-104 c16,-30 20,-56 40,-88 z" fill="url(#crescent)" />
      <circle cx="932" cy="214" r="10" className="stroke" />
      <path d="M970,372 v26 M957,385 h26" className="stroke" />
      <path d="M736,452 c10,-14 26,-8 18,4 s-14,18 2,22" className="stroke" />
      <circle cx="932" cy="448" r="10" className="stroke" />
      <path d="M738,524 l26,-10 l-8,26 z" className="stroke" />
      <path d="M918,520 v22 M907,531 h22" className="stroke" />
    </svg>
  );
}

export default function AuthShell({ title, children, footer, compact }) {
  const [company, setCompany] = useState('');
  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((d) => setCompany(d.company_name || '')).catch(() => {});
  }, []);
  const year = new Date().getFullYear();

  return (
    <div className={`auth-page${compact ? ' compact' : ''}`}>
      <div className="auth-stage">
        <div className="auth-card-bg" />
        <svg className="auth-wave" viewBox="0 0 1000 580" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="navy" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#2b2b86" />
              <stop offset="1" stopColor="#25226b" />
            </linearGradient>
          </defs>
          <path d={WAVE} fill="url(#navy)" />
        </svg>
        <div className="auth-card-tint" />
        <Decorations />

        <section className="auth-form">
          <div className="auth-brand">{company || ' '}</div>
          <h1 className="auth-title">{title}</h1>
          {children}
          <div className="auth-copy">
            {footer}
            Copyright ©{year} {company || 'Purchase & Sales Management'}. All rights reserved
          </div>
        </section>

      </div>
    </div>
  );
}

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z';
const EYE_OFF = 'M9.9 4.2A9.6 9.6 0 0 1 12 4c6.4 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 8 10 8a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20';

/** Underlined input with an icon; password fields get a show / hide button. */
export function AuthInput({ icon, type, ...props }) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  return (
    <label className="auth-input">
      <span className="auth-icon" aria-hidden="true">{icon}</span>
      <input {...props} type={isPassword && visible ? 'text' : type} />
      {isPassword && (
        <button
          type="button"
          className="auth-eye"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={visible ? EYE_OFF : EYE} />
          </svg>
        </button>
      )}
    </label>
  );
}

export const UserIcon = (
  <svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="4.6" r="3.2" fill="currentColor" /><path d="M1.8 15c.4-3.6 3-5.6 6.2-5.6s5.8 2 6.2 5.6z" fill="currentColor" /></svg>
);
export const KeyIcon = (
  <svg viewBox="0 0 20 12" width="18" height="12"><circle cx="4.5" cy="6" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M7.7 6h11M15 6v3.5M18 6v2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
export const IdIcon = (
  <svg viewBox="0 0 16 16" width="15" height="15"><rect x="1" y="3" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="5.5" cy="7.2" r="1.6" fill="currentColor" /><path d="M3 11c.4-1.4 1.3-2 2.5-2s2.1.6 2.5 2M9.5 6.5h4M9.5 9h3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>
);
