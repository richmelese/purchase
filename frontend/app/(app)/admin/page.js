import { redirect } from 'next/navigation';

// /admin → the administration area (users, activity log, dropdown lists, backup).
export default function AdminPage() {
  redirect('/settings?tab=users');
}
