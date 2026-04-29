import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { Role } from './generated/prisma/client';
import { StudentsService } from './students.service';

type AuthenticatedRequest = Request & { user?: { sub: string; role: string } };

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  async listStudents(
    @Query()
    query: {
      q?: string;
      source?: string;
      academicYear?: string;
      pendingLocationOnly?: string;
      page?: string;
      pageSize?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.studentsService.listStudents(
      {
        q: query.q,
        source: query.source,
        academicYear: query.academicYear,
        pendingLocationOnly: query.pendingLocationOnly,
        page: query.page,
        pageSize: query.pageSize,
      },
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }
}