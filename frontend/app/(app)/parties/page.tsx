'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { PageHeader, Card, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';
import ImportButton from '@/components/ImportButton';
import { ProfileForm, PROFILE_SECTIONS } from '@/components/CompanyProfile';
import { useSession } from '@/components/session';
import { useT } from '@/lib/i18n';
import type { Party } from '@/lib/types';

const BASIC = ['tin', 'name', 'type', 'mrc1', 'mrc2', 'mrc3'] as const;
const blank: Record<(typeof BASIC)[number], string> = { tin: '', name: '', type: 'Supplier', mrc1: '', mrc2: '', mrc3: '' };

/** A party row as listed, with the extra columns the list endpoint adds on top of the base Party fields. */
interface PartyRow extends Party {
  login_username?: string | null;
  login_active?: boolean;
  purchased?: number;
  sold?: number;
  invoice_count?: number;
}

interface TinWarningMatch {
  id: number;
  name: string;
  type: string;
}

interface TinWarning {
  message: string;
  matches: TinWarningMatch[];
}

interface LoginAccount {
  created?: boolean;
  username: string;
  password: string;
}

/** What the save endpoint returns: the saved party, plus an optional duplicate-TIN warning or a freshly issued login. */
interface SavedParty extends Party {
  tin_warning?: TinWarning;
  account?: LoginAccount;
}

/** The party-detail / profile-template response the modal loads: basic fields (when editing) plus the registration profile. */
interface PartyFormData {
  profile: unknown;
  options: unknown;
  [key: string]: unknown;
}

interface PartyModalProps {
  party: Party | null;
  onClose: () => void;
  onSaved: (saved: SavedParty, opts?: { close?: boolean }) => void;
}

// New / edit company: basic register fields plus the Company Profile Other Detail Registration (Form 00001).
function PartyModal({ party, onClose, onSaved }: PartyModalProps) {
  const toast = useToast();
  const { t } = useT();
  const { data, error } = useFetch<PartyFormData>(party ? `/parties/${party.id}` : '/parties/profile-template');
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [profile, setProfile] = useState<unknown>(null);
  const [tab, setTab] = useState('general');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<TinWarning | null>(null);

  useEffect(() => {
    if (!data) return;
    setF(party ? Object.fromEntries(BASIC.map((k) => [k, (data[k] as string | null | undefined) ?? ''])) : { ...blank });
    setProfile(data.profile);
  }, [data, party]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement> | string) => setF({ ...(f as Record<string, string>), [k]: typeof e === 'string' ? e : e.target.value });
  const profileErrors = Object.fromEntries(Object.entries(err).filter(([k]) => k.startsWith('profile.')).map(([k, v]) => [k.slice(8), v]));
  const tabHasError = (id: string) => Object.keys(profileErrors).some((k) => k.startsWith(`${id}.`)) || (id === 'general' && BASIC.some((k) => err[k]));
  const index = PROFILE_SECTIONS.findIndex((s) => s.id === tab);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, profile };
      const saved = party ? await api.put<SavedParty>(`/parties/${party.id}`, body) : await api.post<SavedParty>('/parties', body);
      toast(t('{name} saved', { name: f?.name }));
      if (saved.tin_warning) {
        // Keep the modal open so the warning is actually seen, instead of closing straight away;
        // the list still refreshes now in the background so the saved party shows up underneath.
        setWarning(saved.tin_warning);
        onSaved(saved, { close: false });
      } else {
        onSaved(saved, { close: true });
      }
    } catch (e: any) {
      const fields = e.fields || {};
      setErr({ ...fields, _: e.message });
      // Open the first section (in form order) that has a problem.
      const bad = (id: string) => Object.keys(fields).some((k) => (id === 'general' && !k.startsWith('profile.')) || k.startsWith(`profile.${id}.`));
      const first = PROFILE_SECTIONS.find((s) => bad(s.id));
      if (first) setTab(first.id);
    } finally {
      setBusy(false);
    }
  };

  const basicFields = f && (
    <>
      <Field label={t('Company TIN')} error={err.tin} hint={t('Digits only (normally 10)')}><input value={f.tin} onChange={set('tin')} inputMode="numeric" autoFocus={!party} aria-invalid={!!err.tin} /></Field>
      <Field label={t('Company name')} required error={err.name} className="span-2"><input value={f.name} onChange={set('name')} aria-invalid={!!err.name} /></Field>
      <Field label={t('Type')} error={err.type} hint={t('Supplier, customer or both')}><Select options={['Supplier', 'Customer', 'Both'].map((v) => ({ value: v, label: t(v) }))} value={f.type} onChange={set('type')} /></Field>
      <Field label="MRC-1"><input value={f.mrc1} onChange={set('mrc1')} /></Field>
      <Field label="MRC-2"><input value={f.mrc2} onChange={set('mrc2')} /></Field>
      <Field label="MRC-3"><input value={f.mrc3} onChange={set('mrc3')} /></Field>
      <div className="cp-divider span-4"><span>{t('Registration details')}</span></div>
    </>
  );

  return (
    <Modal
      width={1060}
      className="cp-modal"
      icon="suppliers"
      title={warning ? t('{name} saved', { name: f?.name || party?.name || t('Company') }) : party ? t('Edit {name}', { name: party.name }) : t('New company')}
      subtitle={warning ? t('Please check this before continuing') : t('Company Profile Other Detail Registration · Form 00001')}
      onClose={onClose}
      footer={warning ? (
        <button className="btn btn-primary" onClick={onClose}>{t('Got it')}</button>
      ) : (
        <div className="cp-modal-foot">
          <div className="row">
            <button className="btn btn-ghost" disabled={index <= 0} onClick={() => setTab(PROFILE_SECTIONS[index - 1].id)}>{t('← Previous')}</button>
            <span className="small muted">{t('Step {n} of {total}', { n: index + 1, total: PROFILE_SECTIONS.length })}</span>
            <button className="btn btn-ghost" disabled={index >= PROFILE_SECTIONS.length - 1} onClick={() => setTab(PROFILE_SECTIONS[index + 1].id)}>{t('Next →')}</button>
          </div>
          <div className="row">
            <button className="btn" onClick={onClose}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !f}>{busy ? t('Saving…') : party ? t('Save changes') : t('Create company')}</button>
          </div>
        </div>
      )}
    >
      {warning ? (
        <div className="alert alert-warn" style={{ marginBottom: 0 }}>
          <p style={{ marginTop: 0 }}>{t(warning.message)}</p>
          <ul style={{ marginBottom: 0 }}>
            {warning.matches.map((m) => (
              <li key={m.id}><Link href={`/parties/${m.id}`}>{m.name}</Link> · <Badge tone="info">{t(m.type)}</Badge></li>
            ))}
          </ul>
        </div>
      ) : !f || !profile ? <Loading error={error} /> : (
        <>
          {err._ && <div className="alert alert-error">{err._}</div>}
          <div className="cp-tabs" role="tablist" aria-label={t('Form sections')}>
            {PROFILE_SECTIONS.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={tab === s.id}
                className={`cp-tab ${tab === s.id ? 'on' : ''} ${tabHasError(s.id) ? 'bad' : ''}`} onClick={() => setTab(s.id)}>
                <span className="cp-no">{s.no}</span><span className="cp-tab-label">{t(s.short)}</span>
              </button>
            ))}
          </div>
          <ProfileForm value={profile} onChange={setProfile as (updater: (prev: any) => any) => void} errors={profileErrors} options={(data as PartyFormData).options}
            only={tab} flat partyMode generalTop={basicFields} idPrefix="party" />
        </>
      )}
    </Modal>
  );
}

