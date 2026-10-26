'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { PageHeader, Card, Badge, Loading, Empty, Field, Select, Modal, useFetch, useToast } from '@/components/ui';
import ImportButton from '@/components/ImportButton';
import { ProfileForm, PROFILE_SECTIONS } from '@/components/CompanyProfile';
import { useSession } from '@/components/session';

const BASIC = ['tin', 'name', 'type', 'mrc1', 'mrc2', 'mrc3'];
const blank = { tin: '', name: '', type: 'Supplier', mrc1: '', mrc2: '', mrc3: '' };

// New / edit company: basic register fields plus the Company Profile Other Detail Registration (Form 00001).
function PartyModal({ party, onClose, onSaved }) {
  const toast = useToast();
  const { data, error } = useFetch(party ? `/parties/${party.id}` : '/parties/profile-template');
  const [f, setF] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('general');
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setF(party ? Object.fromEntries(BASIC.map((k) => [k, data[k] ?? ''])) : blank);
    setProfile(data.profile);
  }, [data, party]);

  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const profileErrors = Object.fromEntries(Object.entries(err).filter(([k]) => k.startsWith('profile.')).map(([k, v]) => [k.slice(8), v]));
  const tabHasError = (id) => Object.keys(profileErrors).some((k) => k.startsWith(`${id}.`)) || (id === 'general' && BASIC.some((k) => err[k]));
  const index = PROFILE_SECTIONS.findIndex((s) => s.id === tab);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, profile };
      const saved = party ? await api.put(`/parties/${party.id}`, body) : await api.post('/parties', body);
      toast(`${f.name} saved`);
      onSaved(saved);
    } catch (e) {
      const fields = e.fields || {};
      setErr({ ...fields, _: e.message });
      // Open the first section (in form order) that has a problem.
      const bad = (id) => Object.keys(fields).some((k) => (id === 'general' && !k.startsWith('profile.')) || k.startsWith(`profile.${id}.`));
      const first = PROFILE_SECTIONS.find((s) => bad(s.id));
      if (first) setTab(first.id);
    } finally {
      setBusy(false);
    }
  };

  const basicFields = f && (
    <>
      <Field label="Company TIN" error={err.tin} hint="Digits only (normally 10)"><input value={f.tin} onChange={set('tin')} inputMode="numeric" autoFocus={!party} aria-invalid={!!err.tin} /></Field>
      <Field label="Company name" required error={err.name} className="span-2"><input value={f.name} onChange={set('name')} aria-invalid={!!err.name} /></Field>
      <Field label="Type" error={err.type} hint="Supplier, customer or both"><Select options={['Supplier', 'Customer', 'Both']} value={f.type} onChange={set('type')} /></Field>
      <Field label="MRC-1"><input value={f.mrc1} onChange={set('mrc1')} /></Field>
      <Field label="MRC-2"><input value={f.mrc2} onChange={set('mrc2')} /></Field>
      <Field label="MRC-3"><input value={f.mrc3} onChange={set('mrc3')} /></Field>
      <div className="cp-divider span-4"><span>Registration details</span></div>
    </>
  );

  return (
    <Modal
      width={1060}
      className="cp-modal"
      icon="suppliers"
      title={party ? `Edit ${party.name}` : 'New company'}
      subtitle="Company Profile Other Detail Registration · Form 00001"
      onClose={onClose}
      footer={(
        <div className="cp-modal-foot">
          <div className="row">
            <button className="btn btn-ghost" disabled={index <= 0} onClick={() => setTab(PROFILE_SECTIONS[index - 1].id)}>← Previous</button>
            <span className="small muted">Step {index + 1} of {PROFILE_SECTIONS.length}</span>
            <button className="btn btn-ghost" disabled={index >= PROFILE_SECTIONS.length - 1} onClick={() => setTab(PROFILE_SECTIONS[index + 1].id)}>Next →</button>
          </div>
          <div className="row">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !f}>{busy ? 'Saving…' : party ? 'Save changes' : 'Create company'}</button>
          </div>
        </div>
      )}
    >
      {!f || !profile ? <Loading error={error} /> : (
        <>
          {err._ && <div className="alert alert-error">{err._}</div>}
          <div className="cp-tabs" role="tablist" aria-label="Form sections">
            {PROFILE_SECTIONS.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={tab === s.id}
                className={`cp-tab ${tab === s.id ? 'on' : ''} ${tabHasError(s.id) ? 'bad' : ''}`} onClick={() => setTab(s.id)}>
                <span className="cp-no">{s.no}</span><span className="cp-tab-label">{s.short}</span>
              </button>
            ))}
          </div>
          <ProfileForm value={profile} onChange={setProfile} errors={profileErrors} options={data.options}
            only={tab} flat partyMode generalTop={basicFields} idPrefix="party" />
        </>
      )}
    </Modal>
  );
}

