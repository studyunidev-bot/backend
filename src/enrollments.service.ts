import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentSourceType, EnrollmentStatus, Role } from './generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';

type EnrollmentActor = { id: string; role: Role } | null;

@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listEnrollments(actor: EnrollmentActor) {
    this.assertActor(actor);

    const enrollments = await this.prisma.enrollment.findMany({
      where: { deletedAt: null },
      include: {
        student: true,
        examLocation: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return enrollments.map((enrollment) => this.mapEnrollment(enrollment));
  }

  async updateEnrollmentStatus(id: string, status: EnrollmentStatus | undefined, actor: EnrollmentActor) {
    this.assertActor(actor);

    if (!status) {
      throw new NotFoundException('Status is required');
    }

    const existing = await this.prisma.enrollment.findFirst({
      where: { id, deletedAt: null },
      include: {
        student: true,
        examLocation: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Enrollment not found');
    }

    const updated = await this.prisma.enrollment.update({
      where: { id },
      data: { status },
      include: {
        student: true,
        examLocation: true,
      },
    });

    return this.mapEnrollment(updated);
  }

  private assertActor(actor: EnrollmentActor) {
    if (
      !actor ||
      (actor.role !== Role.ADMIN && actor.role !== Role.SUPERADMIN && actor.role !== Role.STAFF)
    ) {
      throw new ForbiddenException('Authenticated ADMIN, SUPERADMIN, or STAFF is required');
    }
  }

  private mapEnrollment(enrollment: {
    id: string;
    academicYear: number;
    examRound: string;
    status: EnrollmentStatus;
    sourceType: EnrollmentSourceType;
    barcode: string;
    updatedAt: Date;
    student: {
      nationalId: string;
      firstNameTh: string;
      lastNameTh: string;
    };
    examLocation?: {
      name: string;
      province?: string | null;
    } | null;
  }) {
    return {
      id: enrollment.id,
      academicYear: enrollment.academicYear,
      examRound: enrollment.examRound,
      status: enrollment.status,
      barcode: enrollment.barcode,
      eventName: this.getEventName(enrollment.sourceType),
      nationalId: enrollment.student.nationalId,
      studentName: `${enrollment.student.firstNameTh} ${enrollment.student.lastNameTh}`.trim(),
      location: enrollment.examLocation?.name || '',
      province: enrollment.examLocation?.province || '',
      updatedAt: enrollment.updatedAt.toISOString(),
    };
  }

  private getEventName(sourceType: EnrollmentSourceType) {
    if (sourceType === EnrollmentSourceType.ONSITE_EXCEL) {
      return 'ติวเก็งข้อสอบ (รูปแบบ ON-SITE)';
    }

    if (sourceType === EnrollmentSourceType.SIMULATED_EXCEL) {
      return 'สอบจำลองเสมือนจริง';
    }

    return 'รายการสมัครจากระบบ';
  }
}