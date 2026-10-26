import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { PartiesService, type PartyDto } from './parties.service';

@Controller('api/parties')
@UseGuards(AuthGuard)
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  @RequirePermission('parties', 'view')
  list(@Query('type') type?: string, @Query('q') q?: string) {
    return this.parties.list(type, q);
  }

  @Get('profile-template')
  @RequirePermission('parties', 'view')
  profileTemplate() {
    return this.parties.profileTemplate();
  }

  @Get(':id')
  @RequirePermission('parties', 'view')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.parties.getOne(id);
  }

  @Post()
  @RequirePermission('parties', 'create')
  create(@Body() body: PartyDto, @CurrentUser() user: AuthUser) {
    return this.parties.create(body, user);
  }

  @Put(':id')
  @RequirePermission('parties', 'edit')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: PartyDto, @CurrentUser() user: AuthUser) {
    return this.parties.update(id, body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('parties', 'delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    this.parties.remove(id, user);
  }

  @Post(':id/account')
  @RequirePermission('parties', 'edit')
  account(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.parties.generateAccount(id, user);
  }

  @Get(':id/statement')
  @RequirePermission('parties', 'view')
  statement(@Param('id', ParseIntPipe) id: number) {
    return this.parties.statement(id);
  }
}
