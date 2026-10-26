'use client';

// Company Profile – "Other Detail Registration Format" (Form 00001): general information, address,
// contacts, licences, bank accounts, receipt requirements and receipt status.
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Card, Field, Loading, useFetch, useToast } from './ui';
import Icon from './icons';
import { date } from '@/lib/format';

export const PROFILE_SECTIONS = [
  { id: 'general', no: 1, title: 'General Information', short: 'General' },
  { id: 'address', no: 2, title: 'Company Address', short: 'Address' },
  { id: 'contacts', no: 3, title: 'Contact Address', short: 'Contacts' },
  { id: 'licenses', no: 4, title: 'License Detail', short: 'Licenses' },
  { id: 'banks', no: 5, title: 'Bank', short: 'Bank' },
  { id: 'receipts', no: 6, title: 'Receipt Type and Requirement', short: 'Receipt types' },
  { id: 'receipt_status', no: 7, title: 'Receipt Status', short: 'Receipt status' },
];

const pad = (n) => String(n).padStart(2, '0');
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Segmented single choice; clicking the selected option clears it (like an unticked box on the form). */
function Choice({ options, value, onChange, labels = {}, size = '' }) {
  return (
    <div className={`seg ${size}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={value === o}
          className={`seg-opt ${value === o ? 'on' : ''}`}
          onClick={() => onChange(value === o ? '' : o)}
        >
          {labels[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="cp-check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Section({ s, round, rounds, onRound, children, aside, flat, hidden, idPrefix = 'cp' }) {
  if (hidden) return null;
  return (
    <section id={`${idPrefix}-${s.id}`} className={flat ? 'cp-section cp-flat' : 'card cp-section'}>
      <div className="card-head">
        <h2 className="cp-title"><span className="cp-no">{s.no}</span>{s.title}</h2>
        <div className="cp-round">
          <span className="small muted">Round</span>
          <Choice options={rounds} value={round} onChange={onRound} size="seg-sm" />
          {aside}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

/**
 * The seven sections of the registration form. Used for the own company (Settings) and for each
 * supplier / customer (`partyMode`: name and TIN are the company's own fields, passed in `generalTop`).
 * `only` shows a single section (tabbed layout); `flat` drops the card frames (inside a modal).
 */
export function ProfileForm({ value: p, onChange, errors: err = {}, options: opt, canEdit = true, only, flat, partyMode, generalTop, idPrefix = 'cp' }) {
  // Immutable update by path, e.g. set('banks.items.0.branch', 'Bole').
  const set = (path, value) => onChange((prev) => {
    const next = clone(prev);
    const keys = path.split('.');
    let o = next;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)] = value;
    return next;
  });
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), p);
  const e = (path) => err[path];
  const input = (path, props = {}) => (
    <input value={get(path) ?? ''} onChange={(ev) => set(path, ev.target.value)} aria-invalid={!!e(path)} {...props} />
  );
  const roundOf = (id) => ({ round: p[id].round, rounds: opt.rounds, onRound: (v) => set(`${id}.round`, v), hidden: !!only && only !== id });
  const common = { flat, idPrefix };
  const g = p.general;
  const addRow = (id, row) => set(`${id}.items`, [...p[id].items, row]);
  const removeRow = (id, i) => set(`${id}.items`, p[id].items.filter((_, j) => j !== i));

  return (
    <fieldset className="cp-fields" disabled={!canEdit}>
      {/* 1. General information */}
      <Section {...common} s={PROFILE_SECTIONS[0]} {...roundOf('general')}>
        <div className="form-grid">
          {generalTop}
          {!partyMode && <Field label="Company name" required error={e('general.company_name')} className="span-2">{input('general.company_name')}</Field>}
          <Field label="Documentation" hint="Copy of original TIN and VAT required" className="span-2">
            <div className="row cp-inline">
              <Check checked={g.tin_copy} onChange={(v) => set('general.tin_copy', v)}>TIN copy</Check>
              <Check checked={g.vat_copy} onChange={(v) => set('general.vat_copy', v)}>VAT copy</Check>
            </div>
          </Field>
          {!partyMode && <Field label="TIN" hint="Tax Payer Identification Number" error={e('general.tin')}>{input('general.tin', { inputMode: 'numeric' })}</Field>}
          <Field label="TIN issue date" error={e('general.tin_issue_date')}>{input('general.tin_issue_date', { type: 'date' })}</Field>
          <Field label="VAT registered?" className="span-2">
            <Choice options={[true, false]} labels={{ true: 'Yes', false: 'No' }} value={g.vat_registered}
              onChange={(v) => set('general.vat_registered', v === '' ? null : v)} />
          </Field>
          {g.vat_registered !== false && (
            <>
              <Field label="VAT registration number" hint="Value Added Tax" error={e('general.vat_number')}>{input('general.vat_number', { inputMode: 'numeric' })}</Field>
              <Field label="VAT registration date" error={e('general.vat_registration_date')}>{input('general.vat_registration_date', { type: 'date' })}</Field>
            </>
          )}
          <Field label="Tax center address" error={e('general.tax_center')} className="span-2">{input('general.tax_center')}</Field>
          <Field label="Commercial registration number" error={e('general.commercial_reg_no')}>{input('general.commercial_reg_no')}</Field>
          <Field label="Commercial registration date" error={e('general.commercial_reg_date')}>{input('general.commercial_reg_date', { type: 'date' })}</Field>
          <Field label="Number of licenses" error={e('general.license_count')}>{input('general.license_count', { type: 'number', min: 0, step: 1 })}</Field>
          <Field label="First license registration date" error={e('general.first_license_date')}>{input('general.first_license_date', { type: 'date' })}</Field>
          <Field label="Business type" error={e('general.business_type') || e('general.business_type_other')} className="span-4">
            <div className="row">
              <Choice options={opt.business_types} value={g.business_type} onChange={(v) => set('general.business_type', v)}
                labels={{ PLC: 'PLC', SOL: 'Sole proprietor (SOL)', SC: 'Share company (SC)', Other: 'Other' }} />
              {g.business_type === 'Other' && (
                <input className="cp-other" placeholder="Specify business type" value={g.business_type_other}
                  onChange={(ev) => set('general.business_type_other', ev.target.value)} />
              )}
            </div>
          </Field>
        </div>
      </Section>

      {/* 2. Address */}
      <Section {...common} s={PROFILE_SECTIONS[1]} {...roundOf('address')}>
        <div className="form-grid">
          <Field label="Region" error={e('address.region')}>{input('address.region')}</Field>
          <Field label="Zone / Sub-city" error={e('address.zone')}>{input('address.zone')}</Field>
          <Field label="Woreda" error={e('address.woreda')}>{input('address.woreda')}</Field>
          <Field label="House no." error={e('address.house_no')}>{input('address.house_no')}</Field>
          <Field label="Specific location" error={e('address.location')} className="span-4">{input('address.location', { placeholder: 'Building, floor, landmark…' })}</Field>
          <Field label="E-mail" error={e('address.email')} className="span-2">{input('address.email', { type: 'email' })}</Field>
          <Field label="Tel." error={e('address.phone')}>{input('address.phone', { type: 'tel' })}</Field>
          <Field label="Tel. (2)" error={e('address.phone2')}>{input('address.phone2', { type: 'tel' })}</Field>
        </div>
      </Section>

      {/* 3. Contacts */}
      <Section {...common} s={PROFILE_SECTIONS[2]} {...roundOf('contacts')}>
        <div className="cp-contacts">
          {opt.contact_roles.map(({ key, label }) => {
            const base = `contacts.${key}`;
            return (
              <div key={key} className="cp-contact">
                <div className="cp-contact-head">
                  {key === 'other' ? (
                    <>
                      <input className="cp-contact-title" placeholder="Other (role / title)" value={p.contacts.other.title}
                        onChange={(ev) => set('contacts.other.title', ev.target.value)} aria-label="Other contact role" />
                      {e('contacts.other.title') && <div className="cp-err">{e('contacts.other.title')}</div>}
                    </>
                  ) : label}
                </div>
                <div className="form-grid cp-contact-grid">
                  <Field label="Name" error={e(`${base}.name`)} className="span-2">{input(`${base}.name`)}</Field>
                  <Field label="Tel." error={e(`${base}.phone`)}>{input(`${base}.phone`, { type: 'tel' })}</Field>
                  <Field label="Tel. (2)" error={e(`${base}.phone2`)}>{input(`${base}.phone2`, { type: 'tel' })}</Field>
                  <Field label="E-mail" error={e(`${base}.email`)} className="span-2">{input(`${base}.email`, { type: 'email' })}</Field>
                  <Field label="Remark" error={e(`${base}.remark`)} className="span-2">{input(`${base}.remark`)}</Field>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 4. Licences */}
      <Section {...common} s={PROFILE_SECTIONS[3]} {...roundOf('licenses')}
        aside={canEdit && (
          <button type="button" className="btn btn-sm no-print" disabled={p.licenses.items.length >= opt.max_licenses}
            onClick={() => addRow('licenses', { license_no: '', field: '', status: '', registration_date: '' })}>+ Add license</button>
        )}>
        <div className="table-wrap cp-table">
          <table>
            <thead><tr><th style={{ width: 48 }}>No</th><th>Business license no.</th><th>Field of business</th><th>Status</th><th>Registration date</th><th className="no-print" /></tr></thead>
            <tbody>
              {!p.licenses.items.length && <tr><td colSpan={6} className="muted cp-empty">No licenses yet{canEdit ? ' – use “+ Add license”.' : '.'}</td></tr>}
              {p.licenses.items.map((_, i) => {
                const b = `licenses.items.${i}`;
                return (
                  <tr key={i}>
                    <td className="muted">{pad(i + 1)}</td>
                    <td>{input(`${b}.license_no`, { 'aria-label': 'License number' })}{e(`${b}.license_no`) && <div className="cp-err">{e(`${b}.license_no`)}</div>}</td>
                    <td className="cp-wide">{input(`${b}.field`, { 'aria-label': 'Field of business' })}{e(`${b}.field`) && <div className="cp-err">{e(`${b}.field`)}</div>}</td>
                    <td>{input(`${b}.status`, { 'aria-label': 'Status', placeholder: 'e.g. Active, Renewed' })}{e(`${b}.status`) && <div className="cp-err">{e(`${b}.status`)}</div>}</td>
                    <td>{input(`${b}.registration_date`, { type: 'date', 'aria-label': 'Registration date' })}{e(`${b}.registration_date`) && <div className="cp-err">{e(`${b}.registration_date`)}</div>}</td>
                    <td className="no-print">{canEdit && <button type="button" className="icon-btn" aria-label={`Remove license ${i + 1}`} onClick={() => removeRow('licenses', i)}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="cp-extra">
          <div className="cp-extra-title">Additional required documents</div>
          <div className="row cp-inline">
            <Check checked={p.licenses.commercial_certificate} onChange={(v) => set('licenses.commercial_certificate', v)}>Original commercial registration certificate</Check>
            <span className="cp-sep" />
            <span className="small">Business license</span>
            <Field label="# License" error={e('licenses.license_total')}>{input('licenses.license_total', { type: 'number', min: 0, className: 'cp-num' })}</Field>
            <Field label="# Collected" error={e('licenses.license_collected')}>{input('licenses.license_collected', { type: 'number', min: 0, className: 'cp-num' })}</Field>
          </div>
        </div>
      </Section>

      {/* 5. Banks */}
      <Section {...common} s={PROFILE_SECTIONS[4]} {...roundOf('banks')}
        aside={canEdit && (
          <button type="button" className="btn btn-sm no-print" disabled={p.banks.items.length >= opt.max_banks}
            onClick={() => addRow('banks', { bank_name: '', account_number: '', opened: '', closed: '', branch: '' })}>+ Add bank account</button>
        )}>
        <div className="table-wrap cp-table">
          <table>
            <thead><tr><th style={{ width: 48 }}>No</th><th>Bank name</th><th>Account number</th><th>Date opened</th><th>Date closed</th><th>Branch</th><th>Status</th><th className="no-print" /></tr></thead>
            <tbody>
              {!p.banks.items.length && <tr><td colSpan={8} className="muted cp-empty">No bank accounts yet{canEdit ? ' – use “+ Add bank account”.' : '.'}</td></tr>}
              {p.banks.items.map((row, i) => {
                const b = `banks.items.${i}`;
                const cell = (k, props) => (
                  <td>{input(`${b}.${k}`, props)}{e(`${b}.${k}`) && <div className="cp-err">{e(`${b}.${k}`)}</div>}</td>
                );
                return (
                  <tr key={i}>
                    <td className="muted">{pad(i + 1)}</td>
                    {cell('bank_name', { 'aria-label': 'Bank name', placeholder: 'e.g. CBE' })}
                    {cell('account_number', { 'aria-label': 'Account number', inputMode: 'numeric' })}
                    {cell('opened', { type: 'date', 'aria-label': 'Date opened' })}
                    {cell('closed', { type: 'date', 'aria-label': 'Date closed' })}
                    {cell('branch', { 'aria-label': 'Branch' })}
                    <td>{row.bank_name ? <span className={`badge ${row.closed ? '' : 'badge-good'}`}>{row.closed ? 'Closed' : 'Active'}</span> : null}</td>
                    <td className="no-print">{canEdit && <button type="button" className="icon-btn" aria-label={`Remove bank account ${i + 1}`} onClick={() => removeRow('banks', i)}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted cp-note">Leave <b>Date closed</b> empty while the account is active.</p>
      </Section>

      {/* 6. Receipt type & requirement */}
      <Section {...common} s={PROFILE_SECTIONS[5]} {...roundOf('receipts')}>
        <div className="table-wrap cp-table">
          <table>
            <thead><tr><th style={{ width: 48 }}>No</th><th>Receipt type</th><th>Requirement status</th><th>Status</th></tr></thead>
            <tbody>
              {p.receipts.items.map((r, i) => (
                <tr key={r.type} className={[4, 9].includes(i) ? 'cp-group-end' : ''}>
                  <td className="muted">{pad(i + 1)}</td>
                  <td className="cp-wide">{r.type}</td>
                  <td><Choice size="seg-sm" options={opt.choices.requirement} value={r.requirement} onChange={(v) => set(`receipts.items.${i}.requirement`, v)} /></td>
                  <td><Choice size="seg-sm" options={opt.choices.print_status} value={r.print_status} onChange={(v) => set(`receipts.items.${i}.print_status`, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 7. Receipt status */}
      <Section {...common} s={PROFILE_SECTIONS[6]} {...roundOf('receipt_status')}>
        <div className="table-wrap cp-table">
          <table>
            <thead><tr><th style={{ width: 48 }}>No</th><th>Receipt type</th><th>Current using receipt?</th><th>Birhan &amp; Selam collection</th><th>Old receipt void status</th></tr></thead>
            <tbody>
              {p.receipt_status.items.map((r, i) => (
                <tr key={r.type}>
                  <td className="muted">{pad(i + 1)}</td>
                  <td className="cp-wide">{r.type}</td>
                  <td><Choice size="seg-sm" options={opt.choices.current} value={r.current} onChange={(v) => set(`receipt_status.items.${i}.current`, v)} /></td>
                  <td><Choice size="seg-sm" options={opt.choices.collection} value={r.collection} onChange={(v) => set(`receipt_status.items.${i}.collection`, v)} /></td>
                  <td><Choice size="seg-sm" options={opt.choices.old_void} value={r.old_void} onChange={(v) => set(`receipt_status.items.${i}.old_void`, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cp-extra">
          <div className="cp-extra-title">Additional required document – MOR receipt request and application form</div>
          <div className="cp-mor">
            <span className="cp-mor-label">Old receipt</span>
            <Field label="# Ordered" error={e('receipt_status.mor_old_ordered')}>{input('receipt_status.mor_old_ordered', { type: 'number', min: 0, className: 'cp-num' })}</Field>
            <Field label="# Collected" error={e('receipt_status.mor_old_collected')}>{input('receipt_status.mor_old_collected', { type: 'number', min: 0, className: 'cp-num' })}</Field>
            <span className="cp-mor-label">New receipt</span>
            <Field label="# Ordered" error={e('receipt_status.mor_new_ordered')}>{input('receipt_status.mor_new_ordered', { type: 'number', min: 0, className: 'cp-num' })}</Field>
            <Field label="# Collected" error={e('receipt_status.mor_new_collected')}>{input('receipt_status.mor_new_collected', { type: 'number', min: 0, className: 'cp-num' })}</Field>
          </div>
        </div>
      </Section>
    </fieldset>
  );
}

export default function CompanyProfile({ canEdit }) {
  const toast = useToast();
  const { data, error } = useFetch('/company-profile');
  const [p, setP] = useState(null);
  const [saved, setSaved] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const { options, ...profile } = data;
    setP(clone(profile));
    setSaved(JSON.stringify(profile));
  }, [data]);

  const dirty = useMemo(() => p && saved && JSON.stringify(p) !== saved, [p, saved]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!p) return <Loading error={error} />;
  const opt = data.options;


  const save = async () => {
    setBusy(true);
    try {
      const { options, ...profile } = await api.put('/company-profile', p);
      setP(clone(profile));
      setSaved(JSON.stringify(profile));
      setErr({});
      toast('Company profile saved');
    } catch (ex) {
      setErr(ex.fields || {});
      toast(ex.message, 'error');
      const first = Object.keys(ex.fields || {})[0];
      if (first) document.getElementById(`cp-${first.split('.')[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setBusy(false);
    }
  };
  const discard = () => { setP(JSON.parse(saved)); setErr({}); };

  const g = p.general;

  return (
    <div className="cp">
      <div className="card cp-hero">
        <div className="cp-hero-main">
          <span className="cp-hero-icon"><Icon name="suppliers" size={22} /></span>
          <div>
            <div className="small muted">Form 00001 · Company Profile Other Detail Registration Format</div>
            <h2>{g.company_name || 'Company profile'}</h2>
            <div className="small muted">
              {p.updated_at ? `Last saved ${date(p.updated_at.slice(0, 10))}${p.updated_by ? ` by ${p.updated_by}` : ''}` : 'Not saved yet'}
              {!canEdit && ' · View only – an administrator can edit this profile'}
            </div>
          </div>
        </div>
        <div className="row no-print">
          <button className="btn" onClick={() => window.print()}><Icon name="print" size={16} /> Print form</button>
          {canEdit && <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save profile'}</button>}
        </div>
      </div>

      <nav className="cp-nav no-print" aria-label="Profile sections">
        {PROFILE_SECTIONS.map((s) => {
          const bad = Object.keys(err).some((k) => k.startsWith(`${s.id}.`));
          return (
            <button key={s.id} type="button" className={`cp-nav-item ${bad ? 'bad' : ''}`}
              onClick={() => document.getElementById(`cp-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span className="cp-no">{s.no}</span>{s.title}
            </button>
          );
        })}
      </nav>

      <ProfileForm value={p} onChange={setP} errors={err} options={opt} canEdit={canEdit} />

      {canEdit && dirty && (
        <div className="cp-savebar no-print" role="status">
          <span>You have unsaved changes to the company profile.</span>
          <div className="row">
            <button className="btn" onClick={discard} disabled={busy}>Discard</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
