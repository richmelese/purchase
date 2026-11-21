'use client';

import { Suspense, useEffect, useState, Fragment, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PageHeader, Card, Field, Loading, PeriodFilter, Badge, useFetch, useToast } from '@/components/ui';
import { useLookups, type LookupListMeta, type LookupValue } from '@/components/lookups';
import { useSession } from '@/components/session';
import { Modal, PasswordInput, Select } from '@/components/ui';
import { date, dateTime } from '@/lib/format';
import { settingsTabsFor, COMPANY_RIGHTS } from '@/lib/permissions';
import CompanyProfile from '@/components/CompanyProfile';
import type { Party } from '@/lib/types';
import { useT } from '@/lib/i18n';

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

interface SettingsData {
  vat_rate: number;
  wh_rate: number;
  wh_goods_threshold: number;
  wh_service_threshold: number;
  current_fy: number;
  [key: string]: unknown;
}

interface TaxForm {
  vat_rate: number | string;
  wh_rate: number | string;
  wh_goods_threshold: number | string;
  wh_service_threshold: number | string;
}

// Rates are stored as fractions (0.15) and edited as percentages (15); rounding drops float noise.
const toPercent = (rate: number): number => Math.round(Number(rate) * 100 * 1e6) / 1e6;
const fromPercent = (pct: unknown): number | '' => (String(pct).trim() === '' ? '' : Math.round((Number(pct) / 100) * 1e8) / 1e8);

