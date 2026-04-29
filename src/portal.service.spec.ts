import { ConflictException } from '@nestjs/common';
jest.mock('./generated/prisma/client', () => ({
  EnrollmentSourceType: {
    ONSITE_EXCEL: 'ONSITE_EXCEL',
    SIMULATED_EXCEL: 'SIMULATED_EXCEL',
  },
  EnrollmentStatus: {
    DRAFT: 'DRAFT',
    REGISTERED: 'REGISTERED',
    PAID: 'PAID',
    CANCELLED: 'CANCELLED',
  },
  SystemKey: {
    GENERAL: 'GENERAL',
  },
}));

jest.mock('./prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PortalService } from './portal.service';
import {
  EnrollmentSourceType,
  EnrollmentStatus,
} from './generated/prisma/client';
import { ForfeitRequestStatus } from './generated/prisma/enums';
import type { PrismaService } from './prisma/prisma.service';

type PrismaMock = {
  systemSetting: {
    upsert: jest.Mock;
  };
  examLocation: {
    aggregate: jest.Mock;
  };
  student: {
    findFirst: jest.Mock;
  };
  enrollment: {
    findFirst: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  forfeitRequest: {
    findFirst: jest.Mock;
  };
};

function createPrismaMock(): PrismaMock {
  return {
    systemSetting: {
      upsert: jest.fn().mockResolvedValue({
        key: 'GENERAL',
        googleDriveLink: '',
        facebookLink: '',
        lineLink: '',
        isUserPortalOpen: true,
        isCheckInOpen: true,
        announcement: '',
      }),
    },
    examLocation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { seatCapacity: 0 } }),
    },
    student: {
      findFirst: jest.fn(),
    },
    enrollment: {
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    forfeitRequest: {
      findFirst: jest.fn(),
    },
  };
}

function createEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enrollment-1',
    studentId: 'student-1',
    academicYear: 2026,
    examRound: 'MORNING',
    status: EnrollmentStatus.REGISTERED,
    sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
    barcode: '12345678',
    registrationStartAt: new Date('2026-03-20T09:00:00.000Z'),
    registrationEndAt: new Date('2026-03-20T12:00:00.000Z'),
    registeredAt: new Date('2026-03-01T09:00:00.000Z'),
    createdAt: new Date('2026-02-01T09:00:00.000Z'),
    deletedAt: null,
    examLocationId: 'location-1',
    student: {
      id: 'student-1',
      nationalId: '1104301201707',
      firstNameTh: 'Demo',
      lastNameTh: 'Student',
      firstNameEn: 'Demo',
      lastNameEn: 'Student',
      email: 'demo@example.com',
      phone: '0812345678',
    },
    examLocation: {
      name: 'Bangkok Center',
      province: 'Bangkok',
      address: 'Room 101',
      eventDate: null,
      eventStartMinutes: null,
      eventEndMinutes: null,
    },
    score: null,
    forfeitRequest: null,
    ...overrides,
  };
}

