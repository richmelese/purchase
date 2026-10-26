'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch, Modal, Field, PasswordInput, useToast } from './ui';
import { useSession } from './session';
import Icon from './icons';
import { canOpenPage, settingsTabsFor, NAV, visibleNav } from '@/lib/permissions';

// "Epiccenter Trading PLC" -> "ET"
const initialsOf = (name) => name.replace(/\b(PLC|LTD|S\.?C)\b\.?/gi, '').split(/\s+/).filter(Boolean)
  .map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function SidebarContent() {
  const path = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams ? searchParams.get('tab') : null;
  const { data: settings } = useFetch('/settings');
  const { user } = useSession();

  const isActive = (href) => {
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
          <div className="brand-name">{settings?.company_name || 'Purchase & Sales'}</div>
          <div className="brand-sub">{settings?.company_tin ? `TIN ${settings.company_tin}` : 'Purchase & Sales Management'}</div>
        </div>
      </div>
      <nav className="nav">
        {visibleNav(user).map((n) => (n.group
          ? <div key={n.group} className="nav-group">{n.group}</div>
          : (
            <Link key={n.href} href={n.href} className={isActive(n.href) ? 'active' : ''}>
              <span className="nav-icon"><Icon name={n.icon} size={18} /></span>{n.label}
            </Link>
          )))}
      </nav>
      <UserMenu />
      <div className="sidebar-foot">VAT {Math.round((+settings?.vat_rate || 0.15) * 100)}% · WH {Math.round((+settings?.wh_rate || 0.03) * 1000) / 10}%</div>
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

function PasswordModal({ onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [err, setErr] = useState({});
  const save = async () => {
    if (f.new_password !== f.confirm) { setErr({ confirm: 'Passwords do not match' }); return; }
    try {
      await api.post('/auth/password', f);
      toast('Password changed');
      onClose();
    } catch (e) { setErr({ ...(e.fields || {}), _: e.message }); }
  };
  return (
    <Modal width={440} icon="key" title="Change password" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Change password</button></>}>
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="grid" style={{ gap: 12 }}>
        <Field label="Current password" error={err.current_password}><PasswordInput autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} autoFocus /></Field>
        <Field label="New password" error={err.password} hint="At least 8 characters"><PasswordInput autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
        <Field label="Confirm new password" error={err.confirm}><PasswordInput autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  const [pw, setPw] = useState(false);
  if (!user) return null;
  const initials = user.full_name ? user.full_name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() : 'U';
  const roleName = user.role_label || (user.role === 'admin' ? 'Administrator' : 'User');
  const scopeText = user.role === 'admin' || user.access_all_parties
    ? 'All companies'
    : `${user.assigned_parties?.length || 0} assigned ${user.assigned_parties?.length === 1 ? 'company' : 'companies'}`;

  return (
    <div className="user-box">
      <div className="user-avatar" aria-hidden="true">{initials}</div>
      <div className="user-info">
        <div className="user-name" title={user.full_name}>{user.full_name}</div>
        <div className="user-role" title={`Role: ${roleName} | Scope: ${scopeText} | @${user.username}`}>
          {roleName} · {scopeText}
        </div>
      </div>
      <div className="user-actions">
        <button className="side-btn" onClick={() => setPw(true)}><Icon name="key" size={14} />Password</button>
        <button className="side-btn" onClick={logout}><Icon name="logout" size={14} />Sign out</button>
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}

export { visibleNav, NAV };