interface CredentialsModalProps {
  company: string;
  account: LoginAccount;
  onClose: () => void;
}

/** Shows a generated company login once (it cannot be displayed again). */
function CredentialsModal({ company, account, onClose }: CredentialsModalProps) {
  const toast = useToast();
  const { t } = useT();
  const signIn = typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';
  const text = `${company}
${t('Sign in')}: ${signIn}
${t('User name')}: ${account.username}
${t('Password')}: ${account.password}
${t('(You will be asked to choose your own password at first sign-in.)')}`;
  const copy = async (value: string, what: string) => {
    try { await navigator.clipboard.writeText(value); toast(t('{what} copied', { what })); } catch { toast(t('Copy not available – select the text instead'), 'error'); }
  };
  return (
    <Modal width={520} icon="key" title={account.created ? t('Company login created') : t('New password issued')} subtitle={company} onClose={onClose}
      footer={<><button className="btn" onClick={() => copy(text, t('Login details'))}>{t('Copy all')}</button><button className="btn btn-primary" onClick={onClose}>{t('Done')}</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('Give these to the company. They sign in at {url} and only see their own company\'s purchases, sales, statement and profile. At first sign-in they must choose their own password.', { url: signIn })}
      </p>
      <div className="cred">
        <div className="cred-row"><span>{t('User name')}</span><code>{account.username}</code><button className="btn btn-sm" onClick={() => copy(account.username, t('User name'))}>{t('Copy')}</button></div>
        <div className="cred-row"><span>{t('Password')}</span><code>{account.password}</code><button className="btn btn-sm" onClick={() => copy(account.password, t('Password'))}>{t('Copy')}</button></div>
      </div>
      <div className="alert alert-warn" style={{ marginBottom: 0 }}>{t('This password is shown only now. If it is lost, use Reset password to issue a new one.')}</div>
    </Modal>
  );
}

interface CredentialsState {
  company: string;
  account: LoginAccount;
}

