import { BadRequestException, Body, Controller, Get, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { SystemSettingsService } from './system-settings.service';
import { Role } from './generated/prisma/client';

type AuthenticatedRequest = Request & { user?: { sub: string; role: string } };

const bannerUploadDir = join(process.cwd(), '.tmp', 'public', 'settings-banners');
mkdirSync(bannerUploadDir, { recursive: true });

function getBannerFileExtension(file: { originalname?: string; mimetype?: string }) {
  const originalExtension = extname(file.originalname || '').toLowerCase();
  if (originalExtension) {
    return originalExtension;
  }

  if (file.mimetype === 'image/png') {
    return '.png';
  }

  if (file.mimetype === 'image/webp') {
    return '.webp';
  }

  return '.jpg';
}

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Get()
  async getSettings() {
    return this.systemSettingsService.getSettings();
  }

  @Patch()
  async updateSettings(
    @Body() body: UpdateSystemSettingsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.systemSettingsService.updateSettings(
      body,
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }

  @Post('banner')
  @UseInterceptors(
    FileInterceptor('banner', {
      storage: diskStorage({
        destination: bannerUploadDir,
        filename: (_req, file, callback) => {
          const extension = getBannerFileExtension(file);
          callback(null, `banner-${Date.now()}-${Math.round(Math.random() * 1_000_000_000)}${extension}`);
        },
      }),
      fileFilter: (_req, file, callback) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          callback(new BadRequestException('Only JPG, PNG, and WEBP images are allowed'), false);
          return;
        }

        callback(null, true);
      },
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
      },
    }),
  )
  async uploadBanner(
    @UploadedFile() file: any,
    @Body('target') target: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException('Banner file is required');
    }

    if (target !== 'student-search' && target !== 'student-exam') {
      throw new BadRequestException('target must be either student-search or student-exam');
    }

    return this.systemSettingsService.uploadBanner(
      target,
      `/uploads/settings-banners/${file.filename}`,
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }
}