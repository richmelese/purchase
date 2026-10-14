'use client';

import { Suspense, useEffect, useState, Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PageHeader, Card, Field, Loading, PeriodFilter, Badge, useFetch, useToast } from '@/components/ui';
import { useLookups } from '@/components/lookups';
import { useSession } from '@/components/session';
import { Modal, PasswordInput, Select } from '@/components/ui';
import { date } from '@/lib/format';
import { settingsTabsFor, COMPANY_RIGHTS } from '@/lib/permissions';
import CompanyProfile from '@/components/CompanyProfile';

const EXPORTS = [
  { grant: ['reports', 'export'], href: (q) => `/api/export/all?${q}`, label: 'All-in-one workbook', desc: 'Purchase & sales detail, summaries, withholding and VAT declaration' },
  { grant: ['purchases', 'export'], href: (q) => `/api/export/purchases?${q}`, label: 'Purchases', desc: 'P. Detail + P. Summary' },
  { grant: ['sales', 'export'], href: (q) => `/api/export/sales?${q}`, label: 'Sales', desc: 'S. Detail + S. Summary' },
  { grant: ['withholding', 'export'], href: (q) => `/api/export/withholding?${q}`, label: 'Withholding', desc: 'P WH + S WH' },
  { grant: ['vat', 'export'], href: (q) => `/api/export/vat?${q}`, label: 'VAT declaration', desc: 'Monthly declaration lines' },
  { grant: ['credit', 'export'], href: () => '/api/export/credit', label: 'Credit', desc: 'Payables & receivables with aging' },
  { grant: ['inventory', 'export'], href: () => '/api/export/stock', label: 'Current stock', desc: 'Stock in / out / remaining / value' },
  { grant: ['inventory', 'export'], href: () => '/api/export/list/stock-in', label: 'Stock IN register', desc: 'Every purchase receipt line of stock items' },
  { grant: ['inventory', 'export'], href: () => '/api/export/list/stock-out', label: 'Stock Out register', desc: 'Sales and internal issues' },
  { grant: ['products', 'export'], href: () => '/api/export/list/products', label: 'Product list', desc: 'Product Master (can be re-imported)' },
  { grant: ['parties', 'export'], href: () => '/api/export/list/parties', label: 'Supplier list', desc: 'Company profile with TIN and MRC numbers' },
  { grant: ['lookups', 'export'], href: () => '/api/export/list/lookups', label: 'Setting lists', desc: 'All dropdown lists, like the Setting sheet' },
];

// ---------------------------------------------------------------------------
function CompanyTab() {
  const { can } = useSession();
  return (
    <>
      <CompanyProfile canEdit={can('settings', 'edit')} />
      <TaxRules canEdit={can('settings', 'edit')} />
    </>
  );
}

