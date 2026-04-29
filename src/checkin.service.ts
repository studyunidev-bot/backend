import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CheckInStatus, SystemKey } from './generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';

const EIGHT_DIGIT_BARCODE_PATTERN = /^\d{8}$/;

@Injectable()
export class CheckInService {
  constructor(private readonly prisma: PrismaService) {}

  private getCurrentAcademicYear() {
    return new Date().getFullYear();
  }

  private normalizeRound(value: unknown) {
    return String(value ?? 'MORNING').toUpperCase() === 'AFTERNOON'
      ? 'AFTERNOON'
      : 'MORNING';
  }

  private async buildSessionState(session: {
    id: string;
    name: string;
    academicYear: number;
    examRound: string;
    startedAt: Date;
    isActive: boolean;
    examLocationId: string | null;
  }) {
    const [checkedInCount, recentCheckIns] = await Promise.all([
      this.prisma.checkIn.count({
        where: { sessionId: session.id },
      }),
      this.prisma.checkIn.findMany({
        where: { sessionId: session.id },
        orderBy: { scannedAt: 'desc' },
        take: 10,
        include: {
          enrollment: {
            include: {
              student: true,
              examLocation: true,
            },
          },
        },
      }),
    ]);

    return {
      session,
      checkedInCount,
      recentCheckIns: recentCheckIns.map((checkIn) => ({
        id: checkIn.id,
        scannedAt: checkIn.scannedAt,
        barcode: checkIn.barcode,
        studentName:
          `${checkIn.enrollment.student?.firstNameTh ?? ''} ${checkIn.enrollment.student?.lastNameTh ?? ''}`.trim() ||
          'ไม่ทราบชื่อ',
        nationalId: checkIn.enrollment.student?.nationalId ?? null,
        locationName: checkIn.enrollment.examLocation?.name ?? null,
        locationProvince: checkIn.enrollment.examLocation?.province ?? null,
      })),
    };
  }

  async getCurrentSession(query: any) {
    if (!query.scannerUserId) {
      throw new BadRequestException('scannerUserId is required');
    }

    const currentAcademicYear = this.getCurrentAcademicYear();
    const round = query.examRound ? this.normalizeRound(query.examRound) : undefined;

    const session = await this.prisma.checkInSession.findFirst({
      where: {
        createdById: query.scannerUserId,
        academicYear: currentAcademicYear,
        isActive: true,
        ...(round ? { examRound: round } : {}),
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!session) {
      return {
        currentAcademicYear,
        session: null,
        checkedInCount: 0,
        recentCheckIns: [],
      };
    }

    return {
      currentAcademicYear,
      ...(await this.buildSessionState(session)),
    };
  }

  async startNewSession(body: any) {
    const academicYear = this.getCurrentAcademicYear();

    if (!body.createdById) {
      throw new BadRequestException('createdById is required');
    }

    const round = this.normalizeRound(body.examRound);
    const name = body.name || `Session ${academicYear} ${round} ${new Date().toISOString()}`;

    const [, session] = await this.prisma.$transaction([
      this.prisma.checkInSession.updateMany({
        where: {
          isActive: true,
          academicYear,
          createdById: body.createdById,
        },
        data: {
          isActive: false,
          endedAt: new Date(),
        },
      }),
      this.prisma.checkInSession.create({
        data: {
          name,
          academicYear,
          examRound: round,
          examLocationId: body.examLocationId,
          createdById: body.createdById,
          isActive: true,
        },
      }),
    ]);

    return session;
  }

  async checkIn(body: any) {
    await this.assertCheckInOpen();

    const barcode = String(body.barcode ?? '')
      .replace(/\D/g, '')
      .trim();

    if (!barcode) {
      throw new BadRequestException('barcode is required');
    }

    if (!EIGHT_DIGIT_BARCODE_PATTERN.test(barcode)) {
      throw new BadRequestException('barcode must be exactly 8 digits');
    }

    const currentAcademicYear = this.getCurrentAcademicYear();

    if (!body.scannerUserId) {
      throw new BadRequestException('scannerUserId is required');
    }

    const session = body.sessionId
      ? await this.prisma.checkInSession.findUnique({ where: { id: body.sessionId } })
      : await this.prisma.checkInSession.findFirst({
          where: {
            createdById: body.scannerUserId,
            isActive: true,
            academicYear: currentAcademicYear,
          },
          orderBy: { startedAt: 'desc' },
        });

    if (!session) {
      throw new NotFoundException('No active check-in session');
    }

    if (!session.isActive) {
      throw new NotFoundException('Selected check-in session is no longer active');
    }

    if (session.createdById !== body.scannerUserId) {
      throw new ForbiddenException('This check-in session belongs to another staff account');
    }

    if (session.academicYear !== currentAcademicYear) {
      throw new ForbiddenException('Check-in session is not for the current academic year');
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { barcode },
      include: { student: true, examLocation: true },
    });

    if (!enrollment) {
      throw new NotFoundException('Barcode not found');
    }

    if (enrollment.academicYear !== currentAcademicYear) {
      throw new ForbiddenException('Barcode is not valid for the current academic year');
    }

    if (enrollment.examRound !== session.examRound) {
      throw new ForbiddenException('Barcode does not belong to the active exam round');
    }

    if (session.examLocationId && enrollment.examLocationId !== session.examLocationId) {
      throw new ForbiddenException('Barcode does not belong to this check-in station');
    }

    try {
      const checkIn = await this.prisma.checkIn.create({
        data: {
          enrollmentId: enrollment.id,
          sessionId: session.id,
          barcode,
          status: CheckInStatus.SUCCESS,
          deviceId: body.deviceId,
          scannerUserId: body.scannerUserId,
          note: body.note,
        },
        include: {
          enrollment: {
            include: {
              student: true,
              examLocation: true,
            },
          },
          session: true,
        },
      });

      return {
        success: true,
        duplicate: false,
        checkIn,
      };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('This student already checked in for the active session');
      }

      throw error;
    }
  }

  private async assertCheckInOpen() {
    const settings = await this.prisma.systemSetting.upsert({
      where: { key: SystemKey.GENERAL },
      update: {},
      create: { key: SystemKey.GENERAL },
    });

    if (settings.isCheckInOpen === false) {
      throw new ForbiddenException('ขณะนี้ระบบ check-in ปิดอยู่ชั่วคราว');
    }
  }
}