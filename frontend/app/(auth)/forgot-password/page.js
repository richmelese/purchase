import Link from 'next/link';
import AuthShell from '@/components/AuthShell';

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="RESET">
      <p className="auth-note" style={{ marginTop: 0 }}>
        For security, passwords are reset by your system administrator. Ask an administrator to open
        {' '}<strong>Settings › Users</strong> and set a new password for your account.
      </p>
      <p className="auth-note">After you sign in, you can change it yourself with the <strong>Password</strong> button in the sidebar.</p>
      <Link className="auth-btn" href="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Back to sign in</Link>
    </AuthShell>
  );
}