function TaxRules({ canEdit }) {
  const toast = useToast();
  const { data, error } = useFetch('/settings');
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  useEffect(() => {
    if (!data) return;
    setF({
      vat_rate: +data.vat_rate * 100, wh_rate: +data.wh_rate * 100,
      wh_goods_threshold: data.wh_goods_threshold, wh_service_threshold: data.wh_service_threshold,
    });
  }, [data]);
  if (!f) return <Loading error={error} />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      await api.put('/settings', { ...f, vat_rate: Number(f.vat_rate) / 100, wh_rate: Number(f.wh_rate) / 100 });
      toast('Tax rules saved');
      setErr({});
    } catch (e) { setErr(e.fields || {}); toast(e.message, 'error'); }
  };
  return (
    <div className="cp-tax">
      <Card title="Tax rules" actions={canEdit && <button className="btn btn-primary" onClick={save}>Save tax rules</button>}>
        <fieldset className="cp-fields" disabled={!canEdit}>
        <div className="form-grid">
          <Field label="VAT rate (%)" error={err.vat_rate}><input type="number" step="any" value={f.vat_rate} onChange={set('vat_rate')} /></Field>
          <Field label="Withholding rate (%)" error={err.wh_rate}><input type="number" step="any" value={f.wh_rate} onChange={set('wh_rate')} /></Field>
          <Field label="WH threshold – goods" error={err.wh_goods_threshold} hint="Taxable amount above which WH applies"><input type="number" step="any" value={f.wh_goods_threshold} onChange={set('wh_goods_threshold')} /></Field>
          <Field label="WH threshold – services" error={err.wh_service_threshold}><input type="number" step="any" value={f.wh_service_threshold} onChange={set('wh_service_threshold')} /></Field>
        </div>
        </fieldset>
        <p className="small muted">Rate changes apply to transactions saved from now on; existing records keep their stored amounts until edited.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ListCard({ def: rawDef, items, onChange, canEdit }) {
  const def = { ...rawDef, editable: rawDef.editable && canEdit };
  const toast = useToast();
  const [editing, setEditing] = useState(null);   // value being renamed
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState({ value: '', label: '' });

  const call = async (fn, msg) => {
    try { onChange(await fn()); if (msg) toast(msg); return true; } catch (e) { toast(e.message, 'error'); return false; }
  };
  const enc = (v) => encodeURIComponent(String(v));
  const add = async () => {
    if (await call(() => api.post(`/lookups/${def.list}`, adding), `Added to ${def.title}`)) setAdding({ value: '', label: '' });
  };
  const rename = async (v) => {
    if (await call(() => api.put(`/lookups/${def.list}/${enc(v)}`, { label }), 'Renamed')) setEditing(null);
  };

  return (
    <Card
      title={(
        <div>
          <h2>{def.title}</h2>
          <div className="small muted">{def.sheet ? `Setting sheet · column ${def.sheet}` : 'Additional list'}</div>
        </div>
      )}
      actions={def.editable ? <Badge tone="info">Editable</Badge> : <Badge>Fixed by tax rules</Badge>}
      bodyClass=""
    >
      <table className="lookup-table">
        <thead>
          <tr>
            {def.numeric && <th style={{ width: 50 }}>ID</th>}
            <th>{def.numeric ? 'Name' : 'Value'}</th>
            {def.editable && <th style={{ width: 112 }} />}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.value}>
              {def.numeric && <td className="muted">{it.value}</td>}
              <td className="wrap">
                {editing === it.value ? (
                  <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') rename(it.value); if (e.key === 'Escape') setEditing(null); }} />
                ) : (
                  <>{it.label}{def.editable && it.locked && <span className="muted small"> · system</span>}</>
                )}
              </td>
              {def.editable && (
                <td className="right">
                  {editing === it.value ? (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => rename(it.value)}>Save</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="icon-btn neutral" title="Move up" aria-label={`Move ${it.label} up`} disabled={i === 0} onClick={() => call(() => api.post(`/lookups/${def.list}/${enc(it.value)}/move`, { dir: 'up' }))}>▲</button>
                      <button className="icon-btn neutral" title="Move down" aria-label={`Move ${it.label} down`} disabled={i === items.length - 1} onClick={() => call(() => api.post(`/lookups/${def.list}/${enc(it.value)}/move`, { dir: 'down' }))}>▼</button>
                      <button className="icon-btn neutral" title="Rename" aria-label={`Rename ${it.label}`} onClick={() => { setEditing(it.value); setLabel(it.label); }}>✎</button>
                      <button className="icon-btn" title="Remove" aria-label={`Remove ${it.label}`} disabled={it.locked}
                        onClick={() => confirm(`Remove “${it.label}” from ${def.title}?`) && call(() => api.del(`/lookups/${def.list}/${enc(it.value)}`), 'Removed')}>✕</button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {def.editable && (
          <tfoot>
            <tr>
              {def.numeric && (
                <td><input value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} placeholder="auto" inputMode="numeric" aria-label="New ID" style={{ width: 52 }} /></td>
              )}
              <td>
                <input value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder={`New ${def.title.toLowerCase()}…`}
                  onKeyDown={(e) => e.key === 'Enter' && adding.label.trim() && add()} aria-label={`New ${def.title}`} />
              </td>
              <td className="right"><button className="btn btn-sm" disabled={!adding.label.trim()} onClick={add}>+ Add</button></td>
            </tr>
          </tfoot>
        )}
      </table>
    </Card>
  );
}

function ListsTab() {
  const lk = useLookups();
  const { can } = useSession();
  const isAdmin = can('lookups', 'edit');
  if (!lk.lists.length) return <Loading />;
  const sheetLists = lk.lists.filter((d) => d.sheet);
  const extra = lk.lists.filter((d) => !d.sheet);
  return (
    <>
      <div className="alert alert-info">
        These are the dropdown lists from the workbook&apos;s <strong>Setting</strong> sheet. Lists that the VAT and withholding
        calculations depend on are fixed; units of measurement, receipt types, product categories, departments and payment
        methods can be extended. A value that is already used by a record cannot be removed.
      </div>
      <div className="lookup-grid">
        {sheetLists.map((d) => <ListCard key={d.list} def={d} items={lk.values[d.list] || []} onChange={lk.set} canEdit={isAdmin} />)}
      </div>
      <h2 className="mt" style={{ margin: '24px 0 12px' }}>Additional lists</h2>
      <div className="lookup-grid">
        {extra.map((d) => <ListCard key={d.list} def={d} items={lk.values[d.list] || []} onChange={lk.set} canEdit={isAdmin} />)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function ExportTab() {
  const { data } = useFetch('/settings');
  const { can, isAdmin } = useSession();
  const exports = EXPORTS.filter((x) => can(...x.grant));
  const [period, setPeriod] = useState({ fy: null, month: '' });
  useEffect(() => { if (data) setPeriod((p) => ({ ...p, fy: p.fy || data.current_fy })); }, [data]);
  const q = `fy=${period.fy || ''}${period.month !== '' ? `&month=${period.month}` : ''}`;
  return (
    <div className="grid grid-2">
      <Card title="Export to Excel" actions={<PeriodFilter fy={period.fy} month={period.month} onChange={setPeriod} />}>
        <ul className="list-plain">
          {!exports.length && <li className="muted">Your role has no Excel exports.</li>}
          {exports.map((x) => (
            <li key={x.label}>
              <span><strong>{x.label}</strong><div className="small muted">{x.desc}</div></span>
              <a className="btn btn-sm" href={x.href(q)}>Download</a>
            </li>
          ))}
        </ul>
      </Card>
      {isAdmin && (
        <Card title="Backup">
          <p className="small muted" style={{ marginTop: 0 }}>Download a full copy of the database. Keep backups somewhere safe (another drive or cloud storage).</p>
          <a className="btn" href="/api/backup">Download database backup</a>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Temporary password: no look-alike characters, at least one letter and one digit. */
function generatePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(letters), pick(digits)];
  while (chars.length < 10) chars.push(pick(letters + digits));
  return chars.sort(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 - 0.5).join('');
}

function UserModal({ user, onClose, onSaved }) {
  const toast = useToast();
  const { isAdmin, user: me } = useSession();
  const { data: rolesData } = useFetch('/roles');
  const { data: partiesData } = useFetch('/parties');
  // Only administrators can hand out the Administrator role; the company list is already limited to the
  // companies the signed-in user can see.
  const roles = (rolesData || []).filter((r) => isAdmin || r.name !== 'admin' || r.id === user?.role_id);
  const parties = partiesData || [];
  const restrictedActor = !isAdmin && me && !me.access_all_parties;
  const companyAccount = !!user?.party_id;

  const [f, setF] = useState(user ? {
    username: user.username,
    full_name: user.full_name,
    role_id: user.role_id || (roles.find((r) => r.name === user.role)?.id || ''),
    role: user.role || 'user',
    active: user.active,
    password: '',
    access_all_parties: user.access_all_parties ?? true,
    party_ids: user.assigned_party_ids || (user.assigned_parties ? user.assigned_parties.map((p) => p.id) : []),
    party_rights: Object.fromEntries((user.assigned_parties || []).filter((p) => p.rights).map((p) => [p.id, p.rights])),
  } : {
    username: '',
    full_name: '',
    role_id: '',
    role: 'user',
    active: true,
    password: '',
    access_all_parties: true,
    party_ids: [],
    party_rights: {},
  });
  useEffect(() => {
    if (!user && restrictedActor) setF((prev) => ({ ...prev, access_all_parties: false }));
  }, [user, restrictedActor]);

  useEffect(() => {
    if (!f.role_id && roles.length) {
      if (user?.role_id) {
        setF((prev) => ({ ...prev, role_id: user.role_id }));
      } else if (user?.role) {
        const found = roles.find((r) => r.name === user.role);
        if (found) setF((prev) => ({ ...prev, role_id: found.id }));
      } else {
        const defaultRole = roles.find((r) => r.name === 'viewer') || roles[0];
        if (defaultRole) setF((prev) => ({ ...prev, role_id: defaultRole.id, role: defaultRole.name }));
      }
    }
  }, [roles, user]);

  const [partySearch, setPartySearch] = useState('');
  const [partyTypeFilter, setPartyTypeFilter] = useState('All');
  const [err, setErr] = useState({});

  const filteredParties = parties.filter((p) => {
    if (partyTypeFilter !== 'All') {
      if (partyTypeFilter === 'Supplier' && p.type !== 'Supplier' && p.type !== 'Both') return false;
      if (partyTypeFilter === 'Customer' && p.type !== 'Customer' && p.type !== 'Both') return false;
    }
    if (partySearch) {
      const q = partySearch.toLowerCase();
      return (p.name && p.name.toLowerCase().includes(q)) || (p.tin && p.tin.includes(q));
    }
    return true;
  });

  const toggleParty = (id) => {
    setF((prev) => {
      const exists = prev.party_ids.includes(id);
      return {
        ...prev,
        party_ids: exists ? prev.party_ids.filter((x) => x !== id) : [...prev.party_ids, id],
      };
    });
  };

  const selectAllFiltered = () => {
    const idsToAdd = filteredParties.map((p) => p.id);
    setF((prev) => ({
      ...prev,
      party_ids: [...new Set([...prev.party_ids, ...idsToAdd])],
    }));
  };

  // Rights for one assigned company. New selections start with everything the signed-in user may give.
  const giveable = (id) => (restrictedActor ? (me?.party_rights?.[id] || { view: true }) : Object.fromEntries(COMPANY_RIGHTS.map((r) => [r.id, true])));
  const rightsFor = (id) => f.party_rights?.[id] || giveable(id);
  const setRight = (id, right, on) => setF((prev) => {
    const next = { ...rightsFor(id), [right]: on };
    if (right === 'view' && !on) return prev; // seeing the company is the minimum; remove it to take access away
    if (on && right !== 'view') next.view = true;
    return { ...prev, party_rights: { ...prev.party_rights, [id]: next } };
  });

  const clearParties = () => {
    setF((prev) => ({ ...prev, party_ids: [] }));
  };

  const save = async () => {
    const problems = {};
    if (!companyAccount && !f.role_id) problems.role_id = 'Choose a role';
    if (!companyAccount && !f.access_all_parties && !f.party_ids.length) problems.party_ids = 'Choose at least one company, or give access to all companies';
    if (!user && (f.password || '').length < 8) problems.password = 'At least 8 characters';
    if (Object.keys(problems).length) { setErr({ ...problems, _: 'Please correct the highlighted fields' }); return; }
    try {
      const selectedRole = roles.find((r) => String(r.id) === String(f.role_id));
      const body = {
        full_name: f.full_name,
        role_id: f.role_id ? +f.role_id : undefined,
        role: selectedRole ? selectedRole.name : f.role,
        active: f.active,
        access_all_parties: Boolean(f.access_all_parties),
        party_ids: f.access_all_parties ? [] : f.party_ids,
        party_rights: f.access_all_parties ? {} : Object.fromEntries(f.party_ids.map((id) => [id, rightsFor(id)])),
      };
      if (!user) body.username = f.username;
      if (f.password) body.password = f.password;

      onSaved(user ? await api.put(`/users/${user.id}`, body) : await api.post('/users', body));
      toast(user
        ? (f.password ? 'User updated – they must choose a new password at their next sign-in' : 'User updated successfully')
        : `User ${f.username} created – they choose their own password at first sign-in`);
      onClose();
    } catch (e) {
      setErr({ ...(e.fields || {}), _: e.message });
    }
  };

  const roleOptions = roles.map((r) => ({
    value: String(r.id),
    label: `${r.label}${r.description ? ` (${r.description})` : ''}`,
  }));

  return (
    <Modal
      width={720}
      icon="users"
      title={user ? `Edit ${user.username}` : 'New user'}
      subtitle={user ? 'Update role, password and company access' : 'Create a sign-in and choose what this person can access'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{user ? 'Save changes' : 'Create user'}</button>
        </>
      }
    >
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginBottom: 16 }}>
        {!user && (
          <Field label="User name" required error={err.username} hint="Used to sign in">
            <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus />
          </Field>
        )}
        <Field label="Full name" required error={err.full_name} className={user ? 'span-4' : ''}>
          <input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </Field>
        {!companyAccount && (
        <Field label="Role" required className="span-4" error={err.role_id} hint="Decides the menus, pages and actions this user gets">
          <Select
            options={roleOptions.length ? roleOptions : [{ value: 'user', label: 'User' }, { value: 'admin', label: 'Administrator' }]}
            value={String(f.role_id)}
            onChange={(v) => {
              const matched = roles.find((r) => String(r.id) === String(v));
              setF({ ...f, role_id: v, role: matched?.name || f.role });
            }}
          />
        </Field>
        )}
        {user && (
          <Field label="Account Status">
            <Select
              options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive / pending' }]}
              value={f.active ? '1' : '0'}
              onChange={(v) => setF({ ...f, active: v === '1' })}
            />
          </Field>
        )}
        <Field
          label={user ? 'New password' : 'Password'}
          required={!user}
          error={err.password}
          hint={user
            ? 'Leave empty to keep the current password. A new one is temporary: the user must change it at the next sign-in.'
            : 'Temporary – the user must choose their own password at first sign-in. Give it to them privately.'}
          className={user ? '' : 'span-4'}
        >
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <PasswordInput
              className="grow"
              autoComplete="new-password"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              placeholder={user ? 'Leave empty to keep current' : 'At least 8 characters'}
            />
            <button type="button" className="btn" onClick={() => setF({ ...f, password: generatePassword() })} title="Generate a random temporary password">Generate</button>
          </div>
        </Field>
      </div>

      {!companyAccount && (
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Company & Supplier Access</h3>
        <p className="small muted" style={{ margin: '0 0 12px' }}>
          Assign whether this user has access to all companies or is restricted to specific suppliers/customers.
        </p>

        {err.party_ids && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err.party_ids}</div>}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: restrictedActor ? 'not-allowed' : 'pointer', marginBottom: 14, fontWeight: 600, opacity: restrictedActor ? 0.6 : 1 }}
          title={restrictedActor ? 'You can only give access to the companies assigned to you' : ''}>
          <input
            type="checkbox"
            className="perm-check"
            checked={f.access_all_parties}
            disabled={restrictedActor}
            onChange={(e) => setF({ ...f, access_all_parties: e.target.checked })}
          />
          <span>Full Access to All Companies & Suppliers (Unrestricted)</span>
        </label>

        {!f.access_all_parties && (
          <div className="party-picker">
            <div className="party-picker-head">
              <input
                type="search"
                placeholder="Search suppliers & customers by name or TIN…"
                value={partySearch}
                onChange={(e) => setPartySearch(e.target.value)}
                style={{ flex: 1, minWidth: 200, padding: '5px 9px' }}
              />
              <div className="row" style={{ gap: 4 }}>
                {['All', 'Supplier', 'Customer'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`btn btn-sm ${partyTypeFilter === t ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setPartyTypeFilter(t)}
                  >
                    {t === 'All' ? 'All' : `${t}s`}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={selectAllFiltered}>
                  Select Filtered
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={clearParties}>
                  Clear
                </button>
              </div>
            </div>

            <div className="party-picker-list">
              {!filteredParties.length ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>
                  No companies found matching search.
                </div>
              ) : (
                filteredParties.map((p) => {
                  const isChecked = f.party_ids.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      className={`party-picker-item ${isChecked ? 'selected' : ''}`}
                      onClick={() => toggleParty(p.id)}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        aria-label={`Select ${p.name}`}
                      />
                      <div className="party-picker-info">
                        <div className="party-picker-name" title={p.name}>{p.name}</div>
                        <div className="party-picker-meta">
                          {p.tin ? <span>TIN {p.tin}</span> : <span>No TIN</span>}
                          <span>·</span>
                          <span>{p.type}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ padding: '8px 14px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">{f.party_ids.length} compan{f.party_ids.length === 1 ? 'y' : 'ies'} assigned</span>
              <span className="muted">{parties.length} total registered</span>
            </div>
          </div>
        )}

        {!f.access_all_parties && f.party_ids.length > 0 && (
          <div className="company-rights">
            <div className="company-rights-head">
              <strong>Rights for each company</strong>
              <span className="small muted">What this user may do with each company&apos;s records – on top of what the role allows.</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Company</th>{COMPANY_RIGHTS.map((r) => <th key={r.id} className="center">{r.label}</th>)}</tr>
                </thead>
                <tbody>
                  {f.party_ids.map((id) => {
                    const p = parties.find((x) => x.id === id) || (user?.assigned_parties || []).find((x) => x.id === id);
                    const rights = rightsFor(id);
                    const mayGive = giveable(id);
                    return (
                      <tr key={id}>
                        <td className="wrap"><strong>{p?.name || `Company #${id}`}</strong>{p?.tin && <div className="small muted">TIN {p.tin}</div>}</td>
                        {COMPANY_RIGHTS.map((r) => (
                          <td key={r.id} className="center">
                            <input type="checkbox" className="perm-check" aria-label={`${r.label} – ${p?.name || id}`}
                              checked={!!rights[r.id]} disabled={r.id === 'view' || !mayGive[r.id]}
                              title={r.id === 'view' ? 'Always included – remove the company to take access away' : !mayGive[r.id] ? 'You do not have this right for this company' : ''}
                              onChange={(e) => setRight(id, r.id, e.target.checked)} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      )}
    </Modal>
  );
}

function UsersTab() {
  const toast = useToast();
  const { user: me, can, isAdmin } = useSession();
  const { data, error, setData } = useFetch('/users');
  const [editing, setEditing] = useState(null);

  const activate = async (u) => {
    try {
      setData(await api.put(`/users/${u.id}`, { active: true }));
      toast(`${u.username} activated`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async (u) => {
    if (!confirm(`Delete user ${u.username}?`)) return;
    try {
      setData(await api.del(`/users/${u.id}`));
      toast('User deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const pending = (data || []).filter((u) => !u.active).length;

  return (
    <Card bodyClass="" title="Users" actions={can('users', 'create') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ New user</button>}>
      {pending > 0 && <div className="alert alert-info" style={{ margin: 16 }}>{pending} account{pending > 1 ? 's are' : ' is'} waiting for approval.</div>}
      {!data ? <Loading error={error} /> : (
        <table>
          <thead>
            <tr>
              <th>User name</th>
              <th>Full name</th>
              <th>Role</th>
              <th>Company Access</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong>{u.id === me?.id && <span className="muted small"> (you)</span>}</td>
                <td>{u.full_name}</td>
                <td>
                  <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>
                    {u.role_label || (u.role === 'admin' ? 'Administrator' : 'User')}
                  </Badge>
                </td>
                <td>
                  {u.party_id ? (
                    <span className="small"><Badge tone="info">Own company only</Badge> {u.company_name}{u.must_change_password && <span className="muted"> · must set password</span>}</span>
                  ) : u.access_all_parties ? (
                    <Badge tone="good">All Companies (Full Access)</Badge>
                  ) : (
                    <span title={u.assigned_parties?.map((p) => `${p.name}: ${Object.entries(p.rights || {}).filter(([, on]) => on).map(([r]) => r).join(', ') || 'view'}`).join(' · ')}>
                      <Badge tone="warn">
                        {u.assigned_parties?.length || 0} Compan{u.assigned_parties?.length === 1 ? 'y' : 'ies'}
                      </Badge>
                    </span>
                  )}
                </td>
                <td>{u.active ? <Badge tone="good">Active</Badge> : <Badge tone="warn">Pending</Badge>}</td>
                <td>{u.last_login ? date(u.last_login) : <span className="muted">Never</span>}</td>
                <td>{date(u.created_at)}</td>
                <td className="right">
                  {!u.active && can('users', 'edit') && <button className="btn btn-sm btn-primary" onClick={() => activate(u)}>Activate</button>}
                  {can('users', 'edit') && (isAdmin || u.role !== 'admin') && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)}>Edit</button>}
                  {can('users', 'delete') && (isAdmin || u.role !== 'admin') && <button className="btn btn-sm btn-ghost" onClick={() => remove(u)} disabled={u.id === me?.id}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <UserModal user={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={setData} />}
    </Card>
  );
}

const DEFAULT_TASKS_MAP = {
  users: [
    { id: 'create_user', label: 'Create User', right: 'create' },
    { id: 'read_user', label: 'Read User Details', right: 'view' },
    { id: 'update_user', label: 'Update Account Info', right: 'edit' },
    { id: 'assign_roles_companies', label: 'Assign Roles & Companies', right: 'edit' },
    { id: 'delete_user', label: 'Delete User Account', right: 'delete' },
    { id: 'export_users', label: 'Export User List', right: 'export' },
  ],
  roles: [
    { id: 'create_role', label: 'Create Role', right: 'create' },
    { id: 'read_role', label: 'Read Role & Matrix', right: 'view' },
    { id: 'update_role', label: 'Update Permissions', right: 'edit' },
    { id: 'delete_role', label: 'Delete Role', right: 'delete' },
    { id: 'export_roles', label: 'Export Roles', right: 'export' },
  ],
  purchases: [
    { id: 'create_purchase', label: 'Create Purchase Invoice', right: 'create' },
    { id: 'read_purchase', label: 'Read Invoices & Receipts', right: 'view' },
    { id: 'update_purchase', label: 'Update Invoices & Goods', right: 'edit' },
    { id: 'delete_purchase', label: 'Delete Purchase Invoice', right: 'delete' },
    { id: 'export_purchase', label: 'Export Purchase Register', right: 'export' },
    { id: 'record_payment_p', label: 'Record Credit Payment', right: 'edit' },
  ],
  sales: [
    { id: 'create_sales', label: 'Create Sales Invoice', right: 'create' },
    { id: 'read_sales', label: 'Read Sales Records', right: 'view' },
    { id: 'update_sales', label: 'Update Sales Invoice', right: 'edit' },
    { id: 'delete_sales', label: 'Delete Sales Invoice', right: 'delete' },
    { id: 'export_sales', label: 'Export Sales Summary', right: 'export' },
  ],
  reconciliation: [
    { id: 'import_bank', label: 'Import Bank Statement (Excel)', right: 'create' },
    { id: 'read_reconcil', label: 'Read Accounts & Entries', right: 'view' },
    { id: 'run_automatch', label: 'Run Auto-Matching Engine', right: 'edit' },
    { id: 'create_bank_tx', label: 'Add Adjustment Entry', right: 'create' },
    { id: 'delete_bank_tx', label: 'Delete Bank Transactions', right: 'delete' },
    { id: 'export_reconcil', label: 'Export Reconciliation Sheets', right: 'export' },
  ],
  parties: [
    { id: 'create_party', label: 'Add Supplier or Customer', right: 'create' },
    { id: 'read_party', label: 'Read Directory & TIN', right: 'view' },
    { id: 'update_party', label: 'Update Profiles & MRC', right: 'edit' },
    { id: 'delete_party', label: 'Delete Company Record', right: 'delete' },
    { id: 'export_parties', label: 'Export Company Directory', right: 'export' },
  ],
  inventory: [
    { id: 'create_issue', label: 'Record Store Issue / Receipt', right: 'create' },
    { id: 'read_stock', label: 'Read Stock Ledger & Balances', right: 'view' },
    { id: 'update_stock', label: 'Update Quantities & Minimums', right: 'edit' },
    { id: 'delete_issue', label: 'Delete Store Issue Voucher', right: 'delete' },
    { id: 'export_stock', label: 'Export Inventory Balance', right: 'export' },
  ],
  withholding: [
    { id: 'create_wh', label: 'Create Withholding Receipt', right: 'create' },
    { id: 'read_wh', label: 'Read Withholding Register', right: 'view' },
    { id: 'update_wh', label: 'Update Receipt Details', right: 'edit' },
    { id: 'delete_wh', label: 'Delete Withholding Receipt', right: 'delete' },
    { id: 'export_wh', label: 'Export Tax Filing Summary', right: 'export' },
  ],
  credit: [
    { id: 'create_payment', label: 'Record Payment Voucher', right: 'create' },
    { id: 'read_credit', label: 'Read Outstanding Balances', right: 'view' },
    { id: 'update_credit', label: 'Update Payment Allocations', right: 'edit' },
    { id: 'delete_payment', label: 'Delete Payment Voucher', right: 'delete' },
    { id: 'export_credit', label: 'Export Aging Statement', right: 'export' },
  ],
  vat: [
    { id: 'read_vat', label: 'Read Monthly VAT Return', right: 'view' },
    { id: 'update_vat', label: 'Post VAT Adjustments', right: 'edit' },
    { id: 'export_vat', label: 'Export ERCA VAT Declaration', right: 'export' },
  ],
  products: [
    { id: 'create_product', label: 'Add Product to Catalog', right: 'create' },
    { id: 'read_product', label: 'Read Catalog & Pricing', right: 'view' },
    { id: 'update_product', label: 'Update Prices & Codes', right: 'edit' },
    { id: 'delete_product', label: 'Delete Product Record', right: 'delete' },
    { id: 'export_product', label: 'Export Catalog to Excel', right: 'export' },
  ],
  reports: [
    { id: 'read_reports', label: 'Read Registers & Analytics', right: 'view' },
    { id: 'export_reports', label: 'Export Reports to Excel', right: 'export' },
  ],
  settings: [
    { id: 'read_settings', label: 'Read System Configuration', right: 'view' },
    { id: 'update_settings', label: 'Update Company Info & Rules', right: 'edit' },
  ],
  lookups: [
    { id: 'read_lookups', label: 'Read Units & Lookups', right: 'view' },
    { id: 'update_lookups', label: 'Update Dropdown Lists', right: 'edit' },
  ],
  audit: [
    { id: 'read_audit', label: 'Read Activity Log', right: 'view' },
    { id: 'export_audit', label: 'Export Audit Trail', right: 'export' },
  ],
  export: [
    { id: 'read_export', label: 'Read Backup History', right: 'view' },
    { id: 'download_backup', label: 'Download System Backup', right: 'export' },
  ],
};

// ---------------------------------------------------------------------------
// Roles & Permissions Tab
// ---------------------------------------------------------------------------
function RoleModal({ role, onClose, onSaved }) {
  const toast = useToast();
  const { isAdmin: mayEdit } = useSession();
  const { data: resData } = useFetch('/roles/resources');
  const resources = resData?.resources || [
    { id: 'users', name: 'User Management', description: 'Manage user accounts, credentials, and company access...' },
    { id: 'roles', name: 'Role & Permissions', description: 'Manage dynamic roles and access controls...' },
    { id: 'purchases', name: 'Purchases', description: 'Manage vendor invoices, goods receipts, and payment terms...' },
    { id: 'sales', name: 'Sales', description: 'Manage sales invoices, customer receipts, and billing...' },
    { id: 'reconciliation', name: 'Bank Reconciliation', description: 'Manage bank statements, auto-matching, and ledger entries...' },
    { id: 'parties', name: 'Suppliers & Customers', description: 'Manage company directory, TIN profiles, and MRC registrations...' },
    { id: 'inventory', name: 'Inventory & Stock', description: 'Manage stock ledger, store issues, and item movements...' },
    { id: 'withholding', name: 'Withholding Tax', description: 'Manage purchase and sales withholding receipts and tax filing...' },
    { id: 'credit', name: 'Credit & Payments', description: 'Manage payables, receivables, aging and payment tracking...' },
    { id: 'vat', name: 'VAT Declaration', description: 'Manage monthly VAT declarations and official filings...' },
    { id: 'products', name: 'Product Master', description: 'Manage product catalog, pricing, serial numbers, and units...' },
    { id: 'reports', name: 'Financial Reports', description: 'Manage financial reports, registers, and executive summaries...' },
    { id: 'settings', name: 'System Settings', description: 'Manage company details, tax rates, and thresholds...' },
    { id: 'lookups', name: 'Dropdown Lists', description: 'Manage measurement units, payment methods, and categories...' },
    { id: 'audit', name: 'Activity Log', description: 'Manage audit trail, login history, and security events...' },
    { id: 'export', name: 'Data Export & Backup', description: 'Manage database backups, snapshots, and downloads...' },
  ];

  // Exactly matching the user's screenshot columns: CREATE, READ, UPDATE, DELETE, EXPORT
  const rights = [
    { id: 'create', label: 'CREATE' },
    { id: 'view', label: 'READ' },
    { id: 'edit', label: 'UPDATE' },
    { id: 'delete', label: 'DELETE' },
    { id: 'export', label: 'EXPORT' },
  ];

  const [f, setF] = useState(role ? {
    name: role.name,
    label: role.label,
    description: role.description || '',
    permissions: role.permissions || {},
  } : {
    name: '',
    label: '',
    description: '',
    permissions: {},
  });

  const [expanded, setExpanded] = useState({ users: true });
  const [err, setErr] = useState({});
  const isSystem = Boolean(role?.is_system);
  const isAdminRole = role?.name === 'admin';

  const toggleAccordion = (resId) => {
    setExpanded((prev) => ({ ...prev, [resId]: !prev[resId] }));
  };

  const getResourceTasks = (res) => {
    return res.tasks && res.tasks.length ? res.tasks : (DEFAULT_TASKS_MAP[res.id] || []);
  };

  const toggleRight = (resId, rightId) => {
    if (isAdminRole) return;
    setF((prev) => {
      const curRes = prev.permissions[resId] || {};
      const nextVal = !curRes[rightId];
      const resObj = resources.find((r) => r.id === resId);
      const tasks = getResourceTasks(resObj);
      const nextRes = { ...curRes, [rightId]: nextVal };
      tasks.filter((t) => t.right === rightId).forEach((t) => {
        nextRes[t.id] = nextVal;
      });
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [resId]: nextRes,
        },
      };
    });
  };

  const toggleColumn = (rightId) => {
    if (isAdminRole) return;
    const allChecked = resources.every((r) => f.permissions[r.id]?.[rightId]);
    const nextVal = !allChecked;
    setF((prev) => {
      const nextPerms = { ...prev.permissions };
      resources.forEach((r) => {
        const curRes = nextPerms[r.id] || {};
        const tasks = getResourceTasks(r);
        const nextRes = { ...curRes, [rightId]: nextVal };
        tasks.filter((t) => t.right === rightId).forEach((t) => {
          nextRes[t.id] = nextVal;
        });
        nextPerms[r.id] = nextRes;
      });
      return { ...prev, permissions: nextPerms };
    });
  };

  const toggleGranularTask = (resId, task) => {
    if (isAdminRole) return;
    setF((prev) => {
      const curRes = prev.permissions[resId] || {};
      const currentTaskVal = curRes[task.id] !== undefined ? !!curRes[task.id] : !!curRes[task.right];
      const nextTaskVal = !currentTaskVal;
      const resObj = resources.find((r) => r.id === resId);
      const tasks = getResourceTasks(resObj);
      const relatedTasks = tasks.filter((t) => t.right === task.right);

      const nextRes = { ...curRes, [task.id]: nextTaskVal };
      const anyActive = relatedTasks.some((t) => {
        if (t.id === task.id) return nextTaskVal;
        return nextRes[t.id] !== undefined ? nextRes[t.id] : !!curRes[task.right];
      });

      nextRes[task.right] = anyActive;

      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [resId]: nextRes,
        },
      };
    });
  };

  const setPreset = (type) => {
    if (isAdminRole) return;
    const newPerms = {};
    resources.forEach((res) => {
      newPerms[res.id] = {};
      const tasks = getResourceTasks(res);
      rights.forEach((rt) => {
        let active = false;
        if (type === 'all') active = true;
        else if (type === 'clear') active = false;
        else if (type === 'readonly') active = rt.id === 'view' || rt.id === 'export';
        else if (type === 'tx') {
          if (['purchases', 'sales', 'reconciliation', 'parties'].includes(res.id)) active = true;
          else if (['credit', 'inventory', 'reports'].includes(res.id)) active = rt.id === 'view' || rt.id === 'export';
        }
        newPerms[res.id][rt.id] = active;
        tasks.filter((t) => t.right === rt.id).forEach((t) => {
          newPerms[res.id][t.id] = active;
        });
      });
    });
    setF((prev) => ({ ...prev, permissions: newPerms }));
  };

  const save = async () => {
    try {
      const body = {
        name: f.name,
        label: f.label,
        description: f.description,
        permissions: f.permissions,
      };
      const res = role
        ? await api.put(`/roles/${role.id}`, body)
        : await api.post('/roles', body);
      toast(role ? 'Role updated successfully' : 'Role created successfully');
      onSaved(res);
      onClose();
    } catch (e) {
      setErr({ ...(e.fields || {}), _: e.message });
    }
  };

  return (
    <Modal
      width={1020}
      title={role ? `Edit Role: ${role.label}` : 'New Role'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          {mayEdit && role?.name !== 'admin' && <button className="btn btn-primary" onClick={save}>Save Role</button>}
        </>
      }
    >
      {err._ && <div className="alert alert-error">{err._}</div>}

      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginBottom: 16 }}>
        <Field label="Role Label" required error={err.label} hint="Display title for this role">
          <input
            value={f.label}
            onChange={(e) => setF({ ...f, label: e.target.value })}
            placeholder="e.g. Senior Auditor, Procurement Officer"
            autoFocus
          />
        </Field>
        <Field
          label="Role Code"
          required
          error={err.name}
          hint={isSystem ? 'System identifier (fixed)' : 'Unique identifier (letters, numbers, _) '}
        >
          <input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
            placeholder="e.g. auditor, purchase_lead"
            disabled={isSystem}
          />
        </Field>
        <Field label="Description" className="span-4" hint="Brief explanation of responsibilities and permissions">
          <input
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            placeholder="e.g. Manage user accounts, credentials, and company access..."
          />
        </Field>
      </div>

      <div className="role-perm-section">
        <div className="role-perm-head-bar">
          <div className="role-perm-title-group">
            <span className="role-perm-bullet" />
            <h2 className="role-perm-title">Role & access permissions</h2>
          </div>
          {!isAdminRole && (
            <div className="role-perm-presets">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('all')}>Select All</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('readonly')}>Read-Only</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('tx')}>Transactions</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('clear')}>Clear All</button>
            </div>
          )}
        </div>

        {isAdminRole && (
          <div className="alert alert-info" style={{ margin: '4px 0 10px 0' }}>
            <strong>Administrator Role:</strong> System administrator has full unrestricted permissions across all resources.
          </div>
        )}

        <div className="role-perm-card">
          <table className="role-perm-table">
            <thead>
              <tr>
                <th className="role-perm-th">
                  <span className="role-perm-th-label">MODULE / RESOURCE</span>
                </th>
                {rights.map((rt) => {
                  const isColumnAllChecked = resources.length > 0 && resources.every((r) => f.permissions[r.id]?.[rt.id]);
                  return (
                    <th key={rt.id} className="role-perm-th role-perm-th-action">
                      <label>
                        <input
                          type="checkbox"
                          checked={isAdminRole || isColumnAllChecked}
                          disabled={isAdminRole}
                          onChange={() => toggleColumn(rt.id)}
                        />
                        <span>{rt.label}</span>
                      </label>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {resources.map((res) => {
                const curPerm = f.permissions[res.id] || {};
                const isExpanded = !!expanded[res.id];
                const tasks = getResourceTasks(res);

                return (
                  <Fragment key={res.id}>
                    <tr className={`role-perm-row ${isExpanded ? 'role-perm-row-expanded' : ''}`}>
                      <td className="role-perm-td-res">
                        <div className="role-perm-res-title">{res.name}</div>
                        <button
                          type="button"
                          className="role-perm-accordion-toggle"
                          onClick={() => toggleAccordion(res.id)}
                          title="Click to view granular tasks & actions"
                        >
                          <span className={`role-perm-chevron-circle ${isExpanded ? 'open' : ''}`}>
                            ›
                          </span>
                          <span className="role-perm-res-desc">{res.description}</span>
                        </button>

                        {isExpanded && (
                          <div className="role-perm-granular-container">
                            <div className="role-perm-granular-header">
                              Granular tasks & actions:
                            </div>
                            <div className="role-perm-granular-grid">
                              {tasks.map((task) => {
                                const isChecked = isAdminRole || (curPerm[task.id] !== undefined ? !!curPerm[task.id] : !!curPerm[task.right]);
                                return (
                                  <label key={task.id} className="role-perm-granular-item">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={isAdminRole}
                                      onChange={() => toggleGranularTask(res.id, task)}
                                    />
                                    <span>{task.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </td>

                      {rights.map((rt) => {
                        const isRightChecked = isAdminRole || !!curPerm[rt.id];
                        return (
                          <td key={rt.id} className="role-perm-td-action">
                            <input
                              type="checkbox"
                              className="role-perm-checkbox"
                              checked={isRightChecked}
                              disabled={isAdminRole}
                              onChange={() => toggleRight(res.id, rt.id)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function RolesTab() {
  const toast = useToast();
  const { isAdmin } = useSession();
  const { data, error, setData } = useFetch('/roles');
  const [editing, setEditing] = useState(null);

  const remove = async (r) => {
    if (r.is_system) {
      toast('System roles cannot be deleted', 'error');
      return;
    }
    if (r.user_count > 0) {
      toast(`Cannot delete role: ${r.user_count} user(s) are assigned to it`, 'error');
      return;
    }
    if (!confirm(`Delete role "${r.label}"?`)) return;
    try {
      await api.del(`/roles/${r.id}`);
      setData((prev) => prev.filter((item) => item.id !== r.id));
      toast('Role deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const handleSaved = (savedRole) => {
    setData((prev) => {
      const idx = prev.findIndex((r) => r.id === savedRole.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = savedRole;
        return next;
      }
      return [...prev, savedRole];
    });
  };

  return (
    <Card
      bodyClass=""
      title="Roles & Permissions"
      actions={isAdmin ? <button className="btn btn-primary" onClick={() => setEditing({})}>+ New role</button> : <span className="small muted">Only administrators can change roles</span>}
    >
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <p className="small muted" style={{ margin: 0 }}>
          Manage access levels and fine-grained permissions for users. Built-in system roles provide standard profiles, while custom roles allow assigning exact rights per resource table (View, Create, Edit, Delete, Export).
        </p>
      </div>

      {!data ? (
        <Loading error={error} />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Code</th>
              <th>Description</th>
              <th>Users</th>
              <th>Type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.label}</strong>
                </td>
                <td className="muted small font-mono">{r.name}</td>
                <td className="wrap">{r.description || <span className="muted">—</span>}</td>
                <td>
                  <Badge tone={r.user_count > 0 ? 'good' : 'neutral'}>
                    {r.user_count} {r.user_count === 1 ? 'user' : 'users'}
                  </Badge>
                </td>
                <td>
                  {r.is_system ? <Badge tone="info">System</Badge> : <Badge tone="neutral">Custom</Badge>}
                </td>
                <td className="right">
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(r)}>
                    {r.name === 'admin' || !isAdmin ? 'View' : 'Edit'}
                  </button>
                  {!r.is_system && isAdmin && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => remove(r)}
                      disabled={r.user_count > 0}
                      title={r.user_count > 0 ? 'Cannot delete role with assigned users' : 'Delete role'}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <RoleModal
          role={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
const ENTITY_LABELS = {
  purchase: 'Purchases', sale: 'Sales', payment: 'Payments', withholding: 'Withholding', product: 'Products', party: 'Companies',
  stock: 'Stock', setting: 'Settings', vat: 'VAT', user: 'Users & sign-in',
};
const ACTION_TONE = { create: 'good', update: 'info', delete: 'bad', other: undefined };

function ActivityTab() {
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, error } = useFetch(`/audit?limit=500${entity ? `&entity=${entity}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`);
  return (
    <Card fill bodyClass="" title={(
      <div className="row">
        <input type="search" placeholder="Search activity or user…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Area">
          <option value="">All areas</option>
          {Object.entries(ENTITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
    )} actions={<span className="small muted">Latest 500 entries</span>}>
      {!data ? <Loading error={error} /> : !data.length ? <div className="empty">No activity recorded yet.</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Area</th><th>What happened</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="small">{new Date(`${a.at.replace(' ', 'T')}Z`).toLocaleString()}</td>
                  <td>{a.username || <span className="muted">—</span>}</td>
                  <td><Badge tone={ACTION_TONE[a.action]}>{a.action}</Badge></td>
                  <td className="small">{ENTITY_LABELS[a.entity] || a.entity}</td>
                  <td className="wrap">{a.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


function Settings() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useSession();
  const tabs = settingsTabsFor(user);
  const tab = tabs.some((t) => t.id === params.get('tab')) ? params.get('tab') : tabs[0]?.id;
  if (!user) return null;
  return (
    <>
      <PageHeader title="Settings" subtitle="Company details, tax rules, dropdown lists and data export" />
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => router.replace(`/settings?tab=${t.id}`)}>{t.label}</button>
        ))}
      </div>
      {tab === 'company' && <CompanyTab />}
      {tab === 'lists' && <ListsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'activity' && <ActivityTab />}
      {tab === 'export' && <ExportTab />}
    </>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={<Loading />}><Settings /></Suspense>;
}
