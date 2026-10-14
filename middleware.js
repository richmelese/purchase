// Page access: everything except the sign-in pages needs a session (checked against the API).
// Data is protected by the API itself; this only decides which page the browser is sent to.
import { NextResponse } from 'next/server';
import { sessionUser } from '@/lib/server/backend';
import { canOpenPage } from '@/lib/permissions';

const PUBLIC_PAGES = new Set(['/login', '/signup', '/forgot-password']);

// Redirect on the host the browser actually used (LAN address, reverse proxy…), not Next's own hostname.
function redirect(request, location) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  return NextResponse.redirect(new URL(location, `${proto}://${host}`));
}

export async function middleware(request) {
  const { pathname, search } = request.nextUrl;
  const user = await sessionUser(request.headers.get('cookie'));

  if (PUBLIC_PAGES.has(pathname)) {
    return user && pathname !== '/forgot-password' ? redirect(request, '/') : NextResponse.next();
  }
  // `undefined` = API unreachable: render the page; its API calls will show the error.
  if (user === null) {
    return redirect(request, pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname + search)}`);
  }
  if (user) {
    // Generated / reset password: nothing else until a new one is chosen.
    if (user.must_change_password && pathname !== '/change-password') return redirect(request, '/change-password');
    // Company accounts live in the company portal; staff never see it.
    const portal = pathname === '/portal' || pathname.startsWith('/portal/');
    if (user.party_id && !portal && pathname !== '/change-password') return redirect(request, '/portal');
    if (!user.party_id && portal) return redirect(request, '/');
    // Pages the user's role does not allow go back to the dashboard (the API refuses their data anyway).
    if (!user.party_id && !portal && !canOpenPage(user, pathname, request.nextUrl.searchParams.get('tab'))) {
      return redirect(request, `/?denied=${encodeURIComponent(pathname)}`);
    }
  }
  return NextResponse.next();
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!api/|_next/|favicon\\.ico|.*\\.(?:png|jpe?g|svg|ico|webp|css|js|map|txt|woff2?)$).*)'],
};
