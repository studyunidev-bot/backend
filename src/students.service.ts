import { ForbiddenException, Injectable } from '@nestjs/common';
import { EnrollmentSourceType, EnrollmentStatus, Prisma, Role } from './generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';

type StudentActor = { id: string; role: Role } | null;

type StudentListQuery = {
  q?: string;
  source?: string;
  academicYear?: string;
  pendingLocationOnly?: string;
  page?: string;
  pageSize?: string;
};

type StudentSourceFilter = 'ALL' | 'ONSITE' | 'SIMULATED' | 'BOTH';

const PENDING_LOCATION_PREFIX = 'pendingLocationCode:';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listStudents(query: StudentListQuery, actor: StudentActor) {
    this.assertActor(actor);

    const page = this.parsePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.parsePositiveInteger(query.pageSize, 10), 50);
    const academicYear = this.parseOptionalYear(query.academicYear);
    const source = this.parseSourceFilter(query.source);
    const pendingLocationOnly = this.parseBoolean(query.pendingLocationOnly);
    const search = String(query.q ?? '').trim();

    const where = this.buildStudentWhere({
      search,
      academicYear,
      source,
      pendingLocationOnly,
    });

    const enrollmentWhere = this.buildEnrollmentWhere({
      academicYear,
      sourceTypes: this.getEnrollmentSourceTypes(source),
    });

    const [items, total, summary] = await Promise.all([
      this.prisma.student.findMany({
        where,
        include: {
          enrollments: {
            where: enrollmentWhere,
            include: {
              examLocation: true,
            },
            orderBy: [{ updatedAt: 'desc' }],
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { lastNameTh: 'asc' }, { firstNameTh: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.student.count({ where }),
      this.buildSummary(academicYear),
    ]);

    return {
      items: items.map((student) => this.mapStudent(student)),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      summary,
    };
  }

  private async buildSummary(academicYear?: number) {
    const summaryWhere = this.buildStudentWhere({ academicYear, source: 'ALL', pendingLocationOnly: false });
    const onsiteWhere = this.buildStudentWhere({ academicYear, source: 'ONSITE', pendingLocationOnly: false });
    const simulatedWhere = this.buildStudentWhere({ academicYear, source: 'SIMULATED', pendingLocationOnly: false });
    const pendingWhere = this.buildStudentWhere({ academicYear, source: 'ALL', pendingLocationOnly: true });

    const bothWhere: Prisma.StudentWhereInput = {
      deletedAt: null,
      AND: [
        {
          enrollments: {
            some: this.buildEnrollmentWhere({ academicYear, sourceType: EnrollmentSourceType.ONSITE_EXCEL }),
          },
        },
        {
          enrollments: {
            some: this.buildEnrollmentWhere({ academicYear, sourceType: EnrollmentSourceType.SIMULATED_EXCEL }),
          },
        },
      ],
    };

    const [totalStudents, onsiteCount, simulatedCount, bothCount, pendingLocationCount] = await Promise.all([
      this.prisma.student.count({ where: summaryWhere }),
      this.prisma.student.count({ where: onsiteWhere }),
      this.prisma.student.count({ where: simulatedWhere }),
      this.prisma.student.count({ where: bothWhere }),
      this.prisma.student.count({ where: pendingWhere }),
    ]);

    return {
      totalStudents,
      onsiteCount,
      simulatedCount,
      bothCount,
      pendingLocationCount,
    };
  }

  private buildStudentWhere(filters: {
    search?: string;
    academicYear?: number;
    source?: StudentSourceFilter;
    pendingLocationOnly?: boolean;
  }): Prisma.StudentWhereInput {
    const enrollmentConditions: Prisma.EnrollmentWhereInput[] = [{ deletedAt: null }];

    if (filters.academicYear) {
      enrollmentConditions.push({ academicYear: filters.academicYear });
    }

    if (filters.source === 'ONSITE') {
      enrollmentConditions.push({ sourceType: EnrollmentSourceType.ONSITE_EXCEL });
    }

    if (filters.source === 'SIMULATED') {
      enrollmentConditions.push({ sourceType: EnrollmentSourceType.SIMULATED_EXCEL });
    }

    if (filters.pendingLocationOnly) {
      enrollmentConditions.push({
        examLocationId: null,
        notes: {
          contains: PENDING_LOCATION_PREFIX,
        },
      });
    }

    const search = String(filters.search ?? '').trim();
    const where: Prisma.StudentWhereInput = {
      deletedAt: null,
      enrollments: {
        some: {
          AND: enrollmentConditions,
        },
      },
    };

    if (filters.source === 'BOTH') {
      where.AND = [
        {
          enrollments: {
            some: this.buildEnrollmentWhere({
              academicYear: filters.academicYear,
              sourceType: EnrollmentSourceType.ONSITE_EXCEL,
            }),
          },
        },
        {
          enrollments: {
            some: this.buildEnrollmentWhere({
              academicYear: filters.academicYear,
              sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
            }),
          },
        },
      ];
    }

    if (search) {
      where.OR = [
        { nationalId: { contains: search } },
        { firstNameTh: { contains: search, mode: 'insensitive' } },
        { lastNameTh: { contains: search, mode: 'insensitive' } },
        { firstNameEn: { contains: search, mode: 'insensitive' } },
        { lastNameEn: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { schoolName: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildEnrollmentWhere(filters: {
    academicYear?: number;
    sourceType?: EnrollmentSourceType;
    sourceTypes?: EnrollmentSourceType[];
  }): Prisma.EnrollmentWhereInput {
    const and: Prisma.EnrollmentWhereInput[] = [{ deletedAt: null }];

    if (filters.academicYear) {
      and.push({ academicYear: filters.academicYear });
    }

    if (filters.sourceType) {
      and.push({ sourceType: filters.sourceType });
    }

    if (filters.sourceTypes?.length) {
      and.push({ sourceType: { in: filters.sourceTypes } });
    }

    return { AND: and };
  }

  private getEnrollmentSourceTypes(source: StudentSourceFilter) {
    if (source === 'ONSITE') {
      return [EnrollmentSourceType.ONSITE_EXCEL];
    }

    if (source === 'SIMULATED') {
      return [EnrollmentSourceType.SIMULATED_EXCEL];
    }

    if (source === 'BOTH') {
      return [EnrollmentSourceType.ONSITE_EXCEL, EnrollmentSourceType.SIMULATED_EXCEL];
    }

    return undefined;
  }

  private mapStudent(student: {
    id: string;
    nationalId: string;
    prefix: string | null;
    firstNameTh: string;
    lastNameTh: string;
    firstNameEn: string | null;
    lastNameEn: string | null;
    email: string | null;
    phone: string | null;
    schoolName: string | null;
    province: string | null;
    createdAt: Date;
    updatedAt: Date;
    enrollments: Array<{
      id: string;
      academicYear: number;
      examRound: string;
      status: EnrollmentStatus;
      sourceType: EnrollmentSourceType;
      updatedAt: Date;
      notes: string | null;
      examLocation?: {
        name: string;
        province: string | null;
      } | null;
    }>;
  }) {
    const latestEnrollment = student.enrollments[0] ?? null;
    const sourceSet = new Set(student.enrollments.map((enrollment) => enrollment.sourceType));
    const pendingLocationCodes = Array.from(
      new Set(student.enrollments.flatMap((enrollment) => this.extractPendingLocationCodes(enrollment.notes))),
    );

    return {
      id: student.id,
      nationalId: student.nationalId,
      prefix: student.prefix,
      firstNameTh: student.firstNameTh,
      lastNameTh: student.lastNameTh,
      firstNameEn: student.firstNameEn,
      lastNameEn: student.lastNameEn,
      email: student.email,
      phone: student.phone,
      schoolName: student.schoolName,
      province: student.province,
      createdAt: student.createdAt.toISOString(),
      updatedAt: student.updatedAt.toISOString(),
      enrollmentCount: student.enrollments.length,
      sources: Array.from(sourceSet),
      hasPendingLocation: pendingLocationCodes.length > 0,
      pendingLocationCodes,
      latestEnrollment: latestEnrollment
        ? {
            id: latestEnrollment.id,
            academicYear: latestEnrollment.academicYear,
            examRound: latestEnrollment.examRound,
            status: latestEnrollment.status,
            sourceType: latestEnrollment.sourceType,
            updatedAt: latestEnrollment.updatedAt.toISOString(),
            location: latestEnrollment.examLocation?.name ?? '',
            province: latestEnrollment.examLocation?.province ?? '',
          }
        : null,
    };
  }

  private extractPendingLocationCodes(notes: string | null | undefined) {
    return String(notes ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(PENDING_LOCATION_PREFIX))
      .map((line) => line.slice(PENDING_LOCATION_PREFIX.length).trim())
      .filter(Boolean);
  }

  private assertActor(actor: StudentActor) {
    if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.SUPERADMIN && actor.role !== Role.STAFF)) {
      throw new ForbiddenException('Authenticated ADMIN, SUPERADMIN, or STAFF is required');
    }
  }

  private parseSourceFilter(source: string | undefined): StudentSourceFilter {
    const normalized = String(source ?? 'ALL').trim().toUpperCase();

    if (normalized === 'ONSITE') {
      return 'ONSITE';
    }

    if (normalized === 'SIMULATED') {
      return 'SIMULATED';
    }

    if (normalized === 'BOTH') {
      return 'BOTH';
    }

    return 'ALL';
  }

  private parseOptionalYear(year: string | undefined) {
    const value = Number(year);
    return Number.isInteger(value) && value >= 2000 ? value : undefined;
  }

  private parsePositiveInteger(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parseBoolean(value: string | undefined) {
    return String(value ?? '').toLowerCase() === 'true';
  }
}