import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="nf-page">
      <div className="nf-card">
        <div className="nf-code">404</div>
        <h1>Page not found</h1>
        <p>The address you opened does not exist in Purchase &amp; Sales Management.</p>
        <div className="nf-links">
          <Link className="btn btn-primary" href="/">Go to dashboard</Link>
          <Link className="btn" href="/login">Sign in</Link>
          <Link className="btn" href="/settings?tab=users">Administration</Link>
        </div>
      </div>
    </div>
  );
}