describe('PortalService', () => {
  let service: PortalService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new PortalService(prisma as unknown as PrismaService);
  });

  it('creates a forfeit request when the student has not submitted one in the same academic year', async () => {
    const submittedAt = new Date('2026-04-20T10:00:00.000Z');
    prisma.enrollment.findFirst.mockResolvedValue(createEnrollment());
    prisma.forfeitRequest.findFirst.mockResolvedValue(null);
    prisma.enrollment.update.mockResolvedValue(
      createEnrollment({
        forfeitRequest: {
          status: ForfeitRequestStatus.PENDING,
          submittedAt,
        },
      }),
    );

    const result = await service.forfeitApplication('enrollment-1', {
      reason: 'ติดภารกิจ',
      fullName: 'Demo Student',
      address: 'Bangkok',
      phone: '0812345678',
    });

    expect(prisma.forfeitRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enrollment: {
            studentId: 'student-1',
            academicYear: 2026,
            deletedAt: null,
          },
        },
      }),
    );
    expect(prisma.enrollment.update).toHaveBeenCalled();
    expect(result.application.forfeitRequestStatus).toBe('pending');
    expect(result.application.forfeitRequestedAt).toBe(submittedAt.toISOString());
  });

  it('finds a student by an alphanumeric identifier regardless of input casing or spaces', async () => {
    prisma.student.findFirst.mockResolvedValue({
      id: 'student-1',
      nationalId: 'EK1476093',
      firstNameTh: 'จิ่งฉง',
      lastNameTh: 'หลี่',
      firstNameEn: 'Jingcong',
      lastNameEn: 'Li',
      email: null,
      phone: null,
      enrollments: [],
      deletedAt: null,
    });

    const result = await service.getStudentSearch(' ek1476093 ');

    expect(prisma.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nationalId: {
            equals: 'EK1476093',
            mode: 'insensitive',
          },
        }),
      }),
    );
    expect(result.student.nationalId).toBe('EK1476093');
  });

  it('blocks duplicate requests in the same academic year regardless of admin processing status', async () => {
    prisma.enrollment.findFirst.mockResolvedValue(createEnrollment());
    prisma.forfeitRequest.findFirst.mockResolvedValue({
      status: ForfeitRequestStatus.COMPLETED,
      submittedAt: new Date('2026-04-01T10:00:00.000Z'),
    });

    await expect(
      service.forfeitApplication('enrollment-1', {
        reason: 'ติดภารกิจ',
        fullName: 'Demo Student',
        address: 'Bangkok',
        phone: '0812345678',
      }),
    ).rejects.toThrow(new ConflictException('ปีการศึกษานี้ได้ส่งคำขอสละสิทธิ์แล้ว'));

    expect(prisma.enrollment.update).not.toHaveBeenCalled();
  });

  it('allows submitting again in a new academic year', async () => {
    const submittedAt = new Date('2027-04-20T10:00:00.000Z');
    prisma.enrollment.findFirst.mockResolvedValue(
      createEnrollment({
        id: 'enrollment-2',
        academicYear: 2027,
        createdAt: new Date('2027-02-01T09:00:00.000Z'),
        registeredAt: new Date('2027-03-01T09:00:00.000Z'),
        registrationStartAt: new Date('2027-03-20T09:00:00.000Z'),
        registrationEndAt: new Date('2027-03-20T12:00:00.000Z'),
      }),
    );
    prisma.forfeitRequest.findFirst.mockResolvedValue(null);
    prisma.enrollment.update.mockResolvedValue(
      createEnrollment({
        id: 'enrollment-2',
        academicYear: 2027,
        createdAt: new Date('2027-02-01T09:00:00.000Z'),
        registeredAt: new Date('2027-03-01T09:00:00.000Z'),
        registrationStartAt: new Date('2027-03-20T09:00:00.000Z'),
        registrationEndAt: new Date('2027-03-20T12:00:00.000Z'),
        forfeitRequest: {
          status: ForfeitRequestStatus.PENDING,
          submittedAt,
        },
      }),
    );

    const result = await service.forfeitApplication('enrollment-2', {
      reason: 'ติดภารกิจ',
      fullName: 'Demo Student',
      address: 'Bangkok',
      phone: '0812345678',
    });

    expect(prisma.forfeitRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enrollment: {
            studentId: 'student-1',
            academicYear: 2027,
            deletedAt: null,
          },
        },
      }),
    );
    expect(result.application.forfeitRequestStatus).toBe('pending');
  });

  it('returns the academic-year forfeit status on application detail even when the request belongs to another enrollment', async () => {
    const submittedAt = new Date('2026-04-10T10:00:00.000Z');
    prisma.enrollment.findFirst.mockResolvedValue(createEnrollment());
    prisma.enrollment.count.mockResolvedValueOnce(120).mockResolvedValueOnce(25);
    prisma.forfeitRequest.findFirst.mockResolvedValue({
      status: ForfeitRequestStatus.IN_PROGRESS,
      submittedAt,
    });

    const result = await service.getApplicationDetail('enrollment-1');

    expect(result.application.forfeitRequestStatus).toBe('in_progress');
    expect(result.application.forfeitRequestedAt).toBe(submittedAt.toISOString());
  });

  it('returns the imported simulated round label from Excel when available', async () => {
    prisma.enrollment.findFirst.mockResolvedValue(
      createEnrollment({
        importedExamRoundLabel: 'รอบบ่าย : เวลา 12.30-15.30 น.',
      }),
    );

    const result = await service.getApplicationDetail('enrollment-1');

    expect(result.application.examRound).toBe('รอบบ่าย : เวลา 12.30-15.30 น.');
  });

  it('renders simulated schedule time from enrollment registration window', async () => {
    prisma.enrollment.findFirst.mockResolvedValue(
      createEnrollment({
        registrationStartAt: new Date('2026-08-08T06:00:00.000Z'),
        registrationEndAt: new Date('2026-08-08T09:00:00.000Z'),
        registeredAt: new Date('2026-08-08T00:00:00.000Z'),
      }),
    );
    prisma.enrollment.count.mockResolvedValueOnce(120).mockResolvedValueOnce(25);
    prisma.forfeitRequest.findFirst.mockResolvedValue(null);

    const result = await service.getApplicationDetail('enrollment-1');

    expect(result.schedule).toEqual([
      expect.objectContaining({
        time: '13.00-16.00 น.',
        activity: 'เข้าห้องสอบ',
      }),
    ]);
  });

  it('uses examLocation eventDate for simulated applications when enrollment timestamps are stale', async () => {
    prisma.enrollment.findFirst.mockResolvedValue(
      createEnrollment({
        examRound: 'MORNING',
        registrationStartAt: new Date('2026-04-24T18:00:00.000Z'),
        registrationEndAt: new Date('2026-04-24T21:00:00.000Z'),
        registeredAt: new Date('2026-04-24T10:14:21.217Z'),
        examLocation: {
          name: 'ศูนย์ประชุม KNECC ม.นเรศวร',
          province: 'จ.พิษณุโลก',
          address: 'ห้องประชุมมหาราช 2',
          eventDate: new Date('2026-08-07T17:00:00.000Z'),
          eventStartMinutes: null,
          eventEndMinutes: null,
        },
      }),
    );
    prisma.enrollment.count.mockResolvedValueOnce(120).mockResolvedValueOnce(25);
    prisma.forfeitRequest.findFirst.mockResolvedValue(null);

    const result = await service.getApplicationDetail('enrollment-1');

    expect(result.application.eventDate).toBe('2026-08-07T17:00:00.000Z');
    expect(result.application.examRound).toContain('09:00-12:00');
    expect(result.schedule).toEqual([
      expect.objectContaining({
        time: '09.00-12.00 น.',
      }),
    ]);
  });

  it('counts simulated attendees by province instead of exact location id', async () => {
    prisma.enrollment.findFirst.mockResolvedValue(
      createEnrollment({
        examLocationId: 'location-2',
        examLocation: {
          name: 'Chiang Mai Center Room 1201',
          province: 'จ.เชียงใหม่',
          address: 'ห้อง 1201',
        },
      }),
    );
    prisma.examLocation.aggregate.mockResolvedValueOnce({ _sum: { seatCapacity: 7600 } }).mockResolvedValueOnce({ _sum: { seatCapacity: 2000 } });
    prisma.forfeitRequest.findFirst.mockResolvedValue(null);

    const result = await service.getApplicationDetail('enrollment-1');

    expect(prisma.examLocation.aggregate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          province: 'จ.เชียงใหม่',
        }),
      }),
    );
    expect(result.scores).toEqual([]);
  });

  it('maps subject-specific ranks and TGAT exam names in score rows', () => {
    const rows = (service as any).mapScores(
      {
        id: 'score-1',
        tgat: '79.0384',
        tgat1: '67.2342',
        tgat2: '65.0043',
        tgat3: '56.1234',
        rankingOverall: 567,
        rankingLocation: 12,
        rankingOverallTgat1: 1234,
        rankingLocationTgat1: 123,
        rankingOverallTgat2: 2234,
        rankingLocationTgat2: 234,
        rankingOverallTgat3: 2222,
        rankingLocationTgat3: 99,
      },
      'จ.เชียงใหม่',
      567,
      2000,
    );

    expect(rows).toMatchObject([
      {
        examName: 'คะแนนสอบ TGAT ความถนัดทั่วไป',
        rankInVenue: 12,
        rankNationwide: 567,
      },
      {
        examName: 'TGAT 1 การสื่อสารภาษาอังกฤษ',
        rankInVenue: 123,
        rankNationwide: 1234,
      },
      {
        examName: 'TGAT 2 การคิดอย่างมีเหตุผล',
        rankInVenue: 234,
        rankNationwide: 2234,
      },
      {
        examName: 'TGAT 3 สมรรถนะการทำงาน',
        rankInVenue: 99,
        rankNationwide: 2222,
      },
    ]);
  });
});