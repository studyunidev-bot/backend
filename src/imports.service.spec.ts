const mockWorkbookReader = jest.fn<any, any[]>(() => ({
  async *[Symbol.asyncIterator]() {
    // no-op default workbook
  },
}));

jest.mock('node:module', () => ({
  createRequire: () => () => ({
    stream: {
      xlsx: {
        WorkbookReader: function WorkbookReader(this: unknown, ...args: any[]) {
          return mockWorkbookReader(...args);
        },
      },
    },
    Workbook: class Workbook {},
  }),
}));
jest.mock('./generated/prisma/client', () => ({
  EnrollmentSourceType: {
    ONSITE_EXCEL: 'ONSITE_EXCEL',
    SIMULATED_EXCEL: 'SIMULATED_EXCEL',
    MANUAL: 'MANUAL',
    API: 'API',
  },
  ExamRound: {
    MORNING: 'MORNING',
    AFTERNOON: 'AFTERNOON',
  },
  EnrollmentStatus: {
    REGISTERED: 'REGISTERED',
  },
  Prisma: {},
}));

jest.mock('./prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { ImportsService } from './imports.service';
import { EnrollmentSourceType, ExamRound } from './generated/prisma/client';
import type { PrismaService } from './prisma/prisma.service';

type PrismaMock = {
  student: {
    findMany: jest.Mock;
    createManyAndReturn: jest.Mock;
    update: jest.Mock;
    upsert: jest.Mock;
  };
  enrollment: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    upsert: jest.Mock;
  };
  examLocation: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    upsert: jest.Mock;
  };
  score: {
    upsert: jest.Mock;
  };
};

function createPrismaMock(): PrismaMock {
  return {
    student: {
      findMany: jest.fn().mockResolvedValue([]),
      createManyAndReturn: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn(),
    },
    examLocation: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    score: {
      upsert: jest.fn(),
    },
  };
}

function createAsyncIterable<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

