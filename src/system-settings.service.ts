import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { Role, SystemKey } from './generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';

type SettingsActor = { id: string; role: Role } | null;
type BannerTarget = 'student-search' | 'student-exam';

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    const settings = await this.getOrCreateSettings();

    return this.mapSettings(settings);
  }

  async updateSettings(body: UpdateSystemSettingsDto, actor: SettingsActor) {
    if (!actor || !this.isPrivilegedRole(actor.role)) {
      throw new ForbiddenException('Authenticated ADMIN, SUPERADMIN, or STAFF is required');
    }

    this.assertValidSettingsPayload(body);

    const currentSettings = await this.getOrCreateSettings();

    const settings = await this.prisma.systemSetting.update({
      where: { id: currentSettings.id },
      data: {
        googleDriveLink:
          typeof body.googleDriveLink === 'string' ? body.googleDriveLink.trim() || null : undefined,
        facebookLink:
          typeof body.facebookPageLink === 'string' ? body.facebookPageLink.trim() || null : undefined,
        lineLink: typeof body.lineOALink === 'string' ? body.lineOALink.trim() || null : undefined,
        studentSearchHeroBannerUrl:
          typeof body.studentSearchHeroBannerUrl === 'string'
            ? body.studentSearchHeroBannerUrl.trim() || null
            : undefined,
        studentExamHeroBannerUrl:
          typeof body.studentExamHeroBannerUrl === 'string'
            ? body.studentExamHeroBannerUrl.trim() || null
            : undefined,
        isUserPortalOpen:
          typeof body.isUserPortalOpen === 'boolean' ? body.isUserPortalOpen : undefined,
        isCheckInOpen: typeof body.isCheckInOpen === 'boolean' ? body.isCheckInOpen : undefined,
        announcement:
          body.announcement === null
            ? null
            : typeof body.announcement === 'string'
              ? body.announcement.trim() || null
              : undefined,
        updatedById: actor.id,
      },
    });

    return this.mapSettings(settings);
  }

  async uploadBanner(target: BannerTarget, bannerUrl: string, actor: SettingsActor) {
    if (!actor || !this.isPrivilegedRole(actor.role)) {
      throw new ForbiddenException('Authenticated ADMIN, SUPERADMIN, or STAFF is required');
    }

    if (typeof bannerUrl !== 'string' || !bannerUrl.trim()) {
      throw new BadRequestException('bannerUrl is required');
    }

    const currentSettings = await this.getOrCreateSettings();
    const trimmedBannerUrl = bannerUrl.trim();

    const settings = await this.prisma.systemSetting.update({
      where: { id: currentSettings.id },
      data: {
        studentSearchHeroBannerUrl:
          target === 'student-search' ? trimmedBannerUrl : undefined,
        studentExamHeroBannerUrl:
          target === 'student-exam' ? trimmedBannerUrl : undefined,
        updatedById: actor.id,
      },
    });

    return this.mapSettings(settings);
  }

  private isPrivilegedRole(role: Role) {
    return role === Role.ADMIN || role === Role.SUPERADMIN || role === Role.STAFF;
  }

  private assertValidSettingsPayload(body: UpdateSystemSettingsDto) {
    this.assertOptionalString(body.googleDriveLink, 'googleDriveLink');
    this.assertOptionalString(body.facebookPageLink, 'facebookPageLink');
    this.assertOptionalString(body.lineOALink, 'lineOALink');
    this.assertOptionalString(body.studentSearchHeroBannerUrl, 'studentSearchHeroBannerUrl');
    this.assertOptionalString(body.studentExamHeroBannerUrl, 'studentExamHeroBannerUrl');
    this.assertOptionalBoolean(body.isUserPortalOpen, 'isUserPortalOpen');
    this.assertOptionalBoolean(body.isCheckInOpen, 'isCheckInOpen');
    this.assertOptionalNullableString(body.announcement, 'announcement');
  }

  private assertOptionalBoolean(value: unknown, fieldName: string) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new BadRequestException(`${fieldName} must be a boolean`);
    }
  }

  private assertOptionalString(value: unknown, fieldName: string) {
    if (value !== undefined && typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} must be a string`);
    }
  }

  private assertOptionalNullableString(value: unknown, fieldName: string) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} must be a string or null`);
    }
  }

  private async getOrCreateSettings() {
    return this.prisma.systemSetting.upsert({
      where: { key: SystemKey.GENERAL },
      update: {},
      create: { key: SystemKey.GENERAL },
    });
  }

  private mapSettings(settings: {
    id: string;
    googleDriveLink?: string | null;
    facebookLink?: string | null;
    lineLink?: string | null;
    studentSearchHeroBannerUrl?: string | null;
    studentExamHeroBannerUrl?: string | null;
    isUserPortalOpen?: boolean | null;
    isCheckInOpen?: boolean | null;
    announcement?: string | null;
    updatedAt: Date;
  }) {
    return {
      googleDriveLink: settings.googleDriveLink || '',
      facebookPageLink: settings.facebookLink || '',
      lineOALink: settings.lineLink || '',
      studentSearchHeroBannerUrl: settings.studentSearchHeroBannerUrl || '',
      studentExamHeroBannerUrl: settings.studentExamHeroBannerUrl || '',
      isUserPortalOpen: settings.isUserPortalOpen ?? true,
      isCheckInOpen: settings.isCheckInOpen ?? true,
      announcement: settings.announcement || '',
      updatedAt: settings.updatedAt.toISOString(),
    };
  }
}