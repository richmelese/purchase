'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch, Modal, Field, PasswordInput, useToast } from './ui';
import { useSession } from './session';
import Icon from './icons';
import { useT } from '@/lib/i18n';
import { canOpenPage, settingsTabsFor, NAV, visibleNav } from '@/lib/permissions';

// "Epiccenter Trading PLC" -> "ET"
const initialsOf = (name: string): string => name.replace(/\b(PLC|LTD|S\.?C)\b\.?/gi, '').split(/\s+/).filter(Boolean)
  .map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function SidebarContent() {
  const path = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams ? searchParams.get('tab') : null;
  const { data: settings } = useFetch<{ company_name?: string; company_tin?: string; vat_rate?: number; wh_rate?: number }>('/settings');
  const { user } = useSession();
  const { t } = useT();

  const isActive = (href: string): boolean => {
    if (href.includes('?tab=')) {
      const tab = href.split('?tab=')[1];
      return path === '/settings' && currentTab === tab;
    }
    if (href === '/settings') {
      return path === '/settings' && (!currentTab || currentTab === 'company');
    }
    if (href === '/') return path === '/';
    return path === href || path.startsWith(`${href}/`);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo" aria-hidden="true">{initialsOf(settings?.company_name || 'Purchase Sales')}</div>
        <div>
          <div className="brand-name">{settings?.company_name || t('Purchase & Sales')}</div>
          <div className="brand-sub">{settings?.company_tin ? t('TIN {tin}', { tin: settings.company_tin }) : t('Purchase & Sales Management')}</div>
        </div>
      </div>
      <nav className="nav">
        {visibleNav(user).map((n) => (n.group
          ? <div key={n.group} className="nav-group">{t(n.group)}</div>
          : (
            <Link key={n.href} href={n.href!} className={isActive(n.href!) ? 'active' : ''}>
              <span className="nav-icon"><Icon name={n.icon!} size={18} /></span>{t(n.label!)}
            </Link>
          )))}
      </nav>
      <UserMenu />
      <div className="sidebar-foot">{t('VAT {vat}% · WH {wh}%', { vat: Math.round((+(settings?.vat_rate ?? 0) || 0.15) * 100), wh: Math.round((+(settings?.wh_rate ?? 0) || 0.03) * 1000) / 10 })}</div>
    </aside>
  );
}

export default function Sidebar() {
  return (
    <Suspense fallback={<aside className="sidebar" />}>
      <SidebarContent />
    </Suspense>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { t } = useT();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = async () => {
    if (f.new_password !== f.confirm) { setErr({ confirm: t('Passwords do not match') }); return; }
    try {
      await api.post('/auth/password', f);
      toast(t('Password changed'));
      onClose();
    } catch (e: any) { setErr({ ...(e.fields || {}), _: e.message }); }
  };
  return (
    <Modal width={440} icon="key" title={t('Change password')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save}>{t('Change password')}</button></>}>
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="grid" style={{ gap: 12 }}>
        <Field label={t('Current password')} error={err.current_password && t(err.current_password)}><PasswordInput autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} autoFocus /></Field>
        <Field label={t('New password')} error={err.password && t(err.password)} hint={t('At least 8 characters')}><PasswordInput autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
        <Field label={t('Confirm new password')} error={err.confirm}><PasswordInput autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  const { t } = useT();
  const [pw, setPw] = useState(false);
  if (!user) return null;
  const initials = user.full_name ? user.full_name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() : 'U';
  const roleName = t((user as any).role_label || (user.role === 'admin' ? 'Administrator' : 'User'));
  const assignedParties = (user as any).assigned_parties as unknown[] | undefined;
  const scopeText = user.role === 'admin' || user.access_all_parties
    ? t('All companies')
    : assignedParties?.length === 1
      ? t('{n} assigned company', { n: 1 })
      : t('{n} assigned companies', { n: assignedParties?.length || 0 });

  return (
    <div className="user-box">
      <div className="user-avatar" aria-hidden="true">{initials}</div>
      <div className="user-info">
        <div className="user-name" title={user.full_name}>{user.full_name}</div>
        <div className="user-role" title={t('Role: {role} | Scope: {scope} | @{username}', { role: roleName, scope: scopeText, username: user.username })}>
          {roleName} · {scopeText}
        </div>
      </div>
      <div className="user-actions">
        <button className="side-btn" onClick={() => setPw(true)}><Icon name="key" size={14} />{t('Password')}</button>
        <button className="side-btn" onClick={logout}><Icon name="logout" size={14} />{t('Sign out')}</button>
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}

export { visibleNav, NAV };
