import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CheckInService } from './checkin.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { Role } from './generated/prisma/client';

@Controller('checkin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Get('session/current')
  @Roles(Role.CHECKIN, Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
  async getCurrentSession(
    @Query() query: any,
    @Req() req: Request & { user?: { sub: string } },
  ) {
    return this.checkInService.getCurrentSession({
      ...query,
      scannerUserId: req.user?.sub,
    });
  }

  @Post()
  @Roles(Role.CHECKIN, Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
  async checkIn(@Body() body: any, @Req() req: Request & { user?: { sub: string } }) {
    return this.checkInService.checkIn({
      ...body,
      scannerUserId: body.scannerUserId || req.user?.sub,
    });
  }

  @Post('session/start')
  @Roles(Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
  async startNewSession(@Body() body: any, @Req() req: Request & { user?: { sub: string } }) {
    return this.checkInService.startNewSession({
      ...body,
      createdById: body.createdById || req.user?.sub,
    });
  }
}