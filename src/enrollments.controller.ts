import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { EnrollmentStatus, Role } from './generated/prisma/client';
import { EnrollmentsService } from './enrollments.service';

type AuthenticatedRequest = Request & { user?: { sub: string; role: string } };

@Controller('enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Get()
  async listEnrollments(@Req() req: AuthenticatedRequest) {
    return this.enrollmentsService.listEnrollments(
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }

  @Patch(':id/status')
  async updateEnrollmentStatus(
    @Param('id') id: string,
    @Body() body: { status?: EnrollmentStatus },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.enrollmentsService.updateEnrollmentStatus(
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