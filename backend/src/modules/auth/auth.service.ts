import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { hashPassword, verifyPassword } from '../../common/password';
import { loadFullUser, type FullUser } from '../../common/user-loader';

const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const IP_ATTEMPT_LIMIT = 5;
const GLOBAL_ATTEMPT_LIMIT = 20;

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService) {}

  hasUsers(): boolean {
    return !!this.db.get('SELECT 1 FROM users LIMIT 1');
  }

  signup(fullName: string, username: string, password: string) {
    const fields: Record<string, string> = {};
    if (!fullName?.trim()) fields.full_name = 'Required';
    if (!username?.trim()) fields.username = 'Required';
    if (!password || password.length < 8) fields.password = 'At least 8 characters';
    if (username && this.db.get('SELECT 1 FROM users WHERE username = ?', [username.trim()])) {
      fields.username = 'That user name is already taken';
    }
    if (Object.keys(fields).length) throw new BadRequestException({ error: 'Please check the form', fields });

    const first = !this.hasUsers();
    const roleName = first ? 'admin' : 'viewer';
    const role = this.db.get<{ id: number }>('SELECT id FROM roles WHERE name = ?', [roleName]);
    const status = first ? 1 : 0;
    const result = this.db.run(
      'INSERT INTO users (full_name, username, password_hash, role_id, active) VALUES (?, ?, ?, ?, ?)',
      [fullName.trim(), username.trim(), hashPassword(password), role?.id ?? null, status],
    );
    return { first, id: Number(result.lastInsertRowid) };
  }

  login(username: string, password: string, ip: string): FullUser & { password_hash: string } {
    const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
    const byIp = this.db.get<{ n: number }>(
      'SELECT COUNT(*) n FROM login_attempts WHERE username = ? AND ip = ? AND success = 0 AND created_at > ?',
      [username, ip, windowStart],
    );
    const global = this.db.get<{ n: number }>(
      'SELECT COUNT(*) n FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ?',
      [username, windowStart],
    );
    if ((byIp?.n ?? 0) >= IP_ATTEMPT_LIMIT || (global?.n ?? 0) >= GLOBAL_ATTEMPT_LIMIT) {
      throw new ForbiddenException('Too many failed attempts. Try again in a few minutes.');
    }

    const row = this.db.get<{ id: number; password_hash: string; active: number }>(
      'SELECT id, password_hash, active FROM users WHERE username = ?', [username],
    );
    const ok = row && verifyPassword(password, row.password_hash);
    if (!ok) {
      this.db.run('INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, 0)', [username, ip]);
      throw new UnauthorizedException('Invalid user name or password');
    }
    if (!row.active) {
      throw new ForbiddenException('Your account is pending activation by an administrator');
    }
    this.db.run('DELETE FROM login_attempts WHERE username = ?', [username]);
    this.db.run('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?', [row.id]);
    return loadFullUser(this.db, row.id)!;
  }

  changePassword(user: FullUser, currentPassword: string, newPassword: string) {
    const row = this.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      throw new BadRequestException({ error: 'Current password is incorrect', fields: { current_password: 'Incorrect' } });
    }
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException({ error: 'The new password must have at least 8 characters', fields: { password: 'At least 8 characters' } });
    }
    this.db.run(
      "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?",
      [hashPassword(newPassword), user.id],
    );
  }
}