describe('ImportsService', () => {
  let service: ImportsService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ImportsService(prisma as unknown as PrismaService);
  });

  it('maps score columns from the simulated import row', () => {
    const row = (service as any).mapEnrollmentRow({
      nationalId: '1102400222395',
      firstNameTh: 'ศิริศักดิ์',
      lastNameTh: 'ธิดชัชวาลกุล',
      locationCode: '1',
      examRound: 'รอบเช้า : เวลา 09.00-12.00 น.',
      tgat: '79.0384',
      rankingLocation: '12',
      rankingOverall: '567',
      tgat1: '67.2342',
      rankingLocationTgat1: '123',
      rankingOverallTgat1: '1234',
      tgat2: '65.0043',
      rankingLocationTgat2: '234',
      rankingOverallTgat2: '2234',
      tgat3: '56.1234',
      rankingLocationTgat3: '99',
      rankingOverallTgat3: '2222',
    });

    expect(row).toMatchObject({
      examRound: ExamRound.MORNING,
      importedExamRoundLabel: 'รอบเช้า : เวลา 09.00-12.00 น.',
      tgat: 79.0384,
      rankingLocation: 12,
      rankingOverall: 567,
      tgat1: 67.2342,
      rankingLocationTgat1: 123,
      rankingOverallTgat1: 1234,
      tgat2: 65.0043,
      rankingLocationTgat2: 234,
      rankingOverallTgat2: 2234,
      tgat3: 56.1234,
      rankingLocationTgat3: 99,
      rankingOverallTgat3: 2222,
    });
  });

  it('recognizes วันที่สอบ as the per-row event date header', () => {
    const resolved = (service as any).tryResolveHeaderIndexes(
      [[
        'เลขบัตรประชาชน13หลัก',
        'ชื่อ',
        'นามสกุล',
        'สนามสอบที่',
        'วันที่สอบ',
      ]],
      {
        nationalId: ['เลขบัตรประชาชน13หลัก'],
        firstNameTh: ['ชื่อ'],
        lastNameTh: ['นามสกุล'],
        locationCode: ['สนามสอบที่'],
        registeredAt: ['วันที่สอบ'],
      },
    );

    expect(resolved).not.toBeNull();
    expect(resolved.headerMap).toMatchObject({
      registeredAt: 4,
    });
  });

  it('maps locationCode from the numeric สนามสอบที่ column instead of venue-name columns', () => {
    const resolved = (service as any).tryResolveHeaderIndexes(
      [[
        'เลขบัตรประชาชน13หลัก',
        'ชื่อ',
        'นามสกุล',
        'ชื่อสนามสอบ',
        'สนามสอบที่',
      ]],
      {
        nationalId: ['เลขบัตรประชาชน13หลัก'],
        firstNameTh: ['ชื่อ'],
        lastNameTh: ['นามสกุล'],
        locationCode: ['locationcode', 'examlocationcode', 'รหัสสนามสอบ', 'สนามสอบที่', 'ข้อมูลผู้สมัครสนามสอบที่', 'รหัสสถานที่สอบ', 'สนามสอบหมายเลข'],
      },
    );

    expect(resolved).not.toBeNull();
    expect(resolved.headerMap).toMatchObject({
      locationCode: 4,
    });
  });

  it('maps onsite venue-name headers when the file has no numeric exam location code column', () => {
    const resolved = (service as any).tryResolveHeaderIndexes(
      [[
        'เลขบัตรประชาชน13หลัก',
        'ชื่อ',
        'นามสกุล',
        'ชื่อสนามสอบ',
      ]],
      {
        nationalId: ['เลขบัตรประชาชน13หลัก'],
        firstNameTh: ['ชื่อ'],
        lastNameTh: ['นามสกุล'],
        locationCode: [
          'locationcode',
          'examlocationcode',
          'รหัสสนามสอบ',
          'สนามสอบที่',
          'ข้อมูลผู้สมัครสนามสอบที่',
          'รหัสสถานที่สอบ',
          'สนามสอบหมายเลข',
          'สนามสอบ',
          'ชื่อสนามสอบ',
          'สถานที่สอบ',
          'ชื่อสถานที่สอบ',
          'สถานที่',
        ],
      },
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.headerMap).toMatchObject({
      locationCode: 3,
    });
  });

  it('normalizes textual simulated location codes like สนามสอบที่ 8 to the numeric code', () => {
    const row = (service as any).mapEnrollmentRow({
      nationalId: '1101700473945',
      firstNameTh: 'ณมญ',
      lastNameTh: 'ไทยภิรมย์สามัคคี',
      locationCode: 'สนามสอบที่ 8',
    });

    expect(row.locationCode).toBe('8');
  });

  it('recovers required enrollment fields from raw row values when mapped columns are empty', () => {
    const row = (service as any).mapEnrollmentRow({
      locationCode: 'A01',
      __rawValues: [undefined, '1', '1102400222395', 'นาย', 'สมชาย', 'ใจดี', 'เชียงใหม่'],
    });

    expect(row).toMatchObject({
      nationalId: '1102400222395',
      prefix: 'นาย',
      firstNameTh: 'สมชาย',
      lastNameTh: 'ใจดี',
      locationCode: 'A01',
    });
  });

  it('parses Thai onsite activity dates from the วันที่ column', () => {
    const row = (service as any).mapEnrollmentRow({
      nationalId: '1102400222395',
      firstNameTh: 'สมชาย',
      lastNameTh: 'ใจดี',
      registeredAt: 'วันเสาร์ 8 ส.ค. 2569',
    });

    expect(row.registeredAt).toBeInstanceOf(Date);
    expect(row.registeredAt?.getFullYear()).toBe(2026);
    expect(row.registeredAt?.getMonth()).toBe(7);
    expect(row.registeredAt?.getDate()).toBe(8);
  });

  it('preserves alphanumeric student identifiers from raw row values', () => {
    const row = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '291', 'ek1476093', 'จิ่งฉง หลี่', 'เชียงใหม่'],
    });

    expect(row).toMatchObject({
      nationalId: 'EK1476093',
      firstNameTh: 'จิ่งฉง',
      lastNameTh: 'หลี่',
    });
  });

  it('preserves 12 and 14 digit student identifiers from raw row values', () => {
    const shortIdRow = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '612', '110041412048', 'ณัฏฐกันย์ แซ่ปึง', 'เชียงใหม่'],
    });
    const longIdRow = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '1457', '11003704412098', 'พัฐสุดา จันทร์วงศ์สกุล', 'เชียงใหม่'],
    });

    expect(shortIdRow.nationalId).toBe('110041412048');
    expect(longIdRow.nationalId).toBe('11003704412098');
  });

  it('strips hidden zero-width characters from student identifiers during raw row recovery', () => {
    const row = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '787', '1229901272323\u200B', 'เดชาธร ไทยทักษ์', 'เชียงใหม่'],
    });

    expect(row).toMatchObject({
      nationalId: '1229901272323',
      firstNameTh: 'เดชาธร',
      lastNameTh: 'ไทยทักษ์',
    });
  });

  it('falls back to a placeholder last name when the import row contains a mononym', () => {
    const row = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '1767', '60991020511', 'เมย์วดี', 'เชียงใหม่'],
    });

    expect(row).toMatchObject({
      nationalId: '60991020511',
      firstNameTh: 'เมย์วดี',
      lastNameTh: '-',
    });
  });

  it('builds a temporary fallback identifier when a row has only a combined Thai name', () => {
    const row = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '73', 'กรรณิการ์ บัณฑิตย์', '8', 'รอบเช้า : เวลา 09.00-12.00 น.', '67.2222'],
    });

    expect(row).toMatchObject({
      nationalId: '__NAME__:กรรณิการ์|บัณฑิตย์',
      firstNameTh: 'กรรณิการ์',
      lastNameTh: 'บัณฑิตย์',
    });
  });

  it('normalizes duplicated surnames when firstNameTh already contains the full Thai name', () => {
    const row = (service as any).mapEnrollmentRow({
      firstNameTh: 'พิชญากร ลาอาจ',
      lastNameTh: 'ลาอาจ',
    });

    expect(row).toMatchObject({
      nationalId: '__NAME__:พิชญากร|ลาอาจ',
      firstNameTh: 'พิชญากร',
      lastNameTh: 'ลาอาจ',
    });
  });

  it('recovers enrollment identity when prefix first name and last name are combined in one cell', () => {
    const row = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '290', '1102400222395', 'นางสาว ศิริพร ใจงาม', 'เชียงใหม่'],
    });

    expect(row).toMatchObject({
      nationalId: '1102400222395',
      prefix: 'นางสาว',
      firstNameTh: 'ศิริพร',
      lastNameTh: 'ใจงาม',
    });
  });

  it('recovers enrollment identity when first and last name are combined in one cell', () => {
    const row = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '611', '1102400222395', 'สมชาย ใจดี', 'เชียงใหม่'],
    });

    expect(row).toMatchObject({
      nationalId: '1102400222395',
      firstNameTh: 'สมชาย',
      lastNameTh: 'ใจดี',
    });
  });

  it('still rejects enrollment rows that cannot recover student identity from raw values', () => {
    expect(() =>
      (service as any).mapEnrollmentRow({
        __rawValues: [undefined, 'สรุปข้อมูลผู้สมัคร', 'รวมทั้งหมด 2441 รายการ'],
      }),
    ).toThrow('nationalId, firstNameTh and lastNameTh are required in enrollment rows');
  });

  it('resolves merged simulated score headers from a two-row excel header', () => {
    const mergedHeaders = [
      'ลำดับ',
      'ข้อมูลผู้สมัครเลขบัตรประชาชน13หลัก',
      'ข้อมูลผู้สมัครชื่อ',
      'ข้อมูลผู้สมัครนามสกุล',
      'ข้อมูลผู้สมัครสนามสอบที่',
      'ข้อมูลผู้สมัครรอบการสอบ',
      'คะแนนสอบtgatความถนัดทั่วไปคะแนนที่ได้',
      'คะแนนสอบtgatความถนัดทั่วไปลำดับในสนามสอบ',
      'คะแนนสอบtgatความถนัดทั่วไปลำดับทุกสนามสอบ',
      'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษคะแนนที่ได้',
      'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษลำดับในสนามสอบ',
      'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษลำดับทุกสนามสอบ',
      'คะแนนสอบtgat2การคิดอย่างมีเหตุผลคะแนนที่ได้',
      'คะแนนสอบtgat2การคิดอย่างมีเหตุผลลำดับในสนามสอบ',
      'คะแนนสอบtgat2การคิดอย่างมีเหตุผลลำดับทุกสนามสอบ',
      'คะแนนสอบtgat3สมรรถนะการทำงานคะแนนที่ได้',
      'คะแนนสอบtgat3สมรรถนะการทำงานลำดับในสนามสอบ',
      'คะแนนสอบtgat3สมรรถนะการทำงานลำดับทุกสนามสอบ',
    ];

    const resolved = (service as any).tryResolveHeaderIndexes([mergedHeaders], {
      nationalId: ['nationalid', 'เลขบัตรประชาชน', 'เลขประจำตัวประชาชน', 'citizenid', 'เลขบัตร', 'เลขบัตรปชช', 'เลขบัตรประชาชน13หลัก'],
      firstNameTh: ['firstname', 'ชื่อ', 'ชื่อไทย', 'firstnameth', 'ชื่อจริง', 'ชื่อจริงไทย'],
      lastNameTh: ['lastname', 'นามสกุล', 'นามสกุลไทย', 'lastnameth', 'นามสกุลจริง', 'สกุล'],
      locationCode: ['locationcode', 'examlocationcode', 'รหัสสนามสอบ', 'สนามสอบ', 'สนามสอบที่', 'รหัสสถานที่สอบ', 'สถานที่'],
      tgat: ['tgat', 'tgatรวม', 'คะแนนtgat', 'คะแนนรวม', 'คะแนนรวมtgat', 'totalscore', 'scoretotal', 'คะแนนสอบtgatความถนัดทั่วไปคะแนนที่ได้'],
      tgat1: ['tgat1', 'tgat1การสื่อสารภาษาอังกฤษ', 'คะแนนtgat1', 'คะแนนอังกฤษ', 'คะแนนภาษาอังกฤษ', 'tgatอังกฤษ', 'tgatภาษาอังกฤษ', 'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษคะแนนที่ได้'],
      tgat2: ['tgat2', 'tgat2การคิดอย่างมีเหตุผล', 'คะแนนtgat2', 'คะแนนเหตุผล', 'คะแนนการคิดอย่างมีเหตุผล', 'tgatเหตุผล', 'คะแนนสอบtgat2การคิดอย่างมีเหตุผลคะแนนที่ได้'],
      tgat3: ['tgat3', 'tgat3สมรรถนะการทำงาน', 'คะแนนtgat3', 'คะแนนสมรรถนะการทำงาน', 'tgatสมรรถนะการทำงาน', 'คะแนนสอบtgat3สมรรถนะการทำงานคะแนนที่ได้'],
      rankingLocation: ['rankinglocation', 'ranklocation', 'rankingvenue', 'rankvenue', 'อันดับสนามสอบ', 'ลำดับสนามสอบ', 'อันดับจังหวัด', 'ลำดับจังหวัด', 'คะแนนสอบtgatความถนัดทั่วไปลำดับในสนามสอบ'],
      rankingOverall: ['rankingoverall', 'rankoverall', 'rankingnationwide', 'ranknationwide', 'อันดับรวม', 'ลำดับรวม', 'อันดับทั่วประเทศ', 'ลำดับทั่วประเทศ', 'คะแนนสอบtgatความถนัดทั่วไปลำดับทุกสนามสอบ'],
      rankingLocationTgat1: ['rankinglocationtgat1', 'ranklocationtgat1', 'rankingvenuetgat1', 'rankvenuetgat1', 'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษลำดับในสนามสอบ'],
      rankingOverallTgat1: ['rankingoveralltgat1', 'rankoveralltgat1', 'rankingnationwidetgat1', 'ranknationwidetgat1', 'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษลำดับทุกสนามสอบ'],
      rankingLocationTgat2: ['rankinglocationtgat2', 'ranklocationtgat2', 'rankingvenuetgat2', 'rankvenuetgat2', 'คะแนนสอบtgat2การคิดอย่างมีเหตุผลลำดับในสนามสอบ'],
      rankingOverallTgat2: ['rankingoveralltgat2', 'rankoveralltgat2', 'rankingnationwidetgat2', 'ranknationwidetgat2', 'คะแนนสอบtgat2การคิดอย่างมีเหตุผลลำดับทุกสนามสอบ'],
      rankingLocationTgat3: ['rankinglocationtgat3', 'ranklocationtgat3', 'rankingvenuetgat3', 'rankvenuetgat3', 'คะแนนสอบtgat3สมรรถนะการทำงานลำดับในสนามสอบ'],
      rankingOverallTgat3: ['rankingoveralltgat3', 'rankoveralltgat3', 'rankingnationwidetgat3', 'ranknationwidetgat3', 'คะแนนสอบtgat3สมรรถนะการทำงานลำดับทุกสนามสอบ'],
    });

    expect(resolved).not.toBeNull();
    expect(resolved.headerMap).toMatchObject({
      nationalId: 1,
      firstNameTh: 2,
      lastNameTh: 3,
      locationCode: 4,
      tgat: 6,
      rankingLocation: 7,
      rankingOverall: 8,
      tgat1: 9,
      rankingLocationTgat1: 10,
      rankingOverallTgat1: 11,
      tgat2: 12,
      rankingLocationTgat2: 13,
      rankingOverallTgat2: 14,
      tgat3: 15,
      rankingLocationTgat3: 16,
      rankingOverallTgat3: 17,
    });
  });

  it('infers TGAT3 ranking columns when the trailing headers are generic labels', () => {
    const mergedHeaders = [
      'ข้อมูลผู้สมัครเลขบัตรประชาชน13หลัก',
      'ข้อมูลผู้สมัครชื่อ',
      'ข้อมูลผู้สมัครนามสกุล',
      'ข้อมูลผู้สมัครสนามสอบที่',
      'คะแนนสอบtgatความถนัดทั่วไปคะแนนที่ได้',
      'คะแนนสอบtgatความถนัดทั่วไปลำดับในสนามสอบ',
      'คะแนนสอบtgatความถนัดทั่วไปลำดับทุกสนามสอบ',
      'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษคะแนนที่ได้',
      'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษลำดับในสนามสอบ',
      'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษลำดับทุกสนามสอบ',
      'คะแนนสอบtgat2การคิดอย่างมีเหตุผลคะแนนที่ได้',
      'คะแนนสอบtgat2การคิดอย่างมีเหตุผลลำดับในสนามสอบ',
      'คะแนนสอบtgat2การคิดอย่างมีเหตุผลลำดับทุกสนามสอบ',
      'คะแนนสอบtgat3สมรรถนะการทำงานคะแนนที่ได้',
      'ลำดับในสนามสอบ',
      'ลำดับทุกสนามสอบ',
    ];

    const config = {
      nationalId: ['nationalid', 'เลขบัตรประชาชน', 'เลขประจำตัวประชาชน', 'citizenid', 'เลขบัตร', 'เลขบัตรปชช', 'เลขบัตรประชาชน13หลัก'],
      firstNameTh: ['firstname', 'ชื่อ', 'ชื่อไทย', 'firstnameth', 'ชื่อจริง', 'ชื่อจริงไทย'],
      lastNameTh: ['lastname', 'นามสกุล', 'นามสกุลไทย', 'lastnameth', 'นามสกุลจริง', 'สกุล'],
      locationCode: ['locationcode', 'examlocationcode', 'รหัสสนามสอบ', 'สนามสอบ', 'สนามสอบที่', 'รหัสสถานที่สอบ', 'สถานที่'],
      tgat: ['tgat', 'tgatรวม', 'คะแนนtgat', 'คะแนนรวม', 'คะแนนรวมtgat', 'totalscore', 'scoretotal', 'คะแนนสอบtgatความถนัดทั่วไปคะแนนที่ได้'],
      tgat1: ['tgat1', 'tgat1การสื่อสารภาษาอังกฤษ', 'คะแนนtgat1', 'คะแนนอังกฤษ', 'คะแนนภาษาอังกฤษ', 'tgatอังกฤษ', 'tgatภาษาอังกฤษ', 'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษคะแนนที่ได้'],
      tgat2: ['tgat2', 'tgat2การคิดอย่างมีเหตุผล', 'คะแนนtgat2', 'คะแนนเหตุผล', 'คะแนนการคิดอย่างมีเหตุผล', 'tgatเหตุผล', 'คะแนนสอบtgat2การคิดอย่างมีเหตุผลคะแนนที่ได้'],
      tgat3: ['tgat3', 'tgat3สมรรถนะการทำงาน', 'คะแนนtgat3', 'คะแนนสมรรถนะการทำงาน', 'tgatสมรรถนะการทำงาน', 'คะแนนสอบtgat3สมรรถนะการทำงานคะแนนที่ได้'],
      rankingLocation: ['rankinglocation', 'ranklocation', 'rankingvenue', 'rankvenue', 'อันดับสนามสอบ', 'ลำดับสนามสอบ', 'อันดับจังหวัด', 'ลำดับจังหวัด', 'คะแนนสอบtgatความถนัดทั่วไปลำดับในสนามสอบ'],
      rankingOverall: ['rankingoverall', 'rankoverall', 'rankingnationwide', 'ranknationwide', 'อันดับรวม', 'ลำดับรวม', 'อันดับทั่วประเทศ', 'ลำดับทั่วประเทศ', 'คะแนนสอบtgatความถนัดทั่วไปลำดับทุกสนามสอบ'],
      rankingLocationTgat1: ['rankinglocationtgat1', 'ranklocationtgat1', 'rankingvenuetgat1', 'rankvenuetgat1', 'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษลำดับในสนามสอบ'],
      rankingOverallTgat1: ['rankingoveralltgat1', 'rankoveralltgat1', 'rankingnationwidetgat1', 'ranknationwidetgat1', 'คะแนนสอบtgat1การสื่อสารภาษาอังกฤษลำดับทุกสนามสอบ'],
      rankingLocationTgat2: ['rankinglocationtgat2', 'ranklocationtgat2', 'rankingvenuetgat2', 'rankvenuetgat2', 'คะแนนสอบtgat2การคิดอย่างมีเหตุผลลำดับในสนามสอบ'],
      rankingOverallTgat2: ['rankingoveralltgat2', 'rankoveralltgat2', 'rankingnationwidetgat2', 'ranknationwidetgat2', 'คะแนนสอบtgat2การคิดอย่างมีเหตุผลลำดับทุกสนามสอบ'],
      rankingLocationTgat3: ['rankinglocationtgat3', 'ranklocationtgat3', 'rankingvenuetgat3', 'rankvenuetgat3', 'คะแนนสอบtgat3สมรรถนะการทำงานลำดับในสนามสอบ'],
      rankingOverallTgat3: ['rankingoveralltgat3', 'rankoveralltgat3', 'rankingnationwidetgat3', 'ranknationwidetgat3', 'คะแนนสอบtgat3สมรรถนะการทำงานลำดับทุกสนามสอบ'],
    };

    const resolved = (service as any).tryResolveHeaderIndexes([mergedHeaders], config);

    expect(resolved).not.toBeNull();
    expect(resolved.headerMap).toMatchObject({
      tgat3: 13,
      rankingLocationTgat3: 14,
      rankingOverallTgat3: 15,
    });
  });

  it('does not throw when merged headers contain undefined cells', () => {
    const headersWithGaps = [
      'ข้อมูลผู้สมัครเลขบัตรประชาชน13หลัก',
      undefined,
      'ข้อมูลผู้สมัครชื่อ',
      'ข้อมูลผู้สมัครนามสกุล',
    ];

    expect(() =>
      (service as any).findHeaderIndex(headersWithGaps, ['ชื่อ'], 'firstNameTh'),
    ).not.toThrow();
  });

  it('resets header detection for each worksheet in the same workbook', async () => {
    mockWorkbookReader.mockImplementationOnce((): any =>
      createAsyncIterable([
        createAsyncIterable([
          { values: [undefined, 'เลขบัตรประชาชน13หลัก', 'ชื่อ', 'นามสกุล'] },
          { values: [undefined, '1111111111111', 'สมชาย', 'ใจดี'] },
        ]),
        createAsyncIterable([
          { values: [undefined, 'ชื่อ', 'นามสกุล', 'เลขบัตรประชาชน13หลัก'] },
          { values: [undefined, 'สมหญิง', 'ใจงาม', '2222222222222'] },
        ]),
      ]),
    );

    const onRow = jest.fn();
    const onBatchBoundary = jest.fn().mockResolvedValue(undefined);

    await (service as any).streamXlsxWorksheet(
      '/tmp/test.xlsx',
      {
        nationalId: ['เลขบัตรประชาชน13หลัก'],
        firstNameTh: ['ชื่อ'],
        lastNameTh: ['นามสกุล'],
      },
      onRow,
      onBatchBoundary,
    );

    expect(onRow).toHaveBeenNthCalledWith(
      1,
      ['เลขบัตรประชาชน13หลัก', 'ชื่อ', 'นามสกุล'],
      expect.objectContaining({
        nationalId: '1111111111111',
        firstNameTh: 'สมชาย',
        lastNameTh: 'ใจดี',
      }),
      2,
    );
    expect(onRow).toHaveBeenNthCalledWith(
      2,
      ['ชื่อ', 'นามสกุล', 'เลขบัตรประชาชน13หลัก'],
      expect.objectContaining({
        nationalId: '2222222222222',
        firstNameTh: 'สมหญิง',
        lastNameTh: 'ใจงาม',
      }),
      4,
    );
  });

  it('re-detects headers when a new header row appears later in the stream', async () => {
    mockWorkbookReader.mockImplementationOnce((): any =>
      createAsyncIterable([
        createAsyncIterable([
          { values: [undefined, 'เลขบัตรประชาชน13หลัก', 'ชื่อ', 'นามสกุล'] },
          { values: [undefined, '1111111111111', 'สมชาย', 'ใจดี'] },
          { values: [undefined, 'ชื่อ', 'นามสกุล', 'เลขบัตรประชาชน13หลัก'] },
          { values: [undefined, 'สมหญิง', 'ใจงาม', '2222222222222'] },
        ]),
      ]),
    );

    const onRow = jest.fn();
    const onBatchBoundary = jest.fn().mockResolvedValue(undefined);

    await (service as any).streamXlsxWorksheet(
      '/tmp/test.xlsx',
      {
        nationalId: ['เลขบัตรประชาชน13หลัก'],
        firstNameTh: ['ชื่อ'],
        lastNameTh: ['นามสกุล'],
      },
      onRow,
      onBatchBoundary,
    );

    expect(onRow).toHaveBeenCalledTimes(2);
    expect(onRow).toHaveBeenNthCalledWith(
      2,
      ['ชื่อ', 'นามสกุล', 'เลขบัตรประชาชน13หลัก'],
      expect.objectContaining({
        nationalId: '2222222222222',
        firstNameTh: 'สมหญิง',
        lastNameTh: 'ใจงาม',
      }),
      4,
    );
  });

  it('re-detects merged two-row headers when they appear again later in the stream', async () => {
    mockWorkbookReader.mockImplementationOnce((): any =>
      createAsyncIterable([
        createAsyncIterable([
          { values: [undefined, 'ข้อมูลผู้สมัคร', 'ข้อมูลผู้สมัคร', 'ข้อมูลผู้สมัคร'] },
          { values: [undefined, 'เลขบัตรประชาชน13หลัก', 'ชื่อ', 'นามสกุล'] },
          { values: [undefined, '1111111111111', 'สมชาย', 'ใจดี'] },
          { values: [undefined, 'ข้อมูลผู้สมัคร', 'ข้อมูลผู้สมัคร', 'ข้อมูลผู้สมัคร'] },
          { values: [undefined, 'เลขบัตรประชาชน13หลัก', 'ชื่อ', 'นามสกุล'] },
          { values: [undefined, '2222222222222', 'สมหญิง', 'ใจงาม'] },
        ]),
      ]),
    );

    const onRow = jest.fn();
    const onBatchBoundary = jest.fn().mockResolvedValue(undefined);

    await (service as any).streamXlsxWorksheet(
      '/tmp/test.xlsx',
      {
        nationalId: ['เลขบัตรประชาชน13หลัก'],
        firstNameTh: ['ชื่อ'],
        lastNameTh: ['นามสกุล'],
      },
      onRow,
      onBatchBoundary,
    );

    expect(onRow).toHaveBeenCalledTimes(2);
    expect(onRow).toHaveBeenNthCalledWith(
      2,
      ['เลขบัตรประชาชน13หลัก', 'ชื่อ', 'นามสกุล'],
      expect.objectContaining({
        nationalId: '2222222222222',
        firstNameTh: 'สมหญิง',
        lastNameTh: 'ใจงาม',
      }),
      6,
    );
  });

  it('falls back to a generated location name when the location row name is blank', () => {
    const row = (service as any).mapLocationRow({
      code: '13',
      name: '   ',
      province: 'กรุงเทพมหานคร',
      seatCapacity: '2000',
    });

    expect(row).toMatchObject({
      code: '13',
      name: 'กรุงเทพมหานคร 13',
      province: 'กรุงเทพมหานคร',
      seatCapacity: 2000,
    });
  });

  it('parses exam date and time metadata from a locations row', () => {
    const row = (service as any).mapLocationRow({
      code: '8',
      name: 'สนามสอบ 8',
      eventDate: 'วันเสาร์ 8 ส.ค. 2569',
      timeRange: '13.00-16.00 น.',
    });

    expect(row.eventDate).toBeInstanceOf(Date);
    expect(row.eventDate?.getFullYear()).toBe(2026);
    expect(row.eventDate?.getMonth()).toBe(7);
    expect(row.eventDate?.getDate()).toBe(8);
    expect(row.eventStartMinutes).toBe(13 * 60);
    expect(row.eventEndMinutes).toBe(16 * 60);
  });

  it('parses combined schedule text from the กำหนดการ column in locations rows', () => {
    const row = (service as any).mapLocationRow({
      code: '8',
      name: 'สนามสอบ 8',
      eventDate: 'วันเสาร์ 8 ส.ค. 2569 เวลา 13.00-16.00 น.',
      timeRange: 'วันเสาร์ 8 ส.ค. 2569 เวลา 13.00-16.00 น.',
    });

    expect(row.eventDate).toBeInstanceOf(Date);
    expect(row.eventDate?.getFullYear()).toBe(2026);
    expect(row.eventDate?.getMonth()).toBe(7);
    expect(row.eventDate?.getDate()).toBe(8);
    expect(row.eventStartMinutes).toBe(13 * 60);
    expect(row.eventEndMinutes).toBe(16 * 60);
  });

  it('hydrates merged location cells from the previous row context', () => {
    const hydrated = (service as any).hydrateLocationRowFromPreviousContext(
      {
        code: '2',
        name: '',
        province: '',
        address: 'ห้อง PSB1101',
        eventDate: '',
        timeRange: '',
      },
      {
        name: 'คณะรัฐศาสตร์และรัฐประศาสนศาสตร์ ม.เชียงใหม่',
        province: 'จ.เชียงใหม่',
        eventDate: 'Sunday 2 Aug 2026',
        timeRange: 'Sunday 2 Aug 2026',
      },
    );

    expect(hydrated).toMatchObject({
      code: '2',
      name: 'คณะรัฐศาสตร์และรัฐประศาสนศาสตร์ ม.เชียงใหม่',
      province: 'จ.เชียงใหม่',
      address: 'ห้อง PSB1101',
      eventDate: 'Sunday 2 Aug 2026',
      timeRange: 'Sunday 2 Aug 2026',
    });
  });

  it('maps merged-style location rows into complete location records', () => {
    const hydrated = (service as any).hydrateLocationRowFromPreviousContext(
      {
        code: '2',
        name: '',
        province: '',
        address: 'ห้อง PSB1101',
        eventDate: '',
        timeRange: '',
      },
      {
        name: 'คณะรัฐศาสตร์และรัฐประศาสนศาสตร์ ม.เชียงใหม่',
        province: 'จ.เชียงใหม่',
        eventDate: 'Sunday 2 Aug 2026',
        timeRange: 'Sunday 2 Aug 2026',
      },
    );

    const row = (service as any).mapLocationRow(hydrated);

    expect(row).toMatchObject({
      code: '2',
      name: 'คณะรัฐศาสตร์และรัฐประศาสนศาสตร์ ม.เชียงใหม่',
      province: 'จ.เชียงใหม่',
      address: 'ห้อง PSB1101',
    });
    expect(row.eventDate).toBeInstanceOf(Date);
  });

  it('recovers the location code from raw row values when the mapped code cell is empty', () => {
    const row = (service as any).mapLocationRow({
      code: '',
      name: 'รอประกาศสนามสอบ',
      province: 'กรุงเทพมหานคร',
      address: 'รอประกาศ',
      eventDate: 'Saturday 5 Sep 2026',
      __rawValues: [13, 'กรุงเทพมหานคร', 'รอประกาศสนามสอบ', 'รอประกาศ', 'Saturday 5 Sep 2026', 0],
    });

    expect(row).toMatchObject({
      code: '13',
      name: 'รอประกาศสนามสอบ',
      province: 'กรุงเทพมหานคร',
      address: 'รอประกาศ',
      seatCapacity: 0,
    });
  });

  it('fails explicitly when a location-like row has content but no recoverable code', () => {
    expect(() =>
      (service as any).mapLocationRow({
        code: '',
        name: 'รอประกาศสนามสอบ',
        province: 'จ.ขอนแก่น',
        address: 'รอประกาศ',
        eventDate: 'Saturday 12 Sep 2026',
        __rawValues: ['', 'จ.ขอนแก่น', 'รอประกาศสนามสอบ', 'รอประกาศ', 'Saturday 12 Sep 2026', 0],
      }),
    ).toThrow('code is required in location rows');
  });

  it('skips the summary total row instead of treating it as a location import error', () => {
    const row = (service as any).mapLocationRow({
      code: '',
      __rawValues: ['รวม', { richText: [{ text: '0' }] }],
    });

    expect(row).toBeNull();
  });

  it('normalizes rich text worksheet cell values before parsing rows', () => {
    expect((service as any).asString({ richText: [{ text: 'สนามสอบที่ ' }, { text: '14' }] })).toBe('สนามสอบที่14');
    expect((service as any).asString({ result: 0 })).toBe('0');
  });

  it('does not misclassify location data rows with สนามสอบ in the name as header fragments', () => {
    expect(
      (service as any).isPotentialHeaderFragment([
        '13',
        'กรุงเทพมหานคร',
        'รอประกาศสนามสอบ',
        'รอประกาศ',
        'saturday5sep2026',
        '0',
      ]),
    ).toBe(false);
  });

  it('overwrites the existing seat capacity with 0 when a re-uploaded location row has seatCapacity set to 0', async () => {
    prisma.examLocation.upsert.mockResolvedValue({
      id: 'location-1',
      code: '8',
      name: 'สนามสอบ 8',
    });

    await (service as any).flushLocationBatch(
      [
        {
          code: '8',
          name: 'สนามสอบ 8',
          province: 'เชียงใหม่',
          seatCapacity: 0,
        },
      ],
      'import-1',
    );

    expect(prisma.examLocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          code: '8',
          name: 'สนามสอบ 8',
          province: 'เชียงใหม่',
          seatCapacity: 0,
          importedFromId: 'import-1',
          active: true,
        }),
        create: expect.objectContaining({
          seatCapacity: 0,
        }),
      }),
    );
  });

  it('overwrites the existing seat capacity when a re-uploaded location row has a non-zero seatCapacity', async () => {
    prisma.examLocation.upsert.mockResolvedValue({
      id: 'location-1',
      code: '8',
      name: 'สนามสอบ 8',
    });

    await (service as any).flushLocationBatch(
      [
        {
          code: '8',
          name: 'สนามสอบ 8',
          province: 'เชียงใหม่',
          seatCapacity: 1250,
        },
      ],
      'import-1',
    );

    expect(prisma.examLocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          seatCapacity: 1250,
        }),
        create: expect.objectContaining({
          seatCapacity: 1250,
        }),
      }),
    );
  });

  it('persists score data only for simulated enrollments with score values', async () => {
    prisma.student.createManyAndReturn.mockResolvedValue([{ id: 'student-1', nationalId: '1102400222395' }]);
    prisma.enrollment.findMany.mockResolvedValue([{ 
      barcode: '12345678',
      notes: null,
      examRound: ExamRound.AFTERNOON,
      student: {
        nationalId: '1102400222395',
      },
    }]);
    prisma.enrollment.upsert.mockResolvedValue({ id: 'enrollment-1', barcode: '12345678', notes: null });

    await (service as any).flushEnrollmentBatch(
      [
        {
          rowNumber: 3,
          row: {
            nationalId: '1102400222395',
            firstNameTh: 'ศิริศักดิ์',
            lastNameTh: 'ธิดชัชวาลกุล',
            registeredAt: new Date('2026-03-01T09:00:00.000Z'),
            tgat: 79.0384,
            tgat1: 67.2342,
            tgat2: 65.0043,
            tgat3: 56.1234,
            rankingLocation: 12,
            rankingOverall: 567,
            rankingLocationTgat1: 123,
            rankingOverallTgat1: 1234,
            rankingLocationTgat2: 234,
            rankingOverallTgat2: 2234,
            rankingLocationTgat3: 99,
            rankingOverallTgat3: 2222,
          },
        },
      ],
      {
        academicYear: 2026,
        round: ExamRound.AFTERNOON,
        sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        importFileId: 'import-1',
      },
    );

    expect(prisma.score.upsert).toHaveBeenCalledWith({
      where: { enrollmentId: 'enrollment-1' },
      update: {
        tgat: 79.0384,
        tgat1: 67.2342,
        tgat2: 65.0043,
        tgat3: 56.1234,
        rankingOverall: 567,
        rankingLocation: 12,
        rankingOverallTgat1: 1234,
        rankingLocationTgat1: 123,
        rankingOverallTgat2: 2234,
        rankingLocationTgat2: 234,
        rankingOverallTgat3: 2222,
        rankingLocationTgat3: 99,
        percentile: undefined,
      },
      create: {
        enrollmentId: 'enrollment-1',
        tgat: 79.0384,
        tgat1: 67.2342,
        tgat2: 65.0043,
        tgat3: 56.1234,
        rankingOverall: 567,
        rankingLocation: 12,
        rankingOverallTgat1: 1234,
        rankingLocationTgat1: 123,
        rankingOverallTgat2: 2234,
        rankingLocationTgat2: 234,
        rankingOverallTgat3: 2222,
        rankingLocationTgat3: 99,
        percentile: undefined,
      },
    });
  });

  it('does not create score records for onsite imports', async () => {
    prisma.student.createManyAndReturn.mockResolvedValue([{ id: 'student-1', nationalId: '1102400222395' }]);
    prisma.enrollment.findMany.mockResolvedValue([{ 
      barcode: '12345678',
      notes: null,
      examRound: ExamRound.MORNING,
      student: {
        nationalId: '1102400222395',
      },
    }]);
    prisma.enrollment.upsert.mockResolvedValue({ id: 'enrollment-1', barcode: '12345678', notes: null });

    await (service as any).flushEnrollmentBatch(
      [
        {
          rowNumber: 3,
          row: {
            nationalId: '1102400222395',
            firstNameTh: 'ศิริศักดิ์',
            lastNameTh: 'ธิดชัชวาลกุล',
            registeredAt: new Date('2026-03-01T09:00:00.000Z'),
            tgat: 79.0384,
          },
        },
      ],
      {
        academicYear: 2026,
        round: ExamRound.MORNING,
        sourceType: EnrollmentSourceType.ONSITE_EXCEL,
        importFileId: 'import-1',
      },
    );

    expect(prisma.score.upsert).not.toHaveBeenCalled();
  });

  it('uses the exam round from each simulated row when present', async () => {
    prisma.student.createManyAndReturn.mockResolvedValue([
      { id: 'student-1', nationalId: '1102400222395' },
      { id: 'student-2', nationalId: '1101000275466' },
    ]);
    prisma.enrollment.findMany.mockResolvedValue([]);
    prisma.enrollment.upsert.mockResolvedValue({ id: 'enrollment-1', barcode: '12345678', notes: null });

    await (service as any).flushEnrollmentBatch(
      [
        {
          rowNumber: 3,
          row: {
            nationalId: '1102400222395',
            firstNameTh: 'ศิริศักดิ์',
            lastNameTh: 'ธิดชัชวาลกุล',
            examRound: ExamRound.MORNING,
          },
        },
        {
          rowNumber: 4,
          row: {
            nationalId: '1101000275466',
            firstNameTh: 'ฤทธิเกียรติ',
            lastNameTh: 'ชูรัตน์',
            examRound: ExamRound.AFTERNOON,
          },
        },
      ],
      {
        academicYear: 2026,
        round: ExamRound.AFTERNOON,
        sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        importFileId: 'import-1',
      },
    );

    expect(prisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId_academicYear_examRound_sourceType: {
            studentId: 'student-1',
            academicYear: 2026,
            examRound: ExamRound.MORNING,
            sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
          },
        },
      }),
    );
    expect(prisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId_academicYear_examRound_sourceType: {
            studentId: 'student-2',
            academicYear: 2026,
            examRound: ExamRound.AFTERNOON,
            sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
          },
        },
      }),
    );
  });

  it('keeps onsite and simulated enrollments separate when student year and round match', async () => {
    prisma.student.createManyAndReturn.mockResolvedValue([{ id: 'student-1', nationalId: '1102400222395' }]);
    prisma.enrollment.findMany.mockResolvedValue([
      {
        barcode: '12345678',
        notes: 'existing-onsite',
        examRound: ExamRound.MORNING,
        sourceType: EnrollmentSourceType.ONSITE_EXCEL,
        student: {
          nationalId: '1102400222395',
        },
      },
    ]);
    prisma.enrollment.upsert.mockResolvedValue({ id: 'enrollment-1', barcode: '87654321', notes: null });

    await (service as any).flushEnrollmentBatch(
      [
        {
          rowNumber: 3,
          row: {
            nationalId: '1102400222395',
            firstNameTh: 'ศิริศักดิ์',
            lastNameTh: 'ธิดชัชวาลกุล',
            examRound: ExamRound.MORNING,
          },
        },
      ],
      {
        academicYear: 2026,
        round: ExamRound.MORNING,
        sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        importFileId: 'import-2',
      },
    );

    expect(prisma.enrollment.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          academicYear: 2026,
          sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        }),
      }),
    );
    expect(prisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId_academicYear_examRound_sourceType: {
            studentId: 'student-1',
            academicYear: 2026,
            examRound: ExamRound.MORNING,
            sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
          },
        },
        create: expect.objectContaining({
          barcode: expect.any(String),
          sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        }),
      }),
    );
  });

  it('soft deletes the same student historical enrollments from other academic years before importing the latest year', async () => {
    prisma.student.createManyAndReturn.mockResolvedValue([{ id: 'student-1', nationalId: '1102400222395' }]);
    prisma.enrollment.findMany.mockResolvedValue([]);
    prisma.enrollment.upsert.mockResolvedValue({ id: 'enrollment-1', barcode: '87654321', notes: null });

    await (service as any).flushEnrollmentBatch(
      [
        {
          rowNumber: 3,
          row: {
            nationalId: '1102400222395',
            firstNameTh: 'ศิริศักดิ์',
            lastNameTh: 'ธิดชัชวาลกุล',
            examRound: ExamRound.MORNING,
          },
        },
      ],
      {
        academicYear: 2027,
        round: ExamRound.MORNING,
        sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        importFileId: 'import-3',
      },
    );

    expect(prisma.enrollment.updateMany).toHaveBeenCalledWith({
      where: {
        studentId: 'student-1',
        academicYear: {
          not: 2027,
        },
        deletedAt: null,
      },
      data: {
        deletedAt: expect.any(Date),
      },
    });
    expect(prisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId_academicYear_examRound_sourceType: {
            studentId: 'student-1',
            academicYear: 2027,
            examRound: ExamRound.MORNING,
            sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
          },
        },
      }),
    );
  });

  it('uses matched location time metadata for simulated enrollment windows', async () => {
    prisma.student.createManyAndReturn.mockResolvedValue([{ id: 'student-1', nationalId: '1102400222395' }]);
    prisma.examLocation.findMany.mockResolvedValue([
      {
        id: 'location-8',
        code: '8',
        name: 'สนามสอบ 8',
        eventDate: new Date('2026-08-08T00:00:00.000Z'),
        eventStartMinutes: 13 * 60,
        eventEndMinutes: 16 * 60,
      },
    ]);
    prisma.enrollment.findMany.mockResolvedValue([]);
    prisma.enrollment.upsert.mockResolvedValue({ id: 'enrollment-1', barcode: '12345678', notes: null });

    await (service as any).flushEnrollmentBatch(
      [
        {
          rowNumber: 3,
          row: {
            nationalId: '1102400222395',
            firstNameTh: 'ณมญ',
            lastNameTh: 'ไทยภิรมย์สามัคคี',
            locationCode: '8',
            registeredAt: new Date('2026-08-08T00:00:00.000Z'),
          },
        },
      ],
      {
        academicYear: 2026,
        round: ExamRound.AFTERNOON,
        sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        importFileId: 'import-1',
      },
    );

    expect(prisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          registrationStartAt: expect.any(Date),
          registrationEndAt: expect.any(Date),
        }),
      }),
    );

    const upsertCall = prisma.enrollment.upsert.mock.calls[0][0];
    expect(upsertCall.update.registrationStartAt.getHours()).toBe(13);
    expect(upsertCall.update.registrationEndAt.getHours()).toBe(16);
  });

  it('captures row persistence errors without aborting the whole batch', async () => {
    prisma.student.createManyAndReturn.mockResolvedValue([
      { id: 'student-1', nationalId: '1102400222395' },
      { id: 'student-2', nationalId: '1101000275466' },
    ]);
    prisma.student.update
      .mockRejectedValueOnce(new Error('invalid byte sequence for encoding UTF8'))
      .mockResolvedValueOnce(undefined);
    prisma.enrollment.findMany.mockResolvedValue([{ 
      barcode: '12345678',
      notes: null,
      examRound: ExamRound.AFTERNOON,
      student: {
        nationalId: '1101000275466',
      },
    }]);
    prisma.enrollment.upsert.mockResolvedValue({ id: 'enrollment-2', barcode: '12345678', notes: null });

    const result = await (service as any).flushEnrollmentBatch(
      [
        {
          rowNumber: 3,
          row: {
            nationalId: '1102400222395',
            firstNameTh: 'ศิริศักดิ์',
            lastNameTh: 'ธิดชัชวาลกุล',
          },
        },
        {
          rowNumber: 4,
          row: {
            nationalId: '1101000275466',
            firstNameTh: 'ฤทธิเกียรติ',
            lastNameTh: 'ชูรัตน์',
          },
        },
      ],
      {
        academicYear: 2026,
        round: ExamRound.AFTERNOON,
        sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        importFileId: 'import-1',
      },
    );

    expect(result.processedCount).toBe(1);
    expect(result.errors).toEqual(['Row 3: invalid byte sequence for encoding UTF8']);
    expect(prisma.enrollment.upsert).toHaveBeenCalledTimes(1);
  });

  it('resolves simulated rows without identifiers by uniquely matching an existing student name', async () => {
    const row = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '73', 'กรรณิการ์ บัณฑิตย์', '8', 'รอบเช้า : เวลา 09.00-12.00 น.', '67.2222'],
    });

    prisma.student.findMany.mockResolvedValueOnce([
      {
        id: 'student-73',
        nationalId: '1229901272323',
        firstNameTh: 'กรรณิการ์',
        lastNameTh: 'บัณฑิตย์',
      },
    ]);

    const studentMap = await (service as any).prepareStudentMap([{ rowNumber: 75, row }]);

    expect(row.nationalId).toBe('1229901272323');
    expect(studentMap.get('1229901272323')).toMatchObject({
      id: 'student-73',
      nationalId: '1229901272323',
    });
    expect(prisma.student.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('creates a deterministic synthetic identifier when a name-only simulated row does not match an existing student', async () => {
    const row = (service as any).mapEnrollmentRow({
      __rawValues: [undefined, '2446', 'พิชญากร ลาอาจ', '8', 'รอบเช้า : เวลา 09.00-12.00 น.', '38.75'],
    });

    prisma.student.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'student-auto-1',
        nationalId: 'AUTO-0A3A6A5C0B1BB62C',
      },
    ]);
    prisma.student.createManyAndReturn.mockResolvedValueOnce([
      {
        id: 'student-auto-1',
        nationalId: 'AUTO-8AE77A18FA44CCA5',
      },
    ]);

    const studentMap = await (service as any).prepareStudentMap([{ rowNumber: 2446, row }]);

    expect(row.nationalId).toMatch(/^AUTO-[A-F0-9]{16}$/);

    expect(prisma.student.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            nationalId: row.nationalId,
            firstNameTh: 'พิชญากร',
            lastNameTh: 'ลาอาจ',
          }),
        ],
      }),
    );
    expect(studentMap.get(row.nationalId)).toMatchObject({
      id: 'student-auto-1',
      nationalId: 'AUTO-8AE77A18FA44CCA5',
    });
  });

  it('stores province when creating an onsite exam location from the imported row', async () => {
    prisma.examLocation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.examLocation.upsert.mockResolvedValue({
      id: 'location-1',
      code: 'ONSITE-CMU-HALL',
      name: 'หอประชุมใหญ่ มหาวิทยาลัยเชียงใหม่',
      province: 'เชียงใหม่',
    });

    const location = await (service as any).resolveExamLocationForEnrollment(
      'หอประชุมใหญ่ มหาวิทยาลัยเชียงใหม่',
      EnrollmentSourceType.ONSITE_EXCEL,
      'import-1',
      'เชียงใหม่',
    );

    expect(prisma.examLocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          province: 'เชียงใหม่',
        }),
        create: expect.objectContaining({
          province: 'เชียงใหม่',
        }),
      }),
    );
    expect(location).toMatchObject({
      province: 'เชียงใหม่',
    });
  });

  it('backfills province for an existing onsite exam location when it was previously blank', async () => {
    prisma.examLocation.findFirst.mockResolvedValueOnce({
      id: 'location-1',
      code: 'ONSITE-CMU-HALL',
      name: 'หอประชุมใหญ่ มหาวิทยาลัยเชียงใหม่',
      province: null,
    });
    prisma.examLocation.update.mockResolvedValue({
      id: 'location-1',
      code: 'ONSITE-CMU-HALL',
      name: 'หอประชุมใหญ่ มหาวิทยาลัยเชียงใหม่',
      province: 'เชียงใหม่',
    });

    const location = await (service as any).resolveExamLocationForEnrollment(
      'หอประชุมใหญ่ มหาวิทยาลัยเชียงใหม่',
      EnrollmentSourceType.ONSITE_EXCEL,
      'import-1',
      'เชียงใหม่',
    );

    expect(prisma.examLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: {
        province: 'เชียงใหม่',
        importedFromId: 'import-1',
        active: true,
      },
    });
    expect(location).toMatchObject({
      province: 'เชียงใหม่',
    });
  });
});