/** Shows a generated company login once (it cannot be displayed again). */
function CredentialsModal({ company, account, onClose }) {
  const toast = useToast();
  const signIn = typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';
  const text = `${company}
Sign in: ${signIn}
User name: ${account.username}
Password: ${account.password}
(You will be asked to choose your own password at first sign-in.)`;
  const copy = async (value, what) => {
    try { await navigator.clipboard.writeText(value); toast(`${what} copied`); } catch { toast('Copy not available – select the text instead', 'error'); }
  };
  return (
    <Modal width={520} icon="key" title={account.created ? 'Company login created' : 'New password issued'} subtitle={company} onClose={onClose}
      footer={<><button className="btn" onClick={() => copy(text, 'Login details')}>Copy all</button><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Give these to the company. They sign in at <b>{signIn}</b> and only see their own company&apos;s purchases, sales,
        statement and profile. At first sign-in they must choose their own password.
      </p>
      <div className="cred">
        <div className="cred-row"><span>User name</span><code>{account.username}</code><button className="btn btn-sm" onClick={() => copy(account.username, 'User name')}>Copy</button></div>
        <div className="cred-row"><span>Password</span><code>{account.password}</code><button className="btn btn-sm" onClick={() => copy(account.password, 'Password')}>Copy</button></div>
      </div>
      <div className="alert alert-warn" style={{ marginBottom: 0 }}>This password is shown only now. If it is lost, use <b>Reset password</b> to issue a new one.</div>
    </Modal>
  );
}

export default function PartiesPage() {
  const toast = useToast();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const { can, canAny, canFor, canCompany } = useSession();
  const issueLogin = async (p) => {
    const msg = p.login_username
      ? `Issue a new password for ${p.name}? The old password stops working and they are signed out.`
      : `Create a login for ${p.name}?`;
    if (!confirm(msg)) return;
    try {
      setCredentials({ company: p.name, account: await api.post(`/parties/${p.id}/account`) });
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const { data, error, reload } = useFetch(`/parties?type=${type}&q=${encodeURIComponent(q)}`);

  const remove = async (p) => {
    if (!confirm(`Delete ${p.name}?`)) return;
    try {
      await api.del(`/parties/${p.id}`);
      toast(`${p.name} deleted`);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Supplier list" subtitle="Company profile – TIN register used for lookups on purchases and sales">
        {can('parties', 'create') && <ImportButton url="/import/parties?type=Supplier" onDone={reload} />}
        {can('parties', 'export') && <a className="btn" href="/api/export/list/parties">Export Excel</a>}
        {can('parties', 'create') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ New company</button>}
      </PageHeader>
      <Card fill bodyClass="" title={(
        <div className="row">
          <input type="search" placeholder="Search name or TIN…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">Suppliers & customers</option><option value="Supplier">Suppliers</option><option value="Customer">Customers</option>
          </select>
        </div>
      )} actions={<span className="small muted">{data?.length ?? 0} companies</span>}>
        {!data ? <Loading error={error} /> : !data.length ? <Empty>No companies yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">No</th><th>Company TIN</th><th>Company name</th><th>MRC-1</th><th>MRC-2</th><th>MRC-3</th>
                  <th>Type</th><th>Phone</th><th>Login</th><th className="num">Purchased</th><th className="num">Sold</th><th />
                </tr>
              </thead>
              <tbody>
                {data.map((p, i) => (
                  <tr key={p.id}>
                    <td className="num muted">{i + 1}</td>
                    <td>{p.tin || <span className="muted">—</span>}</td>
                    <td className="wrap"><Link href={`/parties/${p.id}`}><strong>{p.name}</strong></Link>{p.address || p.email ? <div className="small muted">{[p.address, p.email].filter(Boolean).join(' · ')}</div> : null}</td>
                    <td>{p.mrc1}</td><td>{p.mrc2}</td><td>{p.mrc3}</td>
                    <td><Badge>{p.type}</Badge></td>
                    <td>{p.phone}</td>
                    <td>{p.login_username
                      ? <span title={p.login_active ? 'Company can sign in' : 'Login deactivated'}><code className="login-name">{p.login_username}</code>{!p.login_active && <Badge tone="bad">Off</Badge>}</span>
                      : <span className="muted small">No login</span>}</td>
                    <td className="num">{money(p.purchased)}</td>
                    <td className="num">{money(p.sold)}</td>
                    <td className="right">
                      <Link className="btn btn-sm btn-ghost" href={`/parties/${p.id}`}>Statement</Link>
                      {canFor('parties', 'edit', p.id) && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>Edit</button>}
                      {canAny(['users', 'create'], ['users', 'edit']) && canCompany(p.id, 'edit') && <button className="btn btn-sm btn-ghost" onClick={() => issueLogin(p)}>{p.login_username ? 'Reset password' : 'Create login'}</button>}
                      {canFor('parties', 'delete', p.id) && <button className="btn btn-sm btn-ghost" onClick={() => remove(p)} disabled={p.invoice_count > 0} title={p.invoice_count ? 'Has transactions' : ''}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="small muted">Import accepts the workbook&apos;s “Supplier Lists” sheet (Company TIN, Company Name, MRC-1/2/3) or a file exported from here. Existing TINs are updated.</p>
      {editing && <PartyModal party={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={(saved) => {
        setEditing(null);
        reload();
        if (saved?.account) setCredentials({ company: saved.name, account: saved.account });
      }} />}
      {credentials && <CredentialsModal {...credentials} onClose={() => setCredentials(null)} />}
    </>
  );
}
