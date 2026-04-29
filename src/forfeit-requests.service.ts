import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EnrollmentSourceType,
  EnrollmentStatus,
  ForfeitRequestStatus,
  Role,
} from './generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';

type ForfeitActor = { id: string; role: Role } | null;

@Injectable()
export class ForfeitRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async listRequests(actor: ForfeitActor) {
    this.assertActor(actor);

    const requests = await this.prisma.forfeitRequest.findMany({
      include: {
        enrollment: {
          include: {
            student: true,
            examLocation: true,
          },
        },
      },
      orderBy: [{ submittedAt: 'desc' }],
    });

    return requests.map((request) => this.mapRequest(request));
  }

  async updateRequestStatus(id: string, status: ForfeitRequestStatus | undefined, actor: ForfeitActor) {
    this.assertActor(actor);

    if (!status) {
      throw new NotFoundException('Status is required');
    }

    const existing = await this.prisma.forfeitRequest.findUnique({
      where: { id },
      include: {
        enrollment: {
          include: {
            student: true,
            examLocation: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Forfeit request not found');
    }

    const updated = await this.prisma.forfeitRequest.update({
      where: { id },
      data: {
        status,
        processedById: actor?.id || undefined,
        processedAt: status === ForfeitRequestStatus.COMPLETED ? new Date() : existing.processedAt,
      },
      include: {
        enrollment: {
          include: {
            student: true,
            examLocation: true,
          },
        },
      },
    });

    if (status === ForfeitRequestStatus.COMPLETED && updated.enrollment.status !== EnrollmentStatus.CANCELLED) {
      await this.prisma.enrollment.update({
        where: { id: updated.enrollmentId },
        data: { status: EnrollmentStatus.CANCELLED },
      });
    }

    return this.mapRequest(updated);
  }

  private assertActor(actor: ForfeitActor) {
    if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.SUPERADMIN && actor.role !== Role.STAFF)) {
      throw new ForbiddenException('Authenticated ADMIN, SUPERADMIN, or STAFF is required');
    }
  }

  private mapRequest(request: {
    id: string;
    status: ForfeitRequestStatus;
    reason: string;
    fullName: string;
    address: string;
    phone: string;
    submittedAt: Date;
    processedAt?: Date | null;
    enrollment: {
      id: string;
      academicYear: number;
      examRound: string;
      barcode: string;
      sourceType: EnrollmentSourceType;
      student: {
        nationalId: string;
        firstNameTh: string;
        lastNameTh: string;
      };
      examLocation?: {
        name: string;
        province?: string | null;
      } | null;
    };
  }) {
    return {
      id: request.id,
      enrollmentId: request.enrollment.id,
      status: request.status,
      reason: request.reason,
      fullName: request.fullName,
      address: request.address,
      phone: request.phone,
      submittedAt: request.submittedAt.toISOString(),
      processedAt: request.processedAt?.toISOString() || null,
      academicYear: request.enrollment.academicYear,
      examRound: request.enrollment.examRound,
      barcode: request.enrollment.barcode,
      category: this.getCategory(request.enrollment.sourceType),
      eventName: this.getEventName(request.enrollment.sourceType),
      nationalId: request.enrollment.student.nationalId,
      studentName: `${request.enrollment.student.firstNameTh} ${request.enrollment.student.lastNameTh}`.trim(),
      location: request.enrollment.examLocation?.name || '',
      province: request.enrollment.examLocation?.province || '',
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

  private getCategory(sourceType: EnrollmentSourceType) {
    if (sourceType === EnrollmentSourceType.ONSITE_EXCEL) {
      return 'onsite-review';
    }

    if (sourceType === EnrollmentSourceType.SIMULATED_EXCEL) {
      return 'simulated-exam';
    }

    return 'other';
  }
}