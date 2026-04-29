import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { ForfeitRequestStatus, Role } from './generated/prisma/client';
import { ForfeitRequestsService } from './forfeit-requests.service';

type AuthenticatedRequest = Request & { user?: { sub: string; role: string } };

@Controller('forfeit-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
export class ForfeitRequestsController {
  constructor(private readonly forfeitRequestsService: ForfeitRequestsService) {}

  @Get()
  async listRequests(@Req() req: AuthenticatedRequest) {
    return this.forfeitRequestsService.listRequests(
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }

  @Patch(':id/status')
  async updateRequestStatus(
    @Param('id') id: string,
    @Body() body: { status?: ForfeitRequestStatus },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.forfeitRequestsService.updateRequestStatus(
      id,
      body?.status,
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }
}