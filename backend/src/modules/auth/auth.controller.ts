import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { DatabaseService } from '../../db/database.service';
import { createSession, destroySession, clientIp } from '../../common/session';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { publicUser, type FullUser } from '../../common/user-loader';
import { logActivity } from '../../common/activity-log';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: DatabaseService) {}

  @Get('status')
  async status() {
    const company = await this.db.get<{ company_name: string }>('SELECT company_name FROM settings WHERE id = 1');
    return { hasUsers: await this.auth.hasUsers(), company_name: company?.company_name || '' };
  }

  @Post('signup')
  @HttpCode(200)
  async signup(@Body() body: { full_name: string; username: string; password: string }) {
    const result = await this.auth.signup(body.full_name, body.username, body.password);
    await logActivity(this.db, undefined, 'create', 'users', result.id, `signed up as ${body.username}${result.first ? ' (administrator)' : ' (pending activation)'}`);
    return { first: result.first };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { username: string; password: string; remember?: boolean }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(body.username, body.password, clientIp(req));
    await createSession(this.db, req, res, user.id, !!body.remember);
    await logActivity(this.db, user, 'other', 'auth', user.id, `${user.username} signed in`);
    return publicUser(user);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await destroySession(this.db, req, res);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  meRoute(@CurrentUser() user: FullUser) {
    return publicUser(user);
  }

  @Post('password')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async changePassword(@CurrentUser() user: FullUser, @Body() body: { current_password: string; new_password: string }) {
    await this.auth.changePassword(user, body.current_password, body.new_password);
    await logActivity(this.db, user, 'update', 'auth', user.id, `${user.username} changed their password`);
  }
}