function TaxRules({ canEdit }: { canEdit?: boolean }) {
  const toast = useToast();
  const { t } = useT();
  const { data, error } = useFetch<SettingsData>('/settings');
  const [f, setF] = useState<TaxForm | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    setF({
      vat_rate: toPercent(data.vat_rate), wh_rate: toPercent(data.wh_rate),
      wh_goods_threshold: data.wh_goods_threshold, wh_service_threshold: data.wh_service_threshold,
    });
  }, [data]);
  if (!f) return <Loading error={error} />;
  const set = (k: keyof TaxForm) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      await api.put('/settings', { ...f, vat_rate: fromPercent(f.vat_rate), wh_rate: fromPercent(f.wh_rate) });
      toast(t('Tax rules saved'));
      setErr({});
    } catch (e: any) { setErr(e.fields || {}); toast(e.message, 'error'); }
  };
  return (
    <div className="cp-tax">
      <Card title={t('Tax rules')} actions={canEdit && <button className="btn btn-primary" onClick={save}>{t('Save tax rules')}</button>}>
        <fieldset className="cp-fields" disabled={!canEdit}>
        <div className="form-grid">
          <Field label={t('VAT rate (%)')} error={err.vat_rate}><input type="number" step="any" value={f.vat_rate} onChange={set('vat_rate')} /></Field>
          <Field label={t('Withholding rate (%)')} error={err.wh_rate}><input type="number" step="any" value={f.wh_rate} onChange={set('wh_rate')} /></Field>
          <Field label={t('WH threshold – goods')} error={err.wh_goods_threshold} hint={t('Taxable amount above which WH applies')}><input type="number" step="any" value={f.wh_goods_threshold} onChange={set('wh_goods_threshold')} /></Field>
          <Field label={t('WH threshold – services')} error={err.wh_service_threshold}><input type="number" step="any" value={f.wh_service_threshold} onChange={set('wh_service_threshold')} /></Field>
        </div>
        </fieldset>
        <p className="small muted">{t('Rate changes apply to transactions saved from now on; existing records keep their stored amounts until edited.')}</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
interface ListCardProps {
  def: LookupListMeta;
  items: LookupValue[];
  onChange: (values: Record<string, LookupValue[]>) => void;
  canEdit?: boolean;
}

function ListCard({ def: rawDef, items, onChange, canEdit }: ListCardProps) {
  const def = { ...rawDef, editable: rawDef.editable && canEdit };
  const toast = useToast();
  const { t } = useT();
  const title = t(def.title);
  const [editing, setEditing] = useState<string | null>(null);   // value being renamed
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState({ value: '', label: '' });

  const call = async (fn: () => Promise<Record<string, LookupValue[]>>, msg?: string) => {
    try { onChange(await fn()); if (msg) toast(msg); return true; } catch (e: any) { toast(e.message, 'error'); return false; }
  };
  const enc = (v: unknown) => encodeURIComponent(String(v));
  const add = async () => {
    if (await call(() => api.post(`/lookups/${def.list}`, adding), t('Added to {list}', { list: title }))) setAdding({ value: '', label: '' });
  };
  const rename = async (v: string) => {
    if (await call(() => api.put(`/lookups/${def.list}/${enc(v)}`, { label }), t('Renamed'))) setEditing(null);
  };

  return (
    <Card
      title={(
        <div>
          <h2>{title}</h2>
          <div className="small muted">{def.sheet ? t('Setting sheet · column {col}', { col: def.sheet }) : t('Additional list')}</div>
        </div>
      )}
      actions={def.editable ? <Badge tone="info">{t('Editable')}</Badge> : <Badge>{t('Fixed by tax rules')}</Badge>}
      bodyClass=""
    >
      <table className="lookup-table">
        <thead>
          <tr>
            {def.numeric && <th style={{ width: 50 }}>{t('ID')}</th>}
            <th>{def.numeric ? t('Name') : t('Value')}</th>
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
                  <>{it.label}{def.editable && it.locked && <span className="muted small"> · {t('system')}</span>}</>
                )}
              </td>
              {def.editable && (
                <td className="right">
                  {editing === it.value ? (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => rename(it.value)}>{t('Save')}</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
                    </>
                  ) : (
                    <>
                      <button className="icon-btn neutral" title={t('Move up')} aria-label={t('Move {item} up', { item: it.label })} disabled={i === 0} onClick={() => call(() => api.post(`/lookups/${def.list}/${enc(it.value)}/move`, { dir: 'up' }))}>▲</button>
                      <button className="icon-btn neutral" title={t('Move down')} aria-label={t('Move {item} down', { item: it.label })} disabled={i === items.length - 1} onClick={() => call(() => api.post(`/lookups/${def.list}/${enc(it.value)}/move`, { dir: 'down' }))}>▼</button>
                      <button className="icon-btn neutral" title={t('Rename')} aria-label={t('Rename {item}', { item: it.label })} onClick={() => { setEditing(it.value); setLabel(it.label); }}>✎</button>
                      <button className="icon-btn" title={t('Remove')} aria-label={t('Remove {item}', { item: it.label })} disabled={it.locked}
                        onClick={() => confirm(t('Remove “{item}” from {list}?', { item: it.label, list: title })) && call(() => api.del(`/lookups/${def.list}/${enc(it.value)}`), t('Removed'))}>✕</button>
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
                <td><input value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} placeholder={t('auto')} inputMode="numeric" aria-label={t('New ID')} style={{ width: 52 }} /></td>
              )}
              <td>
                <input value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder={t('New value for {list}…', { list: title })}
                  onKeyDown={(e) => e.key === 'Enter' && adding.label.trim() && add()} aria-label={t('New value for {list}', { list: title })} />
              </td>
              <td className="right"><button className="btn btn-sm" disabled={!adding.label.trim()} onClick={add}>+ {t('Add')}</button></td>
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
  const { t } = useT();
  const isAdmin = can('lookups', 'edit');
  if (!lk.lists.length) return <Loading />;
  const sheetLists = lk.lists.filter((d) => d.sheet);
  const extra = lk.lists.filter((d) => !d.sheet);
  return (
    <>
      <div className="alert alert-info">
        {t('These are the dropdown lists from the workbook’s Setting sheet. Lists that the VAT and withholding calculations depend on are fixed; units of measurement, receipt types, product categories, departments and payment methods can be extended. A value that is already used by a record cannot be removed.')}
      </div>
      <div className="lookup-grid">
        {sheetLists.map((d) => <ListCard key={d.list} def={d} items={lk.values[d.list] || []} onChange={lk.set} canEdit={isAdmin} />)}
      </div>
      <h2 className="mt" style={{ margin: '24px 0 12px' }}>{t('Additional lists')}</h2>
      <div className="lookup-grid">
        {extra.map((d) => <ListCard key={d.list} def={d} items={lk.values[d.list] || []} onChange={lk.set} canEdit={isAdmin} />)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
interface ExportItem {
  id: string | number;
  label: string;
  desc?: string;
  path: string;
  period?: boolean;
}

function ExportTab() {
  const { data } = useFetch<SettingsData>('/settings');
  const { isAdmin } = useSession();
  const { t } = useT();
  // Only the downloads this user's role allows (GET /exports).
  const { data: exportList, error: exportError } = useFetch<ExportItem[]>('/exports');
  const exports = exportList || [];
  const [period, setPeriod] = useState<{ fy: number | null; month: number | '' }>({ fy: null, month: '' });
  useEffect(() => { if (data) setPeriod((p) => ({ ...p, fy: p.fy || data.current_fy })); }, [data]);
  const q = `fy=${period.fy || ''}${period.month !== '' ? `&month=${period.month}` : ''}`;
  return (
    <div className="grid grid-2">
      <Card title={t('Export to Excel')} actions={<PeriodFilter fy={period.fy} month={period.month} onChange={setPeriod} />}>
        <ul className="list-plain">
          {!exportList && <li><Loading error={exportError} /></li>}
          {exportList && !exports.length && <li className="muted">{t('Your role has no Excel exports.')}</li>}
          {exports.map((x) => (
            <li key={x.id}>
              <span><strong>{t(x.label)}</strong><div className="small muted">{x.desc ? t(x.desc) : null}</div></span>
              <a className="btn btn-sm" href={`/api${x.path}${x.period ? `?${q}` : ''}`}>{t('Download')}</a>
            </li>
          ))}
        </ul>
      </Card>
      {isAdmin && (
        <Card title={t('Backup')}>
          <p className="small muted" style={{ marginTop: 0 }}>{t('Download a full copy of the database. Keep backups somewhere safe (another drive or cloud storage).')}</p>
          <a className="btn" href="/api/backup">{t('Download database backup')}</a>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Temporary password: no look-alike characters, at least one letter and one digit. */
function generatePassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(letters), pick(digits)];
  while (chars.length < 10) chars.push(pick(letters + digits));
  return chars.sort(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 - 0.5).join('');
}

interface AssignedParty {
  id: number;
  name: string;
  tin?: string | null;
  rights?: Record<string, boolean>;
}

/** A user row as listed by GET /users. */
interface UserRow {
  id: number;
  username: string;
  full_name: string;
  role?: string;
  role_label?: string;
  role_id?: number | string;
  active: boolean;
  access_all_parties?: boolean;
  party_id?: number | null;
  company_name?: string;
  must_change_password?: boolean;
  assigned_parties?: AssignedParty[];
  assigned_party_ids?: number[];
  last_login?: string | null;
  created_at: string;
}

interface Role {
  id: number;
  name: string;
  label: string;
  description?: string;
  permissions?: Record<string, Record<string, boolean>>;
  is_system?: boolean;
  user_count?: number;
}

/** Transient edit/create state for `UserModal`; kept loose since the rights map is keyed dynamically by party id. */
interface UserForm {
  username: string;
  full_name: string;
  role_id: number | string;
  role: string;
  active: boolean;
  password: string;
  access_all_parties: boolean;
  party_ids: number[];
  party_rights: Record<string, any>;
}

interface UserModalProps {
  user: UserRow | null;
  onClose: () => void;
  onSaved: (u: any) => void;
}

function UserModal({ user, onClose, onSaved }: UserModalProps) {
  const toast = useToast();
  const { t } = useT();
  const { isAdmin, user: me, can } = useSession();
  // Editing an account is split into two role tasks; a new account needs only users/create.
  const mayUpdateAccount = !user || can('users', 'edit', 'update_user');
  const mayAssign = !user || can('users', 'edit', 'assign_roles_companies');
  const { data: rolesData } = useFetch<Role[]>('/roles');
  const { data: partiesData } = useFetch<Party[]>('/parties');
  // Only administrators can hand out the Administrator role; the company list is already limited to the
  // companies the signed-in user can see.
  const roles = (rolesData || []).filter((r) => isAdmin || r.name !== 'admin' || r.id === user?.role_id);
  const parties = partiesData || [];
  const restrictedActor = !isAdmin && !!me && !me.access_all_parties;
  const companyAccount = !!user?.party_id;

  const [f, setF] = useState<UserForm>(user ? {
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
        setF((prev) => ({ ...prev, role_id: user.role_id as number | string }));
      } else if (user?.role) {
        const found = roles.find((r) => r.name === user.role);
        if (found) setF((prev) => ({ ...prev, role_id: found.id }));
      } else {
        const defaultRole = roles.find((r) => r.name === 'viewer') || roles[0];
        if (defaultRole) setF((prev) => ({ ...prev, role_id: defaultRole.id, role: defaultRole.name }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, user]);

  const [partySearch, setPartySearch] = useState('');
  const [partyTypeFilter, setPartyTypeFilter] = useState('All');
  const [err, setErr] = useState<Record<string, string>>({});

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

  const toggleParty = (id: number) => {
    if (!mayAssign) return;
    setF((prev) => {
      const exists = prev.party_ids.includes(id);
      return {
        ...prev,
        party_ids: exists ? prev.party_ids.filter((x) => x !== id) : [...prev.party_ids, id],
      };
    });
  };

  const selectAllFiltered = () => {
    if (!mayAssign) return;
    const idsToAdd = filteredParties.map((p) => p.id);
    setF((prev) => ({
      ...prev,
      party_ids: [...new Set([...prev.party_ids, ...idsToAdd])],
    }));
  };

  // Rights for one assigned company. New selections start with everything the signed-in user may give.
  const giveable = (id: number): Record<string, boolean> => (restrictedActor ? (me?.party_rights?.[id] || { view: true }) : Object.fromEntries(COMPANY_RIGHTS.map((r) => [r.id, true])));
  const rightsFor = (id: number): Record<string, boolean> => f.party_rights?.[id] || giveable(id);
  const setRight = (id: number, right: string, on: boolean) => setF((prev) => {
    const next = { ...rightsFor(id), [right]: on };
    if (right === 'view' && !on) return prev; // seeing the company is the minimum; remove it to take access away
    if (on && right !== 'view') next.view = true;
    return { ...prev, party_rights: { ...prev.party_rights, [id]: next } };
  });

  const clearParties = () => {
    setF((prev) => ({ ...prev, party_ids: [] }));
  };

  const save = async () => {
    const problems: Record<string, string> = {};
    if (!companyAccount && !f.role_id) problems.role_id = t('Choose a role');
    if (!companyAccount && !f.access_all_parties && !f.party_ids.length) problems.party_ids = t('Choose at least one company, or give access to all companies');
    if (!user && (f.password || '').length < 8) problems.password = t('At least 8 characters');
    if (Object.keys(problems).length) { setErr({ ...problems, _: t('Please correct the highlighted fields') }); return; }
    try {
      const selectedRole = roles.find((r) => String(r.id) === String(f.role_id));
      // Only send what this user may change, so the API doesn't see untouched fields as a change.
      const body: Record<string, any> = {};
      if (mayUpdateAccount) {
        Object.assign(body, { full_name: f.full_name, active: f.active });
        if (f.password) body.password = f.password;
      }
      if (mayAssign) {
        Object.assign(body, {
          role_id: f.role_id ? +f.role_id : undefined,
          role: selectedRole ? selectedRole.name : f.role,
          access_all_parties: Boolean(f.access_all_parties),
          party_ids: f.access_all_parties ? [] : f.party_ids,
          party_rights: f.access_all_parties ? {} : Object.fromEntries(f.party_ids.map((id) => [id, rightsFor(id)])),
        });
      }
      if (!user) body.username = f.username;

      onSaved(user ? await api.put(`/users/${user.id}`, body) : await api.post('/users', body));
      toast(user
        ? (f.password ? t('User updated – they must choose a new password at their next sign-in') : t('User updated successfully'))
        : t('User {name} created – they choose their own password at first sign-in', { name: f.username }));
      onClose();
    } catch (e: any) {
      setErr({ ...(e.fields || {}), _: e.message });
    }
  };

  const roleOptions = roles.map((r) => ({
    value: String(r.id),
    label: `${t(r.label)}${r.description ? ` (${t(r.description)})` : ''}`,
  }));

  return (
    <Modal
      width={720}
      icon="users"
      title={user ? t('Edit {name}', { name: user.username }) : t('New user')}
      subtitle={user ? t('Update role, password and company access') : t('Create a sign-in and choose what this person can access')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{user ? t('Save changes') : t('Create user')}</button>
        </>
      }
    >
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginBottom: 16 }}>
        {!user && (
          <Field label={t('User name')} required error={err.username} hint={t('Used to sign in')}>
            <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus />
          </Field>
        )}
        <Field label={t('Full name')} required error={err.full_name} className={user ? 'span-4' : ''}>
          <input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} disabled={!mayUpdateAccount} />
        </Field>
        {!companyAccount && (
        <Field label={t('Role')} required className="span-4" error={err.role_id} hint={t('Decides the menus, pages and actions this user gets')}>
          <Select
            options={roleOptions}
            placeholder={rolesData ? t('Choose a role') : t('Loading roles…')}
            value={String(f.role_id)}
            disabled={!mayAssign}
            onChange={(v) => {
              const matched = roles.find((r) => String(r.id) === String(v));
              setF({ ...f, role_id: v, role: matched?.name || f.role });
            }}
          />
        </Field>
        )}
        {user && (
          <Field label={t('Account Status')}>
            <Select
              options={[{ value: '1', label: t('Active') }, { value: '0', label: t('Inactive / pending') }]}
              value={f.active ? '1' : '0'}
              disabled={!mayUpdateAccount}
              onChange={(v) => setF({ ...f, active: v === '1' })}
            />
          </Field>
        )}
        <Field
          label={user ? t('New password') : t('Password')}
          required={!user}
          error={err.password}
          hint={user
            ? t('Leave empty to keep the current password. A new one is temporary: the user must change it at the next sign-in.')
            : t('Temporary – the user must choose their own password at first sign-in. Give it to them privately.')}
          className={user ? '' : 'span-4'}
        >
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <PasswordInput
              className="grow"
              autoComplete="new-password"
              value={f.password}
              disabled={!mayUpdateAccount}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              placeholder={user ? t('Leave empty to keep current') : t('At least 8 characters')}
            />
            <button type="button" className="btn" disabled={!mayUpdateAccount} onClick={() => setF({ ...f, password: generatePassword() })} title={t('Generate a random temporary password')}>{t('Generate')}</button>
          </div>
        </Field>
      </div>

      {!companyAccount && (
      <fieldset disabled={!mayAssign} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: mayAssign ? 1 : 0.6 }}
        title={mayAssign ? undefined : t('Your role cannot assign roles or company access')}>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>{t('Company & Supplier Access')}</h3>
        <p className="small muted" style={{ margin: '0 0 12px' }}>
          {t('Assign whether this user has access to all companies or is restricted to specific suppliers/customers.')}
        </p>

        {err.party_ids && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err.party_ids}</div>}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: restrictedActor ? 'not-allowed' : 'pointer', marginBottom: 14, fontWeight: 600, opacity: restrictedActor ? 0.6 : 1 }}
          title={restrictedActor ? t('You can only give access to the companies assigned to you') : ''}>
          <input
            type="checkbox"
            className="perm-check"
            checked={f.access_all_parties}
            disabled={restrictedActor}
            onChange={(e) => setF({ ...f, access_all_parties: e.target.checked })}
          />
          <span>{t('Full Access to All Companies & Suppliers (Unrestricted)')}</span>
        </label>

        {!f.access_all_parties && (
          <div className="party-picker">
            <div className="party-picker-head">
              <input
                type="search"
                placeholder={t('Search suppliers & customers by name or TIN…')}
                value={partySearch}
                onChange={(e) => setPartySearch(e.target.value)}
                style={{ flex: 1, minWidth: 200, padding: '5px 9px' }}
              />
              <div className="row" style={{ gap: 4 }}>
                {['All', 'Supplier', 'Customer'].map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    className={`btn btn-sm ${partyTypeFilter === pt ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setPartyTypeFilter(pt)}
                  >
                    {pt === 'All' ? t('All') : t(`${pt}s`)}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={selectAllFiltered}>
                  {t('Select Filtered')}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={clearParties}>
                  {t('Clear')}
                </button>
              </div>
            </div>

            <div className="party-picker-list">
              {!filteredParties.length ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>
                  {t('No companies found matching search.')}
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
                        aria-label={t('Select {name}', { name: p.name })}
                      />
                      <div className="party-picker-info">
                        <div className="party-picker-name" title={p.name}>{p.name}</div>
                        <div className="party-picker-meta">
                          {p.tin ? <span>{t('TIN')} {p.tin}</span> : <span>{t('No TIN')}</span>}
                          <span>·</span>
                          <span>{t(p.type)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ padding: '8px 14px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">{f.party_ids.length === 1 ? t('1 company assigned') : t('{n} companies assigned', { n: f.party_ids.length })}</span>
              <span className="muted">{t('{n} total registered', { n: parties.length })}</span>
            </div>
          </div>
        )}

        {!f.access_all_parties && f.party_ids.length > 0 && (
          <div className="company-rights">
            <div className="company-rights-head">
              <strong>{t('Rights for each company')}</strong>
              <span className="small muted">{t('What this user may do with each company’s records – on top of what the role allows.')}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('Company')}</th>{COMPANY_RIGHTS.map((r) => <th key={r.id} className="center">{t(r.label)}</th>)}</tr>
                </thead>
                <tbody>
                  {f.party_ids.map((id) => {
                    const p = parties.find((x) => x.id === id) || (user?.assigned_parties || []).find((x) => x.id === id);
                    const rights = rightsFor(id);
                    const mayGive = giveable(id);
                    return (
                      <tr key={id}>
                        <td className="wrap"><strong>{p?.name || t('Company #{id}', { id })}</strong>{p?.tin && <div className="small muted">{t('TIN')} {p.tin}</div>}</td>
                        {COMPANY_RIGHTS.map((r) => (
                          <td key={r.id} className="center">
                            <input type="checkbox" className="perm-check" aria-label={`${t(r.label)} – ${p?.name || id}`}
                              checked={!!rights[r.id]} disabled={r.id === 'view' || !mayGive[r.id]}
                              title={r.id === 'view' ? t('Always included – remove the company to take access away') : !mayGive[r.id] ? t('You do not have this right for this company') : ''}
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
      </fieldset>
      )}
    </Modal>
  );
}

function UsersTab() {
  const toast = useToast();
  const { user: me, can, isAdmin } = useSession();
  const { t } = useT();
  const { data, error, setData } = useFetch<UserRow[]>('/users');
  const [editing, setEditing] = useState<UserRow | Record<string, never> | null>(null);

  const activate = async (u: UserRow) => {
    try {
      setData((await api.put(`/users/${u.id}`, { active: true })) as any);
      toast(t('{name} activated', { name: u.username }));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const remove = async (u: UserRow) => {
    if (!confirm(t('Delete user {name}?', { name: u.username }))) return;
    try {
      setData((await api.del(`/users/${u.id}`)) as any);
      toast(t('User deleted'));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const pending = (data || []).filter((u) => !u.active).length;

  return (
    <Card bodyClass="" title={t('Users')} actions={can('users', 'create') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ {t('New user')}</button>}>
      {pending > 0 && <div className="alert alert-info" style={{ margin: 16 }}>{pending > 1 ? t('{n} accounts are waiting for approval.', { n: pending }) : t('1 account is waiting for approval.')}</div>}
      {!data ? <Loading error={error} /> : (
        <table>
          <thead>
            <tr>
              <th>{t('User name')}</th>
              <th>{t('Full name')}</th>
              <th>{t('Role')}</th>
              <th>{t('Company Access')}</th>
              <th>{t('Status')}</th>
              <th>{t('Last sign-in')}</th>
              <th>{t('Created')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong>{u.id === me?.id && <span className="muted small"> ({t('you')})</span>}</td>
                <td>{u.full_name}</td>
                <td>
                  <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>
                    {t(u.role_label || (u.role === 'admin' ? 'Administrator' : 'User'))}
                  </Badge>
                </td>
                <td>
                  {u.party_id ? (
                    <span className="small"><Badge tone="info">{t('Own company only')}</Badge> {u.company_name}{u.must_change_password && <span className="muted"> · {t('must set password')}</span>}</span>
                  ) : u.access_all_parties ? (
                    <Badge tone="good">{t('All Companies (Full Access)')}</Badge>
                  ) : (
                    <span title={u.assigned_parties?.map((p) => `${p.name}: ${Object.entries(p.rights || {}).filter(([, on]) => on).map(([r]) => t(r[0].toUpperCase() + r.slice(1))).join(', ') || t('View')}`).join(' · ')}>
                      <Badge tone="warn">
                        {(u.assigned_parties?.length || 0) === 1 ? t('1 Company') : t('{n} Companies', { n: u.assigned_parties?.length || 0 })}
                      </Badge>
                    </span>
                  )}
                </td>
                <td>{u.active ? <Badge tone="good">{t('Active')}</Badge> : <Badge tone="warn">{t('Pending')}</Badge>}</td>
                <td>{u.last_login ? date(u.last_login) : <span className="muted">{t('Never')}</span>}</td>
                <td>{date(u.created_at)}</td>
                <td className="right">
                  {!u.active && can('users', 'edit', 'update_user') && <button className="btn btn-sm btn-primary" onClick={() => activate(u)}>{t('Activate')}</button>}
                  {(can('users', 'edit', 'update_user') || can('users', 'edit', 'assign_roles_companies')) && (isAdmin || u.role !== 'admin') && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)}>{t('Edit')}</button>}
                  {can('users', 'delete') && (isAdmin || u.role !== 'admin') && <button className="btn btn-sm btn-ghost" onClick={() => remove(u)} disabled={u.id === me?.id}>{t('Delete')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <UserModal user={'id' in editing ? (editing as UserRow) : null} onClose={() => setEditing(null)} onSaved={setData} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Roles & Permissions Tab
// ---------------------------------------------------------------------------
interface RoleResourceTask {
  id: string;
  label: string;
  right: string;
}

interface RoleResource {
  id: string;
  name: string;
  description?: string;
  tasks?: RoleResourceTask[];
}

interface RoleRight {
  id: string;
  label: string;
}

interface RoleResourcesResponse {
  resources: RoleResource[];
  rights: RoleRight[];
}

interface RoleForm {
  name: string;
  label: string;
  description: string;
  permissions: Record<string, Record<string, boolean>>;
}

interface RoleModalProps {
  role: Role | null;
  onClose: () => void;
  onSaved: (r: any) => void;
}

function RoleModal({ role, onClose, onSaved }: RoleModalProps) {
  const toast = useToast();
  const { t } = useT();
  const { isAdmin: mayEdit } = useSession();
  const { data: resData } = useFetch<RoleResourcesResponse>('/roles/resources');
  // Resources (with their tasks) and the right columns come from GET /roles/resources.
  const resources = resData?.resources || [];
  const rights = resData?.rights || [];

  const [f, setF] = useState<RoleForm>(role ? {
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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ users: true });
  const [err, setErr] = useState<Record<string, string>>({});
  const isSystem = Boolean(role?.is_system);
  const isAdminRole = role?.name === 'admin';

  const toggleAccordion = (resId: string) => {
    setExpanded((prev) => ({ ...prev, [resId]: !prev[resId] }));
  };

  const getResourceTasks = (res?: RoleResource): RoleResourceTask[] => {
    return res?.tasks || [];
  };

  const toggleRight = (resId: string, rightId: string) => {
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

  const toggleColumn = (rightId: string) => {
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

  const toggleGranularTask = (resId: string, task: RoleResourceTask) => {
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

  const setPreset = (type: 'all' | 'clear' | 'readonly' | 'tx') => {
    if (isAdminRole) return;
    const newPerms: Record<string, Record<string, boolean>> = {};
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
      toast(role ? t('Role updated successfully') : t('Role created successfully'));
      onSaved(res);
      onClose();
    } catch (e: any) {
      setErr({ ...(e.fields || {}), _: e.message });
    }
  };

  return (
    <Modal
      width={1020}
      title={role ? t('Edit Role: {name}', { name: t(role.label) }) : t('New Role')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          {mayEdit && role?.name !== 'admin' && <button className="btn btn-primary" onClick={save}>{t('Save Role')}</button>}
        </>
      }
    >
      {err._ && <div className="alert alert-error">{err._}</div>}

      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginBottom: 16 }}>
        <Field label={t('Role Label')} required error={err.label} hint={t('Display title for this role')}>
          <input
            value={f.label}
            onChange={(e) => setF({ ...f, label: e.target.value })}
            placeholder={t('e.g. Senior Auditor, Procurement Officer')}
            autoFocus
          />
        </Field>
        <Field
          label={t('Role Code')}
          required
          error={err.name}
          hint={isSystem ? t('System identifier (fixed)') : t('Unique identifier (letters, numbers, _)')}
        >
          <input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
            placeholder={t('e.g. auditor, purchase_lead')}
            disabled={isSystem}
          />
        </Field>
        <Field label={t('Description')} className="span-4" hint={t('Brief explanation of responsibilities and permissions')}>
          <input
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            placeholder={t('e.g. Manage user accounts, credentials, and company access...')}
          />
        </Field>
      </div>

      <div className="role-perm-section">
        <div className="role-perm-head-bar">
          <div className="role-perm-title-group">
            <span className="role-perm-bullet" />
            <h2 className="role-perm-title">{t('Role & access permissions')}</h2>
          </div>
          {!isAdminRole && (
            <div className="role-perm-presets">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('all')}>{t('Select All')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('readonly')}>{t('Read-Only')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('tx')}>{t('Transactions')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('clear')}>{t('Clear All')}</button>
            </div>
          )}
        </div>

        {isAdminRole && (
          <div className="alert alert-info" style={{ margin: '4px 0 10px 0' }}>
            <strong>{t('Administrator Role:')}</strong> {t('System administrator has full unrestricted permissions across all resources.')}
          </div>
        )}

        <div className="role-perm-card">
          <table className="role-perm-table">
            <thead>
              <tr>
                <th className="role-perm-th">
                  <span className="role-perm-th-label">{t('MODULE / RESOURCE')}</span>
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
                        <span>{t(rt.label)}</span>
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
                        <div className="role-perm-res-title">{t(res.name)}</div>
                        <button
                          type="button"
                          className="role-perm-accordion-toggle"
                          onClick={() => toggleAccordion(res.id)}
                          title={t('Click to view granular tasks & actions')}
                        >
                          <span className={`role-perm-chevron-circle ${isExpanded ? 'open' : ''}`}>
                            ›
                          </span>
                          <span className="role-perm-res-desc">{res.description ? t(res.description) : null}</span>
                        </button>

                        {isExpanded && (
                          <div className="role-perm-granular-container">
                            <div className="role-perm-granular-header">
                              {t('Granular tasks & actions:')}
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
                                    <span>{t(task.label)}</span>
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
  const { t } = useT();
  const { data, error, setData } = useFetch<Role[]>('/roles');
  const [editing, setEditing] = useState<Role | Record<string, never> | null>(null);

  const remove = async (r: Role) => {
    if (r.is_system) {
      toast(t('System roles cannot be deleted'), 'error');
      return;
    }
    if ((r.user_count || 0) > 0) {
      toast(t('Cannot delete role: {n} user(s) are assigned to it', { n: r.user_count }), 'error');
      return;
    }
    if (!confirm(t('Delete role "{name}"?', { name: t(r.label) }))) return;
    try {
      await api.del(`/roles/${r.id}`);
      setData((prev) => (prev || []).filter((item) => item.id !== r.id));
      toast(t('Role deleted'));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const handleSaved = (savedRole: Role) => {
    setData((prev) => {
      const list = prev || [];
      const idx = list.findIndex((r) => r.id === savedRole.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = savedRole;
        return next;
      }
      return [...list, savedRole];
    });
  };

  return (
    <Card
      bodyClass=""
      title={t('Roles & Permissions')}
      actions={isAdmin ? <button className="btn btn-primary" onClick={() => setEditing({})}>+ {t('New role')}</button> : <span className="small muted">{t('Only administrators can change roles')}</span>}
    >
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <p className="small muted" style={{ margin: 0 }}>
          {t('Manage access levels and fine-grained permissions for users. Built-in system roles provide standard profiles, while custom roles allow assigning exact rights per resource table (View, Create, Edit, Delete, Export).')}
        </p>
      </div>

      {!data ? (
        <Loading error={error} />
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('Role')}</th>
              <th>{t('Code')}</th>
              <th>{t('Description')}</th>
              <th>{t('Users')}</th>
              <th>{t('Type')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{t(r.label)}</strong>
                </td>
                <td className="muted small font-mono">{r.name}</td>
                <td className="wrap">{r.description ? t(r.description) : <span className="muted">—</span>}</td>
                <td>
                  <Badge tone={(r.user_count || 0) > 0 ? 'good' : 'neutral'}>
                    {r.user_count === 1 ? t('1 user') : t('{n} users', { n: r.user_count ?? 0 })}
                  </Badge>
                </td>
                <td>
                  {r.is_system ? <Badge tone="info">{t('System')}</Badge> : <Badge tone="neutral">{t('Custom')}</Badge>}
                </td>
                <td className="right">
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(r)}>
                    {r.name === 'admin' || !isAdmin ? t('View') : t('Edit')}
                  </button>
                  {!r.is_system && isAdmin && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => remove(r)}
                      disabled={(r.user_count || 0) > 0}
                      title={(r.user_count || 0) > 0 ? t('Cannot delete role with assigned users') : t('Delete role')}
                    >
                      {t('Delete')}
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
          role={'id' in editing ? (editing as Role) : null}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
const ACTION_TONE: Record<string, string | undefined> = { create: 'good', update: 'info', delete: 'bad', other: undefined };

const fmtVal = (v: unknown, t: (s: string) => string) => {
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  if (typeof v === 'boolean') return v ? t('Yes') : t('No');
  return String(v);
};

interface EntityDef {
  id: string;
  label: string;
}

/** A row from GET /audit: who did what, and (when recorded) the before/after field values. */
interface ActivityEntry {
  id: number;
  at: string;
  username?: string | null;
  action: string;
  entity: string;
  summary: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
}

/** Union of before/after keys, one row per field; complex (object/array) values fall back to JSON. */
function ChangesModal({ entry, onClose }: { entry: ActivityEntry; onClose: () => void }) {
  const { t } = useT();
  const before = entry.before || {};
  const after = entry.after || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return (
    <Modal title={t('Changes')} subtitle={entry.summary} icon="clock" onClose={onClose} width={720}
      footer={<button className="btn" onClick={onClose}>{t('Close')}</button>}>
      {!keys.length ? <div className="empty">{t('No field-level changes recorded for this entry.')}</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('Field')}</th><th>{t('Before')}</th><th>{t('After')}</th></tr></thead>
            <tbody>
              {keys.map((k) => {
                const bv = before[k];
                const av = after[k];
                const changed = JSON.stringify(bv) !== JSON.stringify(av);
                const complex = (bv && typeof bv === 'object') || (av && typeof av === 'object');
                const renderCell = (v: unknown) => {
                  if (complex) {
                    return v && typeof v === 'object'
                      ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(v, null, 2)}</pre>
                      : fmtVal(v, t);
                  }
                  return fmtVal(v, t);
                };
                return (
                  <tr key={k} style={!changed ? { opacity: 0.55 } : undefined}>
                    <td><strong>{k}</strong></td>
                    <td className="wrap">{renderCell(bv)}</td>
                    <td className="wrap" style={changed ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>
                      {renderCell(av)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function ActivityTab() {
  // Areas the log records, for the filter and the "Area" column (GET /audit/entities).
  const { t } = useT();
  const { data: entities } = useFetch<EntityDef[]>('/audit/entities');
  const entityLabel = Object.fromEntries((entities || []).map((e) => [e.id, e.label]));
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSearch(q), 250); return () => clearTimeout(timer); }, [q]);
  const { data, error } = useFetch<ActivityEntry[]>(`/audit?limit=500${entity ? `&entity=${entity}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`);
  const [viewing, setViewing] = useState<ActivityEntry | null>(null);
  return (
    <Card fill bodyClass="" title={(
      <div className="row">
        <input type="search" placeholder={t('Search activity or user…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label={t('Area')}>
          <option value="">{t('All areas')}</option>
          {(entities || []).map((e) => <option key={e.id} value={e.id}>{t(e.label)}</option>)}
        </select>
      </div>
    )} actions={<span className="small muted">{t('Latest 500 entries')}</span>}>
      {!data ? <Loading error={error} /> : !data.length ? <div className="empty">{t('No activity recorded yet.')}</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('When')}</th><th>{t('User')}</th><th>{t('Action')}</th><th>{t('Area')}</th><th>{t('What happened')}</th><th /></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="small">{dateTime(a.at)}</td>
                  <td>{a.username || <span className="muted">—</span>}</td>
                  <td><Badge tone={ACTION_TONE[a.action]}>{t(a.action)}</Badge></td>
                  <td className="small">{t(entityLabel[a.entity] || a.entity)}</td>
                  <td className="wrap">{a.summary}</td>
                  <td className="right">
                    {(a.before || a.after) && <button className="btn btn-sm btn-ghost" onClick={() => setViewing(a)}>{t('View changes')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewing && <ChangesModal entry={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}


function Settings() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useSession();
  const { t } = useT();
  const tabs = settingsTabsFor(user);
  const tab = tabs.some((x) => x.id === params.get('tab')) ? params.get('tab') : tabs[0]?.id;
  if (!user) return null;
  return (
    <>
      <PageHeader title={t('Settings')} subtitle={t('Company details, tax rules, dropdown lists and data export')} />
      <div className="tabs">
        {tabs.map((x) => (
          <button key={x.id} className={`tab ${tab === x.id ? 'active' : ''}`} onClick={() => router.replace(`/settings?tab=${x.id}`)}>{t(x.label)}</button>
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
