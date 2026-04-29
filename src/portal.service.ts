import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentSourceType,
  EnrollmentStatus,
  Prisma,
  SystemKey,
} from './generated/prisma/client';
import { ForfeitRequestStatus } from './generated/prisma/enums';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  private async findAcademicYearForfeitRequest(studentId: string, academicYear: number) {
    return this.prisma.forfeitRequest.findFirst({
      where: {
        enrollment: {
          studentId,
          academicYear,
          deletedAt: null,
        },
      },
      orderBy: [{ submittedAt: 'desc' }],
      select: {
        status: true,
        submittedAt: true,
      },
    });
  }

  private getAcademicYearForfeitRequestMap(
    enrollments: Array<{
      academicYear: number;
      forfeitRequest?: {
        status: ForfeitRequestStatus;
        submittedAt: Date;
      } | null;
    }>,
  ) {
    const requestsByAcademicYear = new Map<
      number,
      {
        status: ForfeitRequestStatus;
        submittedAt: Date;
      }
    >();

    for (const enrollment of enrollments) {
      if (!enrollment.forfeitRequest) {
        continue;
      }

      const existing = requestsByAcademicYear.get(enrollment.academicYear);
      if (!existing || existing.submittedAt < enrollment.forfeitRequest.submittedAt) {
        requestsByAcademicYear.set(enrollment.academicYear, enrollment.forfeitRequest);
      }
    }

    return requestsByAcademicYear;
  }

  async getStudentSearch(nationalId: string) {
    await this.assertUserPortalOpen();

    const normalizedNationalId = this.normalizeStudentIdentifier(nationalId);
    const student = await this.prisma.student.findFirst({
      where: {
        nationalId: {
          equals: normalizedNationalId,
          mode: 'insensitive',
        },
        deletedAt: null,
      },
      include: {
        enrollments: {
          where: { deletedAt: null },
          include: {
            examLocation: true,
            forfeitRequest: {
              select: {
                status: true,
                submittedAt: true,
              },
            },
          },
          orderBy: [{ academicYear: 'desc' }, { examRound: 'asc' }],
        },
      },
    });

    if (!student) {
      throw new NotFoundException('ไม่พบข้อมูล');
    }

    const academicYearForfeitRequests = this.getAcademicYearForfeitRequestMap(student.enrollments);

    return {
      student: this.mapStudent(student),
      applications: student.enrollments.map((enrollment) =>
        this.mapApplication(enrollment, academicYearForfeitRequests.get(enrollment.academicYear) || null),
      ),
    };
  }

  private normalizeStudentIdentifier(value: unknown) {
    return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  }

  async getApplicationDetail(applicationId: string) {
    await this.assertUserPortalOpen();

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        id: applicationId,
        deletedAt: null,
      },
      include: {
        student: true,
        examLocation: true,
        score: true,
        forfeitRequest: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException('Application not found');
    }

    const isSimulatedExam = enrollment.sourceType === EnrollmentSourceType.SIMULATED_EXCEL;

    const [overallCount, locationCount, settings, academicYearForfeitRequest] = await Promise.all([
      isSimulatedExam
        ? this.prisma.examLocation.aggregate({
            _sum: { seatCapacity: true },
            where: {
              active: true,
              province: {
                not: null,
              },
            },
          })
        : this.prisma.enrollment.count({
            where: {
              deletedAt: null,
              academicYear: enrollment.academicYear,
              examRound: enrollment.examRound,
              sourceType: enrollment.sourceType,
            },
          }),
      isSimulatedExam
        ? enrollment.examLocation?.province
          ? this.prisma.examLocation.aggregate({
              _sum: { seatCapacity: true },
              where: {
                active: true,
                province: enrollment.examLocation.province,
              },
            })
          : enrollment.examLocationId
            ? this.prisma.examLocation.aggregate({
                _sum: { seatCapacity: true },
                where: {
                  active: true,
                  id: enrollment.examLocationId,
                },
              })
            : Promise.resolve({ _sum: { seatCapacity: 0 } })
        : enrollment.examLocation?.province
          ? this.prisma.enrollment.count({
              where: {
                deletedAt: null,
                academicYear: enrollment.academicYear,
                examRound: enrollment.examRound,
                sourceType: enrollment.sourceType,
                examLocation: {
                  is: {
                    province: enrollment.examLocation.province,
                  },
                },
              },
            })
          : enrollment.examLocationId
            ? this.prisma.enrollment.count({
                where: {
                  deletedAt: null,
                  academicYear: enrollment.academicYear,
                  examRound: enrollment.examRound,
                  sourceType: enrollment.sourceType,
                  examLocationId: enrollment.examLocationId,
                },
              })
            : Promise.resolve(0),
      this.getGeneralSetting(),
      this.findAcademicYearForfeitRequest(enrollment.studentId, enrollment.academicYear),
    ]);

    const totalNationwide =
      typeof overallCount === 'number' ? overallCount : Number(overallCount._sum.seatCapacity || 0);
    const totalInVenue =
      typeof locationCount === 'number' ? locationCount : Number(locationCount._sum.seatCapacity || 0);

    return {
      student: this.mapStudent(enrollment.student),
      application: this.mapApplication(enrollment, academicYearForfeitRequest),
      scores: this.mapScores(enrollment.score, enrollment.examLocation?.province, totalNationwide, totalInVenue),
      schedule: this.buildSchedule(
        enrollment.sourceType,
        enrollment.examRound,
        enrollment.registrationStartAt ?? null,
        enrollment.registrationEndAt ?? null,
        enrollment.examLocation ?? null,
      ),
      settings: {
        googleDriveLink: settings.googleDriveLink || '',
        facebookPageLink: settings.facebookLink || '',
        lineOALink: settings.lineLink || '',
        studentSearchHeroBannerUrl: settings.studentSearchHeroBannerUrl || '',
        studentExamHeroBannerUrl: settings.studentExamHeroBannerUrl || '',
      },
    };
  }

  async getPublicSettings() {
    const settings = await this.getGeneralSetting();

    return {
      googleDriveLink: settings.googleDriveLink || '',
      facebookPageLink: settings.facebookLink || '',
      lineOALink: settings.lineLink || '',
      studentSearchHeroBannerUrl: settings.studentSearchHeroBannerUrl || '',
      studentExamHeroBannerUrl: settings.studentExamHeroBannerUrl || '',
      isUserPortalOpen: settings.isUserPortalOpen ?? true,
      isCheckInOpen: settings.isCheckInOpen ?? true,
      portalStatus: settings.isUserPortalOpen === false ? 'manually_closed' : 'open',
      announcement: settings.announcement || '',
    };
  }

  async forfeitApplication(
    applicationId: string,
    body: {
      reason?: string;
      fullName?: string;
      address?: string;
      phone?: string;
    },
  ) {
    await this.assertUserPortalOpen();

    const reason = String(body.reason ?? '').trim();
    const fullName = String(body.fullName ?? '').trim();
    const address = String(body.address ?? '').trim();
    const phone = String(body.phone ?? '').trim();

    if (!reason || !fullName || !address || !phone) {
      throw new BadRequestException('กรุณากรอกข้อมูลให้ครบถ้วน');
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        id: applicationId,
        deletedAt: null,
      },
      include: {
        student: true,
        examLocation: true,
        forfeitRequest: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException('Application not found');
    }

    const existingAcademicYearForfeitRequest = await this.findAcademicYearForfeitRequest(
      enrollment.studentId,
      enrollment.academicYear,
    );

    if (existingAcademicYearForfeitRequest) {
      throw new ConflictException('ปีการศึกษานี้ได้ส่งคำขอสละสิทธิ์แล้ว');
    }

    const updatedEnrollment = await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        notes: [
          'Forfeit request submitted from portal',
          `Name: ${fullName}`,
          `Phone: ${phone}`,
          `Address: ${address}`,
          `Reason: ${reason}`,
        ].join('\n'),
        forfeitRequest: {
          create: {
            status: ForfeitRequestStatus.PENDING,
            reason,
            fullName,
            address,
            phone,
          },
        },
      },
      include: {
        student: true,
        examLocation: true,
        forfeitRequest: true,
      },
    });

    return {
      success: true,
      message: 'ส่งข้อมูลการสละสิทธิ์เรียบร้อยแล้ว',
      application: this.mapApplication(updatedEnrollment),
    };
  }

  private async getGeneralSetting() {
    return this.prisma.systemSetting.upsert({
      where: { key: SystemKey.GENERAL },
      update: {},
      create: { key: SystemKey.GENERAL },
    });
  }

  private async assertUserPortalOpen() {
    const settings = await this.getGeneralSetting();

    if (settings.isUserPortalOpen === false) {
      throw new ForbiddenException('ขณะนี้ student portal ปิดอยู่ชั่วคราว');
    }

    return settings;
  }

  private mapStudent(student: {
    id: string;
    nationalId: string;
    firstNameTh: string;
    lastNameTh: string;
    firstNameEn?: string | null;
    lastNameEn?: string | null;
    email?: string | null;
    phone?: string | null;
  }) {
    return {
      id: student.id,
      nationalId: student.nationalId,
      firstName: student.firstNameTh,
      lastName: student.lastNameTh,
      firstNameEn: student.firstNameEn || '',
      lastNameEn: student.lastNameEn || '',
      email: student.email || '',
      phone: student.phone || '',
    };
  }

  private mapApplication(enrollment: {
    id: string;
    studentId: string;
    academicYear: number;
    examRound: string;
    importedExamRoundLabel?: string | null;
    status: EnrollmentStatus;
    sourceType: EnrollmentSourceType;
    barcode: string;
    registrationStartAt?: Date | null;
    registrationEndAt?: Date | null;
    registeredAt?: Date | null;
    createdAt: Date;
    student?: { nationalId: string };
    examLocation?: {
      name: string;
      province?: string | null;
      address?: string | null;
      eventDate?: Date | null;
      eventStartMinutes?: number | null;
      eventEndMinutes?: number | null;
    } | null;
    forfeitRequest?: {
      status: ForfeitRequestStatus;
      submittedAt: Date;
    } | null;
  },
  academicYearForfeitRequest?: {
    status: ForfeitRequestStatus;
    submittedAt: Date;
  } | null,
  ) {
    const isOnsiteReview = enrollment.sourceType === EnrollmentSourceType.ONSITE_EXCEL;
    const displayWindow = this.resolveDisplayWindow(
      enrollment.sourceType,
      enrollment.examRound,
      enrollment.registrationStartAt ?? null,
      enrollment.registrationEndAt ?? null,
      enrollment.registeredAt ?? null,
      enrollment.createdAt,
      enrollment.examLocation ?? null,
    );
    const eventDate = displayWindow.eventDate;
    const effectiveForfeitRequest = academicYearForfeitRequest || enrollment.forfeitRequest || null;
    const startLabel = displayWindow.start
      ? displayWindow.start.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
      : isOnsiteReview
        ? '08:00'
        : '09:00';
    const endLabel = displayWindow.end
      ? displayWindow.end.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
      : isOnsiteReview
        ? '09:30'
        : '12:00';
    const examRoundLabel = isOnsiteReview
      ? `รอบ${enrollment.examRound === 'MORNING' ? 'เช้า' : 'บ่าย'} : เวลา ${startLabel}-${endLabel} น.`
      : enrollment.importedExamRoundLabel?.trim() ||
        `รอบ${enrollment.examRound === 'MORNING' ? 'เช้า' : 'บ่าย'} : เวลา ${startLabel}-${endLabel} น.`;

    return {
      id: enrollment.id,
      studentId: enrollment.studentId,
      nationalId: enrollment.student?.nationalId || '',
      type: isOnsiteReview ? 'onsite-review' : 'simulated-exam',
      eventName: isOnsiteReview ? 'กิจกรรมติวเก็งข้อสอบ' : 'กิจกรรมสอบจำลองเสมือนจริง',
      location: enrollment.examLocation?.name || 'ยังไม่ระบุสนามสอบ',
      province: enrollment.examLocation?.province || '',
      address: enrollment.examLocation?.address || '',
      eventDate: eventDate.toISOString(),
      dressCode: isOnsiteReview ? 'ชุดนักเรียน ชุดพละ หรือชุดสุภาพ' : 'ชุดนักเรียน ชุดพละ หรือชุดสุภาพ',
      barcode: enrollment.barcode,
      status: this.mapEnrollmentStatus(enrollment.status),
      forfeitRequestStatus: this.mapForfeitRequestStatus(effectiveForfeitRequest?.status),
      forfeitRequestedAt: effectiveForfeitRequest?.submittedAt?.toISOString() || null,
      examRound: examRoundLabel,
    };
  }

  private mapEnrollmentStatus(status: EnrollmentStatus) {
    switch (status) {
      case EnrollmentStatus.DRAFT:
        return 'pending';
      case EnrollmentStatus.CANCELLED:
        return 'completed';
      default:
        return 'registered';
    }
  }

  private mapForfeitRequestStatus(status: ForfeitRequestStatus | undefined) {
    if (!status) {
      return null;
    }

    switch (status) {
      case ForfeitRequestStatus.IN_PROGRESS:
        return 'in_progress';
      case ForfeitRequestStatus.COMPLETED:
        return 'completed';
      default:
        return 'pending';
    }
  }

  private mapScores(
    score:
      | {
          id: string;
          tgat?: Prisma.Decimal | null;
          tgat1?: Prisma.Decimal | null;
          tgat2?: Prisma.Decimal | null;
          tgat3?: Prisma.Decimal | null;
          rankingOverall?: number | null;
          rankingLocation?: number | null;
          rankingOverallTgat1?: number | null;
          rankingLocationTgat1?: number | null;
          rankingOverallTgat2?: number | null;
          rankingLocationTgat2?: number | null;
          rankingOverallTgat3?: number | null;
          rankingLocationTgat3?: number | null;
        }
      | null,
    province: string | undefined | null,
    totalNationwide: number,
    totalInVenue: number,
  ) {
    if (!score) {
      return [];
    }

    const rows = [
      {
        examName: 'คะแนนสอบ TGAT ความถนัดทั่วไป',
        value: score.tgat,
        rankInVenue: score.rankingLocation,
        rankNationwide: score.rankingOverall,
      },
      {
        examName: 'TGAT 1 การสื่อสารภาษาอังกฤษ',
        value: score.tgat1,
        rankInVenue: score.rankingLocationTgat1 ?? score.rankingLocation,
        rankNationwide: score.rankingOverallTgat1 ?? score.rankingOverall,
      },
      {
        examName: 'TGAT 2 การคิดอย่างมีเหตุผล',
        value: score.tgat2,
        rankInVenue: score.rankingLocationTgat2 ?? score.rankingLocation,
        rankNationwide: score.rankingOverallTgat2 ?? score.rankingOverall,
      },
      {
        examName: 'TGAT 3 สมรรถนะการทำงาน',
        value: score.tgat3,
        rankInVenue: score.rankingLocationTgat3 ?? score.rankingLocation,
        rankNationwide: score.rankingOverallTgat3 ?? score.rankingOverall,
      },
    ];

    return rows
      .filter((row) => row.value !== null && row.value !== undefined)
      .map((row, index) => ({
        id: `${score.id}-${index}`,
        applicationId: score.id,
        nationalId: '',
        examName: row.examName,
        studentScore: Number(row.value),
        rankInVenue: row.rankInVenue ?? 0,
        rankNationwide: row.rankNationwide ?? 0,
        totalInVenue,
        totalNationwide,
        province: province || '',
      }));
  }

  private buildSchedule(
    sourceType: EnrollmentSourceType,
    examRound: string,
    registrationStartAt?: Date | null,
    registrationEndAt?: Date | null,
    examLocation?: {
      eventDate?: Date | null;
      eventStartMinutes?: number | null;
      eventEndMinutes?: number | null;
    } | null,
  ) {
    const isOnsiteReview = sourceType === EnrollmentSourceType.ONSITE_EXCEL;
    const simulatedWindow = this.resolveDisplayWindow(
      sourceType,
      examRound,
      registrationStartAt ?? null,
      registrationEndAt ?? null,
      null,
      new Date(),
      examLocation ?? null,
    );
    const simulatedTimeLabel = this.formatScheduleTimeRange(simulatedWindow.start, simulatedWindow.end) || '09.00-12.00 น.';

    return isOnsiteReview
      ? [
          { id: 1, time: '08.00 น. เป็นต้นไป', activity: 'ลงทะเบียนเข้าร่วมกิจกรรม' },
          { id: 2, time: '09.00-12.00 น.', activity: 'ติวเข้มวิชาการ TGAT1 การสื่อสารภาษาอังกฤษ' },
          { id: 3, time: '12.00-13.00 น.', activity: 'พักรับประทานอาหาร (ตามอัธยาศัย)' },
          { id: 4, time: '13.00-14.30 น.', activity: 'ติวเข้มวิชาการ TGAT2 การคิดอย่างมีเหตุผล' },
          { id: 5, time: '14.30-16.00 น.', activity: 'ติวเข้มวิชาการ TGAT3 สมรรถนะการทํางาน' },
        ]
      : [
          { id: 1, time: simulatedTimeLabel, activity: 'เข้าห้องสอบ' },
        ];
  }

  private formatScheduleTimeRange(start?: Date | null, end?: Date | null) {
    if (!start && !end) {
      return null;
    }

    const formatTime = (value: Date) =>
      value
        .toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
        .replace(':', '.');

    if (start && end) {
      return `${formatTime(start)}-${formatTime(end)} น.`;
    }

    return `${formatTime((start || end) as Date)} น.`;
  }

  private resolveDisplayWindow(
    sourceType: EnrollmentSourceType,
    examRound: string,
    registrationStartAt: Date | null,
    registrationEndAt: Date | null,
    registeredAt: Date | null,
    createdAt: Date,
    examLocation?: {
      eventDate?: Date | null;
      eventStartMinutes?: number | null;
      eventEndMinutes?: number | null;
    } | null,
  ) {
    const isOnsiteReview = sourceType === EnrollmentSourceType.ONSITE_EXCEL;

    if (isOnsiteReview) {
      return {
        eventDate: registrationStartAt || registeredAt || createdAt,
        start: registrationStartAt,
        end: registrationEndAt,
      };
    }

    if (examLocation?.eventDate) {
      if (examLocation.eventStartMinutes != null || examLocation.eventEndMinutes != null) {
        return this.buildWindowFromLocationMinutes(
          examLocation.eventDate,
          examLocation.eventStartMinutes,
          examLocation.eventEndMinutes,
        );
      }

      if (
        registrationStartAt &&
        registrationEndAt &&
        this.isSameCalendarDate(registrationStartAt, examLocation.eventDate)
      ) {
        return {
          eventDate: examLocation.eventDate,
          start: registrationStartAt,
          end: registrationEndAt,
        };
      }

      return this.buildDefaultSimulatedWindow(examLocation.eventDate, examRound);
    }

    return {
      eventDate: registrationStartAt || registeredAt || createdAt,
      start: registrationStartAt,
      end: registrationEndAt,
    };
  }

  private buildWindowFromLocationMinutes(
    eventDate: Date,
    startMinutes?: number | null,
    endMinutes?: number | null,
  ) {
    const fallbackStartMinutes = startMinutes ?? 9 * 60;
    const fallbackEndMinutes = endMinutes ?? fallbackStartMinutes + 180;
    const start = new Date(eventDate);
    const end = new Date(eventDate);

    start.setHours(Math.floor(fallbackStartMinutes / 60), fallbackStartMinutes % 60, 0, 0);
    end.setHours(Math.floor(fallbackEndMinutes / 60), fallbackEndMinutes % 60, 0, 0);

    return {
      eventDate,
      start,
      end,
    };
  }

  private buildDefaultSimulatedWindow(eventDate: Date, examRound: string) {
    const isAfternoon = examRound === 'AFTERNOON';
    const start = new Date(eventDate);
    const end = new Date(eventDate);

    if (isAfternoon) {
      start.setHours(13, 0, 0, 0);
      end.setHours(16, 0, 0, 0);
    } else {
      start.setHours(9, 0, 0, 0);
      end.setHours(12, 0, 0, 0);
    }

    return {
      eventDate,
      start,
      end,
    };
  }

  private isSameCalendarDate(left: Date, right: Date) {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }
}