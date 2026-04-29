import { Body, Controller, Post, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Request } from 'express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ImportsService } from './imports.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { Role } from './generated/prisma/client';

const uploadDir = join(process.cwd(), '.tmp', 'imports');
const maxUploadFileSizeMb = Math.max(8, parseInt(process.env.IMPORT_UPLOAD_MAX_FILE_MB || '64', 10) || 64);
mkdirSync(uploadDir, { recursive: true });

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('excel')
  @Roles(Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'onsite', maxCount: 1 },
        { name: 'simulated', maxCount: 1 },
        { name: 'locations', maxCount: 1 },
      ],
      {
        dest: uploadDir,
        limits: {
          fileSize: maxUploadFileSizeMb * 1024 * 1024,
          files: 3,
        },
      },
    ),
  )
  async uploadExcelFiles(
    @UploadedFiles() files: any,
    @Body() body: any,
    @Req() req: Request & { user?: { sub: string } },
  ) {
    const payload = body ?? {};

    return this.importsService.importExcelFiles({
      academicYear: Number(payload.academicYear),
      onsiteRound: payload.onsiteRound,
      simulatedRound: payload.simulatedRound,
      examDate: payload.examDate,
      uploadedById: payload.uploadedById || req.user?.sub,
      files: files ?? {},
    });
  }
}