export default function PartiesPage() {
  const toast = useToast();
  const { t } = useT();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Party | Record<string, never> | null>(null);
  const [credentials, setCredentials] = useState<CredentialsState | null>(null);
  const { can, canAny, canFor, canCompany } = useSession();
  const { data, error, reload } = useFetch<PartyRow[]>(`/parties?type=${type}&q=${encodeURIComponent(q)}`);

  const issueLogin = async (p: PartyRow) => {
    const msg = p.login_username
      ? t('Issue a new password for {name}? The old password stops working and they are signed out.', { name: p.name })
      : t('Create a login for {name}?', { name: p.name });
    if (!confirm(msg)) return;
    try {
      setCredentials({ company: p.name, account: await api.post<LoginAccount>(`/parties/${p.id}/account`) });
      reload();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const remove = async (p: PartyRow) => {
    if (!confirm(t('Delete {name}?', { name: p.name }))) return;
    try {
      await api.del(`/parties/${p.id}`);
      toast(t('{name} deleted', { name: p.name }));
      reload();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title={t('Customer list')} subtitle={t('Company profile – TIN register used for lookups on purchases and sales')}>
        {can('parties', 'create') && <ImportButton url="/import/parties?type=Supplier" onDone={reload} />}
        {can('parties', 'export') && <a className="btn" href="/api/export/list/parties">{t('Export Excel')}</a>}
        {can('parties', 'create') && <button className="btn btn-primary" onClick={() => setEditing({})}>{t('+ New company')}</button>}
      </PageHeader>
      <Card fill bodyClass="" title={(
        <div className="row">
          <input type="search" placeholder={t('Search name or TIN…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('Type')}>
            <option value="">{t('Suppliers & customers')}</option><option value="Supplier">{t('Suppliers')}</option><option value="Customer">{t('Customers')}</option>
          </select>
        </div>
      )} actions={<span className="small muted">{t('{n} companies', { n: data?.length ?? 0 })}</span>}>
        {!data ? <Loading error={error} /> : !data.length ? <Empty>{t('No companies yet.')}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">{t('No.')}</th><th>{t('Company TIN')}</th><th>{t('Company name')}</th><th>MRC-1</th><th>MRC-2</th><th>MRC-3</th>
                  <th>{t('Type')}</th><th>{t('Phone')}</th><th>{t('Login account')}</th><th className="num">{t('Purchased')}</th><th className="num">{t('Sold')}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.map((p, i) => (
                  <tr key={p.id}>
                    <td className="num muted">{i + 1}</td>
                    <td>{p.tin || <span className="muted">—</span>}</td>
                    <td className="wrap"><Link href={`/parties/${p.id}`}><strong>{p.name}</strong></Link>{p.address || p.email ? <div className="small muted">{[p.address, p.email].filter(Boolean).join(' · ')}</div> : null}</td>
                    <td>{p.mrc1}</td><td>{p.mrc2}</td><td>{p.mrc3}</td>
                    <td><Badge tone="info">{t(p.type)}</Badge></td>
                    <td>{p.phone}</td>
                    <td>{p.login_username
                      ? <span title={p.login_active ? t('Company can sign in') : t('Login deactivated')}><code className="login-name">{p.login_username}</code>{!p.login_active && <Badge tone="bad">{t('Off')}</Badge>}</span>
                      : <span className="muted small">{t('No login')}</span>}</td>
                    <td className="num">{money(p.purchased)}</td>
                    <td className="num">{money(p.sold)}</td>
                    <td className="right">
                      <Link className="btn btn-sm btn-ghost" href={`/parties/${p.id}`}>{t('Statement')}</Link>
                      {canFor('parties', 'edit', p.id) && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>{t('Edit')}</button>}
                      {canAny(['users', 'create'], ['users', 'edit']) && canCompany(p.id, 'edit') && <button className="btn btn-sm btn-ghost" onClick={() => issueLogin(p)}>{p.login_username ? t('Reset password') : t('Create login')}</button>}
                      {canFor('parties', 'delete', p.id) && <button className="btn btn-sm btn-ghost" onClick={() => remove(p)} disabled={!!p.invoice_count && p.invoice_count > 0} title={p.invoice_count ? t('Has transactions') : ''}>{t('Delete')}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="small muted">{t('Import accepts the workbook\'s “Supplier Lists” sheet (Company TIN, Company Name, MRC-1/2/3) or a file exported from here. Existing TINs are updated.')}</p>
      {editing && <PartyModal party={(editing as Party).id ? (editing as Party) : null} onClose={() => setEditing(null)} onSaved={(saved, { close = true } = {}) => {
        reload();
        if (saved?.account) setCredentials({ company: saved.name, account: saved.account });
        if (close) setEditing(null);
      }} />}
      {credentials && <CredentialsModal {...credentials} onClose={() => setCredentials(null)} />}
    </>
  );
}
