import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { createHash, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import {
  EnrollmentSourceType,
  ExamRound,
  EnrollmentStatus,
  Prisma,
} from './generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';

const requireFromProjectRoot = createRequire(`${process.cwd()}/`);

function requireProjectDependency<T>(preferredPath: string, fallbackPath: string): T {
  try {
    return requireFromProjectRoot(preferredPath) as T;
  } catch (error: any) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }

    return requireFromProjectRoot(fallbackPath) as T;
  }
}

const ExcelJS = requireProjectDependency<any>('./.deps/node_modules/exceljs', 'exceljs');

type UploadFile = {
  path: string;
  filename: string;
  originalname: string;
};

type ImportRequest = {
  academicYear: number;
  onsiteRound?: string;
  simulatedRound?: string;
  examDate?: string;
  uploadedById?: string;
  files: {
    onsite?: UploadFile[];
    simulated?: UploadFile[];
    locations?: UploadFile[];
  };
};

type EnrollmentImportRow = {
  nationalId: string;
  prefix?: string;
  firstNameTh: string;
  lastNameTh: string;
  firstNameEn?: string;
  lastNameEn?: string;
  email?: string;
  phone?: string;
  schoolName?: string;
  province?: string;
  locationCode?: string;
  examRound?: ExamRound;
  importedExamRoundLabel?: string;
  registeredAt?: Date;
  tgat?: number;
  tgat1?: number;
  tgat2?: number;
  tgat3?: number;
  rankingOverall?: number;
  rankingLocation?: number;
  rankingOverallTgat1?: number;
  rankingLocationTgat1?: number;
  rankingOverallTgat2?: number;
  rankingLocationTgat2?: number;
  rankingOverallTgat3?: number;
  rankingLocationTgat3?: number;
  percentile?: number;
};

type EnrollmentBatchItem = {
  row: EnrollmentImportRow;
  rowNumber: number;
};

type LocationImportRow = {
  code: string;
  name: string;
  province?: string;
  address?: string;
  seatCapacity?: number;
  eventDate?: Date;
  eventStartMinutes?: number;
  eventEndMinutes?: number;
};

type ImportBatchResult = {
  fileId: string;
  rowCount: number;
  successCount: number;
  failedCount: number;
  errors: string[];
  warnings: string[];
  reconciledCount?: number;
  unresolvedLocationCount?: number;
  durationMs?: number;
  headerDetections?: Array<{
    rowNumber: number;
    headers: string[];
  }>;
};

type EnrollmentImportBatchResult = ImportBatchResult & {
  importedStudentIds: string[];
};

type ImportResponse = {
  meta: {
    parserVersion: string;
    importBatchSize: number;
    importConcurrency: number;
  };
  locations: ImportBatchResult | null;
  onsite: ImportBatchResult | null;
  simulated: ImportBatchResult | null;
};

type HeaderResolverConfig = Record<string, string[]>;

const ENROLLMENT_HEADERS: HeaderResolverConfig = {
  nationalId: ['nationalid', 'เลขบัตรประชาชน', 'เลขประจำตัวประชาชน', 'citizenid', 'เลขบัตร', 'เลขบัตรปชช', 'เลขบัตรประชาชน13หลัก'],
  prefix: ['prefix', 'คำนำหน้า'],
  firstNameTh: ['firstname', 'ชื่อ', 'ชื่อไทย', 'firstnameth', 'ชื่อจริง', 'ชื่อจริงไทย'],
  lastNameTh: ['lastname', 'นามสกุล', 'นามสกุลไทย', 'lastnameth', 'นามสกุลจริง', 'สกุล'],
  firstNameEn: ['firstnameen', 'ชื่ออังกฤษ'],
  lastNameEn: ['lastnameen', 'นามสกุลอังกฤษ'],
  email: ['email', 'อีเมล'],
  phone: ['phone', 'mobile', 'เบอร์โทรศัพท์', 'เบอร์โทร'],
  schoolName: ['school', 'schoolname', 'โรงเรียน'],
  province: ['province', 'จังหวัด'],
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
    'สนามสอบ/สถานที่สอบ',
  ],
  examRound: ['examround', 'รอบการสอบ', 'รอบสอบ'],
  registeredAt: ['registeredat', 'registrationdate', 'วันที่สมัคร', 'วันที่สอบ', 'วันที่จัดกิจกรรม', 'examdate', 'วันที่', 'วันจัดงาน'],
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
  percentile: ['percentile', 'เปอร์เซ็นไทล์', 'เปอร์เซ็นต์ไทล์'],
};

type RequiredHeaderField = 'nationalId' | 'firstNameTh' | 'lastNameTh' | 'code' | 'name';

const LOCATION_HEADERS: HeaderResolverConfig = {
  code: ['code', 'locationcode', 'รหัสสนามสอบ', 'รหัสสถานที่สอบ', 'สนามสอบที่'],
  name: ['name', 'locationname', 'ชื่อสนามสอบ', 'สนามสอบ', 'ชื่อสถานที่สอบ'],
  province: ['province', 'จังหวัด'],
  address: ['address', 'ที่อยู่', 'ห้องสอบ'],
  seatCapacity: ['seatcapacity', 'capacity', 'จำนวนที่นั่ง', 'จำนวนผู้เข้าสอบ'],
  eventDate: ['eventdate', 'examdate', 'date', 'วันที่สอบ', 'วันที่จัดสอบ', 'วันที่', 'วันสอบ', 'กำหนดการ'],
  timeRange: ['timerange', 'time', 'เวลาสอบ', 'เวลา', 'ช่วงเวลา', 'รอบเวลา', 'กำหนดการ'],
  startTime: ['starttime', 'เวลาเริ่ม', 'เวลาเริ่มสอบ', 'เริ่มสอบ'],
  endTime: ['endtime', 'เวลาสิ้นสุด', 'เวลาเลิกสอบ', 'สิ้นสุด', 'เลิกสอบ'],
};

const PENDING_LOCATION_PREFIX = 'pendingLocationCode:';
const NAME_FALLBACK_IDENTIFIER_PREFIX = '__NAME__:';
const BARCODE_LENGTH = 8;
const BARCODE_MAX_GENERATION_ATTEMPTS = 25;
const EIGHT_DIGIT_BARCODE_PATTERN = /^\d{8}$/;
const IMPORT_PARSER_VERSION = '2026-04-25-locations-schedule-text-v12';
const THAI_NAME_PREFIXES = new Set(['นาย', 'นาง', 'นางสาว', 'เด็กชาย', 'เด็กหญิง']);
const THAI_MONTH_ALIASES = new Map<string, number>([
  ['ม.ค.', 0],
  ['มกราคม', 0],
  ['ก.พ.', 1],
  ['กุมภาพันธ์', 1],
  ['มี.ค.', 2],
  ['มีนาคม', 2],
  ['เม.ย.', 3],
  ['เมษายน', 3],
  ['พ.ค.', 4],
  ['พฤษภาคม', 4],
  ['มิ.ย.', 5],
  ['มิถุนายน', 5],
  ['ก.ค.', 6],
  ['กรกฎาคม', 6],
  ['ส.ค.', 7],
  ['สิงหาคม', 7],
  ['ก.ย.', 8],
  ['กันยายน', 8],
  ['ต.ค.', 9],
  ['ตุลาคม', 9],
  ['พ.ย.', 10],
  ['พฤศจิกายน', 10],
  ['ธ.ค.', 11],
  ['ธันวาคม', 11],
]);


function readPositiveIntEnv(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const rawValue = parseInt(process.env[name] || '', 10);

  if (!Number.isFinite(rawValue) || rawValue < min) {
    return fallback;
  }

  return Math.min(rawValue, max);
}
type ResolvedExamLocation = {
  id: string;
  code: string;
  name: string;
  province?: string | null;
  eventDate?: Date | null;
  eventStartMinutes?: number | null;
  eventEndMinutes?: number | null;
};

@Injectable()
export class ImportsService {
  private readonly batchSize = readPositiveIntEnv('IMPORT_BATCH_SIZE', 250, 50, 2000);
  private readonly importConcurrency = readPositiveIntEnv('IMPORT_CONCURRENCY', 3, 1, 12);
  private readonly logger = new Logger(ImportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importExcelFiles(request: ImportRequest) {
    if (!request?.files) {
      throw new BadRequestException('files payload is required');
    }

    const academicYear = Number(request.academicYear);
    const hasAnyFile = Boolean(
      request.files.locations?.length || request.files.onsite?.length || request.files.simulated?.length,
    );

    if (!Number.isInteger(academicYear) || academicYear < 2000) {
      throw new BadRequestException('academicYear is required and must be a valid year');
    }

    if (!hasAnyFile) {
      throw new BadRequestException('At least one import file is required');
    }

    const response: ImportResponse = {
      meta: {
        parserVersion: IMPORT_PARSER_VERSION,
        importBatchSize: this.batchSize,
        importConcurrency: this.importConcurrency,
      },
      locations: null,
      onsite: null,
      simulated: null,
    };
    const importedStudentIdsBySource = new Map<EnrollmentSourceType, Set<string>>();
    const startedAt = Date.now();

    try {
      if (request.files.locations?.[0]) {
        response.locations = await this.importLocations(request.files.locations[0], request.uploadedById, academicYear);
      }

      if (request.files.onsite?.[0]) {
        const onsiteResult = await this.importEnrollments({
          file: request.files.onsite[0],
          academicYear,
          round: this.parseExamRound(request.onsiteRound, 'MORNING'),
          sourceType: EnrollmentSourceType.ONSITE_EXCEL,
          uploadedById: request.uploadedById,
          examDate: request.examDate,
        });
        const { importedStudentIds, ...onsiteSummary } = onsiteResult;
        response.onsite = onsiteSummary;
        importedStudentIdsBySource.set(EnrollmentSourceType.ONSITE_EXCEL, new Set(importedStudentIds));
      }

      if (request.files.simulated?.[0]) {
        const simulatedResult = await this.importEnrollments({
          file: request.files.simulated[0],
          academicYear,
          round: this.parseExamRound(request.simulatedRound, 'AFTERNOON'),
          sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
          uploadedById: request.uploadedById,
          examDate: request.examDate,
        });
        const { importedStudentIds, ...simulatedSummary } = simulatedResult;
        response.simulated = simulatedSummary;
        importedStudentIdsBySource.set(
          EnrollmentSourceType.SIMULATED_EXCEL,
          new Set(importedStudentIds),
        );
      }

      if (importedStudentIdsBySource.size > 0) {
        await this.softDeleteStaleCurrentYearEnrollmentSources(academicYear, importedStudentIdsBySource);
      }

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `Completed import request for academicYear=${academicYear} in ${durationMs}ms ` +
          `(locations=${response.locations?.successCount ?? 0}/${response.locations?.rowCount ?? 0}, ` +
          `onsite=${response.onsite?.successCount ?? 0}/${response.onsite?.rowCount ?? 0}, ` +
          `simulated=${response.simulated?.successCount ?? 0}/${response.simulated?.rowCount ?? 0}, ` +
          `batchSize=${this.batchSize}, concurrency=${this.importConcurrency}, parserVersion=${IMPORT_PARSER_VERSION})`,
      );

      return response;
    } finally {
      await this.cleanupFiles(request.files);
    }
  }

  private async importLocations(file: UploadFile, uploadedById: string | undefined, academicYear: number) {
    const startedAt = Date.now();
    const importFile = await this.prisma.importFile.create({
      data: {
        fileName: file.filename,
        originalName: file.originalname,
        sourceType: EnrollmentSourceType.API,
        academicYear,
        uploadedById,
      },
    });

    const batch: LocationImportRow[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const headerDetections: Array<{ rowNumber: number; headers: string[] }> = [];
    let rowCount = 0;
    let successCount = 0;
    let reconciledCount = 0;
    let headers: string[] = [];
    let previousLocationContext: Partial<Record<'name' | 'province' | 'seatCapacity' | 'eventDate' | 'timeRange' | 'startTime' | 'endTime', unknown>> = {};

    await this.streamWorksheet(
      file.path,
      file.originalname,
      LOCATION_HEADERS,
      (resolvedHeaders, row, rowNumber) => {
      headers = resolvedHeaders;

      try {
        const hydratedRow = this.hydrateLocationRowFromPreviousContext(row, previousLocationContext);
        const mappedRow = this.mapLocationRow(hydratedRow);

        if (mappedRow) {
          rowCount += 1;
          batch.push(mappedRow);
          previousLocationContext = this.captureLocationRowContext(hydratedRow, previousLocationContext);
        }
      } catch (error) {
        rowCount += 1;
        errors.push(this.formatRowError(rowNumber, error));
      }
      },
      async () => {
      const batchResult = await this.flushLocationBatch(batch, importFile.id);
      successCount += batchResult.processedCount;
      reconciledCount += batchResult.reconciledCount;
      batch.length = 0;
      },
      (detectedHeaders, rowNumber) => {
        headerDetections.push({ headers: detectedHeaders, rowNumber });
      },
    );

    if (headerDetections.length === 0 && rowCount === 0 && successCount === 0 && errors.length === 0) {
      throw new BadRequestException(
        `locations file ${file.originalname} could not be parsed: no recognizable header row was found`,
      );
    }

    if (batch.length > 0) {
      const batchResult = await this.flushLocationBatch(batch, importFile.id);
      successCount += batchResult.processedCount;
      reconciledCount += batchResult.reconciledCount;
    }

    if (reconciledCount > 0) {
      warnings.push(`จับคู่สนามสอบอัตโนมัติให้รายการที่รออยู่แล้ว ${reconciledCount} รายการ`);
    }

    const missingSimulatedLocationState = await this.getMissingSimulatedLocationStateSummary(academicYear);

    if (missingSimulatedLocationState.count > 0) {
      warnings.push(
        `ยังมีข้อมูลสอบจำลอง ${missingSimulatedLocationState.count} รายการที่เคยถูกนำเข้าไว้ก่อนหน้านี้โดยยังไม่ได้เก็บรหัสสนามสอบค้างในฐานข้อมูล แม้ไฟล์ simulated ต้นฉบับจะมีคอลัมน์สนามสอบที่ก็ตาม ดังนั้นไฟล์ locations รอบนี้จึงจับคู่ให้ไม่ได้ ต้องอัปโหลดไฟล์ simulated ชุดเดิมอีกครั้งด้วย backend เวอร์ชันปัจจุบัน`,
      );

      if (missingSimulatedLocationState.affectedImports.length > 0) {
        warnings.push(
          `ชุดข้อมูลที่ได้รับผลกระทบ: ${missingSimulatedLocationState.affectedImports.join(', ')}`,
        );
      }
    }

    await this.prisma.importFile.update({
      where: { id: importFile.id },
      data: {
        headerSnapshot: headers,
        rowCount,
        successCount,
        failedCount: errors.length,
        errorSnapshot: errors,
        sourceType: EnrollmentSourceType.MANUAL,
      },
    });

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `Imported locations file=${file.originalname} rows=${rowCount} success=${successCount} failed=${errors.length} durationMs=${durationMs}`,
    );

    return {
      fileId: importFile.id,
      rowCount,
      successCount,
      failedCount: errors.length,
      errors,
      warnings,
      reconciledCount,
      durationMs,
      headerDetections,
    };
  }

  private async importEnrollments(params: {
    file: UploadFile;
    academicYear: number;
    round: ExamRound;
    sourceType: EnrollmentSourceType;
    uploadedById?: string;
    examDate?: string;
  }) {
    const startedAt = Date.now();
    const importFile = await this.prisma.importFile.create({
      data: {
        fileName: params.file.filename,
        originalName: params.file.originalname,
        sourceType: params.sourceType,
        academicYear: params.academicYear,
        uploadedById: params.uploadedById,
      },
    });

    const batch: EnrollmentBatchItem[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const headerDetections: Array<{ rowNumber: number; headers: string[] }> = [];
    const importedStudentIds = new Set<string>();
    let rowCount = 0;
    let successCount = 0;
    let unresolvedLocationCount = 0;
    let headers: string[] = [];

    await this.streamWorksheet(
      params.file.path,
      params.file.originalname,
      ENROLLMENT_HEADERS,
      (resolvedHeaders, row, rowNumber) => {
        headers = resolvedHeaders;
        rowCount += 1;

        try {
          batch.push({
            row: this.mapEnrollmentRow(row),
            rowNumber,
          });
        } catch (error) {
          errors.push(this.formatRowError(rowNumber, error));
        }
      },
      async () => {
        const batchResult = await this.flushEnrollmentBatch(batch, {
          academicYear: params.academicYear,
          round: params.round,
          sourceType: params.sourceType,
          examDate: params.examDate,
          importFileId: importFile.id,
        });
        successCount += batchResult.processedCount;
        unresolvedLocationCount += batchResult.unresolvedLocationCount;
        errors.push(...batchResult.errors);
        for (const studentId of batchResult.importedStudentIds) {
          importedStudentIds.add(studentId);
        }
        batch.length = 0;
      },
      (detectedHeaders, rowNumber) => {
        headerDetections.push({ headers: detectedHeaders, rowNumber });
      },
    );

    if (batch.length > 0) {
      const batchResult = await this.flushEnrollmentBatch(batch, {
        academicYear: params.academicYear,
        round: params.round,
        sourceType: params.sourceType,
        examDate: params.examDate,
        importFileId: importFile.id,
      });
      successCount += batchResult.processedCount;
      unresolvedLocationCount += batchResult.unresolvedLocationCount;
      errors.push(...batchResult.errors);
      for (const studentId of batchResult.importedStudentIds) {
        importedStudentIds.add(studentId);
      }
    }

    if (unresolvedLocationCount > 0) {
      warnings.push(
        params.sourceType === EnrollmentSourceType.SIMULATED_EXCEL
          ? `มี ${unresolvedLocationCount} รายการที่ยังรอจับคู่สนามสอบ สามารถอัปโหลดไฟล์สถานที่สอบภายหลังเพื่อให้ระบบจับคู่อัตโนมัติ`
          : `มี ${unresolvedLocationCount} รายการที่ยังไม่พบสนามสอบตรงกับรหัสในไฟล์`,
      );
    }

    await this.prisma.importFile.update({
      where: { id: importFile.id },
      data: {
        headerSnapshot: headers,
        rowCount,
        successCount,
        failedCount: errors.length,
        errorSnapshot: errors,
      },
    });

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `Imported enrollment file=${params.file.originalname} source=${params.sourceType} rows=${rowCount} success=${successCount} failed=${errors.length} unresolvedLocations=${unresolvedLocationCount} durationMs=${durationMs}`,
    );

    return {
      fileId: importFile.id,
      rowCount,
      successCount,
      failedCount: errors.length,
      errors,
      warnings,
      unresolvedLocationCount,
      durationMs,
      headerDetections,
      importedStudentIds: [...importedStudentIds],
    };
  }

  private async streamWorksheet(
    filePath: string,
    originalName: string,
    headerConfig: HeaderResolverConfig,
    onRow: (headers: string[], row: Record<string, unknown>, rowNumber: number) => void,
    onBatchBoundary: () => Promise<void>,
    onHeaderDetected?: (headers: string[], rowNumber: number) => void,
  ) {
    const fileExtension = extname(originalName).toLowerCase();

    if (fileExtension === '.csv') {
      await this.streamCsvWorksheet(filePath, headerConfig, onRow, onBatchBoundary, onHeaderDetected);
      return;
    }

    if (fileExtension === '.xls') {
      throw new BadRequestException('Legacy .xls files are not supported yet. Please resave the file as .xlsx or .csv before uploading');
    }

    if (fileExtension && fileExtension !== '.xlsx') {
      throw new BadRequestException(`Unsupported file type: ${fileExtension}. Please upload .xlsx or .csv`);
    }

    await this.streamXlsxWorksheet(filePath, headerConfig, onRow, onBatchBoundary, onHeaderDetected);
  }

  private async streamXlsxWorksheet(
    filePath: string,
    headerConfig: HeaderResolverConfig,
    onRow: (headers: string[], row: Record<string, unknown>, rowNumber: number) => void,
    onBatchBoundary: () => Promise<void>,
    onHeaderDetected?: (headers: string[], rowNumber: number) => void,
  ) {
    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      entries: 'emit',
      sharedStrings: 'cache',
      styles: 'cache',
      worksheets: 'emit',
    });

    let buffered = 0;
    let worksheetRowNumber = 0;

    for await (const worksheetReader of workbookReader) {
      let headerMap: Record<string, number> | null = null;
      let resolvedHeaders: string[] = [];
      let previousHeaderRow: string[] | null = null;

      for await (const row of worksheetReader) {
        worksheetRowNumber += 1;
        const values = this.rowToArray(row.values);
        const candidateHeaders = values.map((value) => this.normalizeHeader(String(value ?? '')));
        const directHeaderCandidate = this.tryResolveHeaderIndexes([candidateHeaders], headerConfig);
        const resolvedHeaderCandidate = this.tryResolveHeaderIndexes(
          this.buildHeaderCandidates(candidateHeaders, previousHeaderRow),
          headerConfig,
        );

        if (!headerMap) {
          if (!resolvedHeaderCandidate) {
            if (this.isPotentialHeaderFragment(candidateHeaders)) {
              previousHeaderRow = candidateHeaders;
            }
            continue;
          }

          resolvedHeaders = resolvedHeaderCandidate.headers;
          headerMap = resolvedHeaderCandidate.headerMap;
          onHeaderDetected?.(resolvedHeaders, worksheetRowNumber);
          previousHeaderRow = candidateHeaders;
          continue;
        }

        if (directHeaderCandidate && this.isLikelyHeaderRow(candidateHeaders, directHeaderCandidate.headerMap)) {
          resolvedHeaders = directHeaderCandidate.headers;
          headerMap = directHeaderCandidate.headerMap;
          onHeaderDetected?.(resolvedHeaders, worksheetRowNumber);
          previousHeaderRow = candidateHeaders;
          continue;
        }

        if (resolvedHeaderCandidate && this.isPotentialHeaderFragment(candidateHeaders)) {
          resolvedHeaders = resolvedHeaderCandidate.headers;
          headerMap = resolvedHeaderCandidate.headerMap;
          onHeaderDetected?.(resolvedHeaders, worksheetRowNumber);
          previousHeaderRow = candidateHeaders;
          continue;
        }

        if (this.isPotentialHeaderFragment(candidateHeaders)) {
          previousHeaderRow = candidateHeaders;
          continue;
        }

        if (this.isEmptyRow(values)) {
          continue;
        }

        const mappedRow: Record<string, unknown> = {};
        for (const [key, index] of Object.entries(headerMap)) {
          mappedRow[key] = values[index] ?? null;
        }

        mappedRow.__rawValues = values;

        onRow(resolvedHeaders, mappedRow, worksheetRowNumber);
        buffered += 1;

        if (buffered >= this.batchSize) {
          await onBatchBoundary();
          buffered = 0;
        }
      }
    }
  }

  private async streamCsvWorksheet(
    filePath: string,
    headerConfig: HeaderResolverConfig,
    onRow: (headers: string[], row: Record<string, unknown>, rowNumber: number) => void,
    onBatchBoundary: () => Promise<void>,
    onHeaderDetected?: (headers: string[], rowNumber: number) => void,
  ) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = await workbook.csv.readFile(filePath);

    let headerMap: Record<string, number> | null = null;
    let resolvedHeaders: string[] = [];
    let previousHeaderRow: string[] | null = null;
    let buffered = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = this.rowToArray(row.values);
      const candidateHeaders = values.map((value) => this.normalizeHeader(String(value ?? '')));
      const directHeaderCandidate = this.tryResolveHeaderIndexes([candidateHeaders], headerConfig);
      const resolvedHeaderCandidate = this.tryResolveHeaderIndexes(
        this.buildHeaderCandidates(candidateHeaders, previousHeaderRow),
        headerConfig,
      );

      if (!headerMap) {
        if (!resolvedHeaderCandidate) {
          if (this.isPotentialHeaderFragment(candidateHeaders)) {
            previousHeaderRow = candidateHeaders;
          }
          return;
        }

        resolvedHeaders = resolvedHeaderCandidate.headers;
        headerMap = resolvedHeaderCandidate.headerMap;
        onHeaderDetected?.(resolvedHeaders, rowNumber);
        previousHeaderRow = candidateHeaders;
        return;
      }

      if (directHeaderCandidate && this.isLikelyHeaderRow(candidateHeaders, directHeaderCandidate.headerMap)) {
        resolvedHeaders = directHeaderCandidate.headers;
        headerMap = directHeaderCandidate.headerMap;
        onHeaderDetected?.(resolvedHeaders, rowNumber);
        previousHeaderRow = candidateHeaders;
        return;
      }

      if (resolvedHeaderCandidate && this.isPotentialHeaderFragment(candidateHeaders)) {
        resolvedHeaders = resolvedHeaderCandidate.headers;
        headerMap = resolvedHeaderCandidate.headerMap;
        onHeaderDetected?.(resolvedHeaders, rowNumber);
        previousHeaderRow = candidateHeaders;
        return;
      }

      if (this.isPotentialHeaderFragment(candidateHeaders)) {
        previousHeaderRow = candidateHeaders;
        return;
      }

      if (this.isEmptyRow(values)) {
        return;
      }

      const mappedRow: Record<string, unknown> = {};
      for (const [key, index] of Object.entries(headerMap)) {
        mappedRow[key] = values[index] ?? null;
      }

      mappedRow.__rawValues = values;

      onRow(resolvedHeaders, mappedRow, rowNumber);
      buffered += 1;
    });

    if (buffered > 0) {
      await onBatchBoundary();
    }
  }

  private async flushLocationBatch(batch: LocationImportRow[], importFileId: string) {
    if (batch.length === 0) {
      return { processedCount: 0, reconciledCount: 0 };
    }

    const locationMap = new Map<string, string>();

    await this.runWithConcurrency(batch, Math.min(this.importConcurrency, 4), (row) => row.code, async (row) => {
      const examLocation = await this.prisma.examLocation.upsert({
        where: { code: row.code },
        update: {
          code: row.code,
          name: row.name,
          province: row.province,
          address: row.address,
          seatCapacity: row.seatCapacity,
          eventDate: row.eventDate,
          eventStartMinutes: row.eventStartMinutes,
          eventEndMinutes: row.eventEndMinutes,
          importedFromId: importFileId,
          active: true,
        },
        create: {
          code: row.code,
          name: row.name,
          province: row.province,
          address: row.address,
          seatCapacity: row.seatCapacity,
          eventDate: row.eventDate,
          eventStartMinutes: row.eventStartMinutes,
          eventEndMinutes: row.eventEndMinutes,
          importedFromId: importFileId,
          active: true,
        },
        select: {
          id: true,
          code: true,
        },
      });

      locationMap.set(this.normalizeLocationCode(examLocation.code), examLocation.id);
      await this.syncSimulatedEnrollmentSchedulesForLocation(examLocation);
    });

    const reconciledCount = await this.reconcilePendingLocations(batch, locationMap);

    return { processedCount: batch.length, reconciledCount };
  }

  private async flushEnrollmentBatch(
    batch: EnrollmentBatchItem[],
    params: {
      academicYear: number;
      round: ExamRound;
      sourceType: EnrollmentSourceType;
      examDate?: string;
      importFileId: string;
    },
  ) {
    if (batch.length === 0) {
      return { processedCount: 0, unresolvedLocationCount: 0, errors: [] as string[], importedStudentIds: [] as string[] };
    }

    const studentMap = await this.prepareStudentMap(batch);
    const locationMap = await this.loadExamLocationMap(batch);
    const enrollmentStateMap = await this.loadExistingEnrollmentState(
      batch,
      params.academicYear,
      params.round,
      params.sourceType,
    );
    const barcodeMap = await this.prepareEnrollmentBarcodes(
      batch,
      params.academicYear,
      params.round,
      params.sourceType,
      enrollmentStateMap,
    );
    const historicalEnrollmentCleanupDone = new Set<string>();
    const sameYearSiblingCleanupDone = new Set<string>();
    const importedStudentIds = new Set<string>();
    let unresolvedLocationCount = 0;
    let processedCount = 0;
    const errors: string[] = [];

    await this.runWithConcurrency(
      batch,
      this.importConcurrency,
      (item) =>
        this.buildEnrollmentStateKey(
          item.row.nationalId,
          params.academicYear,
          item.row.examRound || params.round,
          params.sourceType,
        ),
      async (item) => {
        const { row, rowNumber } = item;

        try {
          const student = studentMap.get(row.nationalId);

          if (!student) {
            if (this.isStudentNameFallbackIdentifier(row.nationalId)) {
              throw new BadRequestException(
                `student identifier is missing and no unique existing student matched ${row.firstNameTh} ${row.lastNameTh}`,
              );
            }

            throw new BadRequestException(`student record for nationalId ${row.nationalId} could not be prepared`);
          }

          await this.prisma.student.update({
            where: { id: student.id },
            data: {
              prefix: row.prefix,
              firstNameTh: row.firstNameTh,
              lastNameTh: row.lastNameTh,
              firstNameEn: row.firstNameEn,
              lastNameEn: row.lastNameEn,
              email: row.email,
              phone: row.phone,
              schoolName: row.schoolName,
              province: row.province,
            },
          });

          if (!historicalEnrollmentCleanupDone.has(student.id)) {
            await this.softDeleteHistoricalEnrollments(student.id, params.academicYear);
            historicalEnrollmentCleanupDone.add(student.id);
          }

          if (!sameYearSiblingCleanupDone.has(student.id)) {
            await this.softDeleteSameYearSiblingEnrollmentSources(student.id, params.academicYear, params.sourceType);
            sameYearSiblingCleanupDone.add(student.id);
          }

          const effectiveRound = row.examRound || params.round;
          const enrollmentKey = this.buildEnrollmentStateKey(
            row.nationalId,
            params.academicYear,
            effectiveRound,
            params.sourceType,
          );
          const existing = enrollmentStateMap.get(enrollmentKey);

          let examLocation:
            | {
                id: string;
                code: string;
                name: string;
                eventDate?: Date | null;
                eventStartMinutes?: number | null;
                eventEndMinutes?: number | null;
              }
            | undefined = row.locationCode
            ? ((locationMap.get(this.normalizeLocationCode(row.locationCode)) as {
                id: string;
                code: string;
                name: string;
                eventDate?: Date | null;
                eventStartMinutes?: number | null;
                eventEndMinutes?: number | null;
              } | undefined))
            : undefined;

          if (!examLocation && row.locationCode) {
            const resolvedLocation = await this.resolveExamLocationForEnrollment(
              row.locationCode,
              params.sourceType,
              params.importFileId,
              row.province,
            );

            if (resolvedLocation) {
              examLocation = {
                id: resolvedLocation.id,
                code: resolvedLocation.code,
                name: resolvedLocation.name,
                eventDate: resolvedLocation.eventDate,
                eventStartMinutes: resolvedLocation.eventStartMinutes,
                eventEndMinutes: resolvedLocation.eventEndMinutes,
              };
              locationMap.set(this.normalizeLocationCode(resolvedLocation.code), examLocation);
            }
          }

          const pendingLocationCode =
            params.sourceType === EnrollmentSourceType.SIMULATED_EXCEL && row.locationCode && !examLocation
              ? row.locationCode
              : null;

          if (pendingLocationCode) {
            unresolvedLocationCount += 1;
          }

          const registrationWindow = this.resolveEnrollmentRegistrationWindow(
            effectiveRound,
            row.registeredAt ?? this.parseDate(row.registeredAt) ?? undefined,
            params.examDate,
            params.sourceType,
            examLocation,
          );

          const shouldGenerateBarcode = !existing || !this.isEightDigitBarcode(existing.barcode);
          const barcode = shouldGenerateBarcode
            ? barcodeMap.get(enrollmentKey)
            : (existing?.barcode as string);

          if (!barcode) {
            throw new BadRequestException(`barcode for enrollment ${enrollmentKey} could not be prepared`);
          }
          const notes = this.replacePendingLocationNotes(existing?.notes, pendingLocationCode);
          const enrollmentUpdateData: Prisma.EnrollmentUncheckedUpdateInput = {
            deletedAt: null,
            status: EnrollmentStatus.REGISTERED,
            sourceType: params.sourceType,
            ...(shouldGenerateBarcode ? { barcode } : {}),
            examLocationId: examLocation?.id ?? null,
            notes,
            importedExamRoundLabel:
              params.sourceType === EnrollmentSourceType.SIMULATED_EXCEL
                ? row.importedExamRoundLabel ?? null
                : null,
            registeredAt: row.registeredAt ?? new Date(),
            registrationStartAt: registrationWindow.start,
            registrationEndAt: registrationWindow.end,
            ...(params.sourceType === EnrollmentSourceType.ONSITE_EXCEL
              ? { onsiteImportFileId: params.importFileId }
              : {}),
            ...(params.sourceType === EnrollmentSourceType.SIMULATED_EXCEL
              ? { simulatedImportFileId: params.importFileId }
              : {}),
          };
          const enrollmentCreateData: Prisma.EnrollmentUncheckedCreateInput = {
            studentId: student.id,
            academicYear: params.academicYear,
            examRound: effectiveRound,
            importedExamRoundLabel:
              params.sourceType === EnrollmentSourceType.SIMULATED_EXCEL
                ? row.importedExamRoundLabel ?? null
                : null,
            status: EnrollmentStatus.REGISTERED,
            sourceType: params.sourceType,
            barcode,
            examLocationId: examLocation?.id ?? null,
            notes,
            registeredAt: row.registeredAt ?? new Date(),
            registrationStartAt: registrationWindow.start,
            registrationEndAt: registrationWindow.end,
            ...(params.sourceType === EnrollmentSourceType.ONSITE_EXCEL
              ? { onsiteImportFileId: params.importFileId }
              : {}),
            ...(params.sourceType === EnrollmentSourceType.SIMULATED_EXCEL
              ? { simulatedImportFileId: params.importFileId }
              : {}),
          };

          const enrollment = await this.prisma.enrollment.upsert({
            where: {
              studentId_academicYear_examRound_sourceType: {
                studentId: student.id,
                academicYear: params.academicYear,
                examRound: effectiveRound,
                sourceType: params.sourceType,
              },
            },
            update: enrollmentUpdateData,
            create: enrollmentCreateData,
            select: {
              id: true,
              barcode: true,
              notes: true,
            },
          });

          enrollmentStateMap.set(enrollmentKey, {
            barcode: enrollment.barcode,
            notes: enrollment.notes,
          });
          importedStudentIds.add(student.id);

          if (params.sourceType === EnrollmentSourceType.SIMULATED_EXCEL && this.hasScoreData(row)) {
            await this.prisma.score.upsert({
              where: { enrollmentId: enrollment.id },
              update: this.buildScorePayload(row),
              create: {
                enrollmentId: enrollment.id,
                ...this.buildScorePayload(row),
              },
            });
          }

          processedCount += 1;
        } catch (error) {
          errors.push(this.formatRowError(rowNumber, error));
        }
      },
    );

    return { processedCount, unresolvedLocationCount, errors, importedStudentIds: [...importedStudentIds] };
  }

  private async softDeleteStaleCurrentYearEnrollmentSources(
    academicYear: number,
    importedStudentIdsBySource: Map<EnrollmentSourceType, Set<string>>,
  ) {
    const desiredSourceTypesByStudent = new Map<string, Set<EnrollmentSourceType>>();
    const managedSourceTypes = [EnrollmentSourceType.ONSITE_EXCEL, EnrollmentSourceType.SIMULATED_EXCEL];

    for (const [sourceType, studentIds] of importedStudentIdsBySource.entries()) {
      for (const studentId of studentIds) {
        const desiredSourceTypes = desiredSourceTypesByStudent.get(studentId) ?? new Set<EnrollmentSourceType>();
        desiredSourceTypes.add(sourceType);
        desiredSourceTypesByStudent.set(studentId, desiredSourceTypes);
      }
    }

    for (const [studentId, desiredSourceTypes] of desiredSourceTypesByStudent.entries()) {
      const staleSourceTypes = managedSourceTypes.filter((sourceType) => !desiredSourceTypes.has(sourceType));

      if (staleSourceTypes.length === 0) {
        continue;
      }

      await this.prisma.enrollment.updateMany({
        where: {
          studentId,
          academicYear,
          deletedAt: null,
          sourceType: {
            in: staleSourceTypes,
          },
        },
        data: {
          deletedAt: new Date(),
        },
      });
    }
  }

  private async softDeleteHistoricalEnrollments(studentId: string, academicYear: number) {
    await this.prisma.enrollment.updateMany({
      where: {
        studentId,
        academicYear: {
          not: academicYear,
        },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  private async softDeleteSameYearSiblingEnrollmentSources(
    studentId: string,
    academicYear: number,
    sourceType: EnrollmentSourceType,
  ) {
    const siblingSourceTypes = [EnrollmentSourceType.ONSITE_EXCEL, EnrollmentSourceType.SIMULATED_EXCEL].filter(
      (candidate) => candidate !== sourceType,
    );

    if (siblingSourceTypes.length === 0) {
      return;
    }

    await this.prisma.enrollment.updateMany({
      where: {
        studentId,
        academicYear,
        deletedAt: null,
        sourceType: {
          in: siblingSourceTypes,
        },
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  private async resolveExamLocationForEnrollment(
    rawLocation: string | undefined,
    sourceType: EnrollmentSourceType,
    importFileId: string,
    province?: string,
  ): Promise<ResolvedExamLocation | null> {
    const locationValue = this.normalizeLocationCode(rawLocation);
    const normalizedProvince = this.asOptionalString(province);

    if (!locationValue) {
      return null;
    }

    const byCode = await this.findExamLocationByCode(locationValue);

    if (byCode) {
      return this.backfillOnsiteLocationProvince(byCode, sourceType, importFileId, normalizedProvince);
    }

    if (sourceType === EnrollmentSourceType.ONSITE_EXCEL) {
      const byName = await this.prisma.examLocation.findFirst({
        where: {
          name: {
            equals: locationValue,
            mode: 'insensitive',
          },
        },
      });

      if (byName) {
        return this.backfillOnsiteLocationProvince(byName, sourceType, importFileId, normalizedProvince);
      }

      const generatedCode = this.buildOnsiteLocationCode(locationValue);

      return this.prisma.examLocation.upsert({
        where: { code: generatedCode },
        update: {
          name: locationValue,
          province: normalizedProvince,
          importedFromId: importFileId,
          active: true,
        },
        create: {
          code: generatedCode,
          name: locationValue,
          province: normalizedProvince,
          importedFromId: importFileId,
          active: true,
        },
      });
    }

    return null;
  }

  private async backfillOnsiteLocationProvince(
    examLocation: ResolvedExamLocation,
    sourceType: EnrollmentSourceType,
    importFileId: string,
    province?: string | null,
  ): Promise<ResolvedExamLocation> {
    if (
      sourceType !== EnrollmentSourceType.ONSITE_EXCEL ||
      !province ||
      this.asOptionalString(examLocation.province)
    ) {
      return examLocation;
    }

    return this.prisma.examLocation.update({
      where: { id: examLocation.id },
      data: {
        province,
        importedFromId: importFileId,
        active: true,
      },
    });
  }

  private async reconcilePendingLocations(batch: LocationImportRow[], knownLocations?: Map<string, string>) {
    let reconciledCount = 0;

    const pendingEnrollments = await this.prisma.enrollment.findMany({
      where: {
        deletedAt: null,
        examLocationId: null,
        notes: {
          contains: PENDING_LOCATION_PREFIX,
        },
      },
      select: {
        id: true,
        notes: true,
        examRound: true,
        registeredAt: true,
        registrationStartAt: true,
      },
    });

    if (pendingEnrollments.length === 0) {
      return 0;
    }

    const locationMap = new Map<
      string,
      {
        id: string;
        eventDate?: Date | null;
        eventStartMinutes?: number | null;
        eventEndMinutes?: number | null;
      }
    >();

    for (const row of batch) {
      const normalizedCode = this.normalizeLocationCode(row.code);

      if (knownLocations?.has(normalizedCode)) {
        const examLocation = await this.findExamLocationByCode(row.code);

        if (examLocation) {
          locationMap.set(normalizedCode, {
            id: examLocation.id,
            eventDate: examLocation.eventDate,
            eventStartMinutes: examLocation.eventStartMinutes,
            eventEndMinutes: examLocation.eventEndMinutes,
          });
        }
        continue;
      }

      const examLocation = await this.findExamLocationByCode(row.code);

      if (examLocation) {
        locationMap.set(normalizedCode, {
          id: examLocation.id,
          eventDate: examLocation.eventDate,
          eventStartMinutes: examLocation.eventStartMinutes,
          eventEndMinutes: examLocation.eventEndMinutes,
        });
      }
    }

    for (const enrollment of pendingEnrollments) {
      const pendingCodes = this.extractPendingLocationCodes(enrollment.notes);
      const matchedCode = pendingCodes.find((code) => locationMap.has(this.normalizeLocationCode(code)));

      if (!matchedCode) {
        continue;
      }

      const matchedLocation = locationMap.get(this.normalizeLocationCode(matchedCode));

      if (!matchedLocation) {
        continue;
      }

      await this.prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          examLocationId: matchedLocation.id,
          ...(matchedLocation.eventDate || matchedLocation.eventStartMinutes != null || matchedLocation.eventEndMinutes != null
            ? this.buildSimulatedLocationRegistrationWindowUpdate(enrollment, matchedLocation)
            : {}),
          notes: this.removePendingLocationNote(enrollment.notes, matchedCode),
        },
      });

      reconciledCount += 1;
    }

    return reconciledCount;
  }

  private async syncSimulatedEnrollmentSchedulesForLocation(location: {
    id: string;
    eventDate?: Date | null;
    eventStartMinutes?: number | null;
    eventEndMinutes?: number | null;
  }) {
    if (!location.eventDate && location.eventStartMinutes == null && location.eventEndMinutes == null) {
      return;
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        deletedAt: null,
        sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
        examLocationId: location.id,
      },
      select: {
        id: true,
        examRound: true,
        registeredAt: true,
        registrationStartAt: true,
      },
    });

    for (const enrollment of enrollments) {
      await this.prisma.enrollment.update({
        where: { id: enrollment.id },
        data: this.buildSimulatedLocationRegistrationWindowUpdate(enrollment, location),
      });
    }
  }

  private async getMissingSimulatedLocationStateSummary(academicYear: number) {
    const where: Prisma.EnrollmentWhereInput = {
      deletedAt: null,
      academicYear,
      sourceType: EnrollmentSourceType.SIMULATED_EXCEL,
      examLocationId: null,
      OR: [
        { notes: null },
        {
          notes: {
            not: {
              contains: PENDING_LOCATION_PREFIX,
            },
          },
        },
      ],
    };

    const [count, affectedImports] = await Promise.all([
      this.prisma.enrollment.count({ where }),
      this.prisma.enrollment.findMany({
        where,
        distinct: ['simulatedImportFileId'],
        select: {
          simulatedImportFileId: true,
          simulatedImportFile: {
            select: {
              uploadedAt: true,
            },
          },
        },
        orderBy: {
          simulatedImportFile: {
            uploadedAt: 'desc',
          },
        },
        take: 3,
      }),
    ]);

    return {
      count,
      affectedImports: affectedImports
        .filter((item) => item.simulatedImportFileId)
        .map((item) => {
          const uploadedAt = item.simulatedImportFile?.uploadedAt
            ? new Intl.DateTimeFormat('th-TH', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Bangkok',
              }).format(item.simulatedImportFile.uploadedAt)
            : 'ไม่ทราบเวลาอัปโหลด';

          return `${item.simulatedImportFileId} (${uploadedAt})`;
        }),
    };
  }

  private mapEnrollmentRow(row: Record<string, unknown>): EnrollmentImportRow {
    const recoveredIdentity = this.recoverEnrollmentIdentityFromRawRow(row);
    const recoveredName = this.recoverEnrollmentNameFromRawRow(row);
    const normalizedThaiName = this.normalizeThaiNameParts(
      this.asString(row.firstNameTh) || recoveredIdentity?.firstNameTh || recoveredName?.firstNameTh || '',
      this.asString(row.lastNameTh) || recoveredIdentity?.lastNameTh || recoveredName?.lastNameTh || '',
    );
    const firstNameTh = normalizedThaiName.firstNameTh;
    const lastNameTh = normalizedThaiName.lastNameTh;
    const nationalId =
      this.normalizeStudentIdentifier(row.nationalId) ||
      recoveredIdentity?.nationalId ||
      (firstNameTh && lastNameTh ? this.buildStudentNameFallbackIdentifier(firstNameTh, lastNameTh) : '');

    if (!nationalId || !firstNameTh || !lastNameTh) {
      const rawPreview = this.buildRawRowPreview(row);
      throw new BadRequestException(
        `nationalId, firstNameTh and lastNameTh are required in enrollment rows${rawPreview ? ` | raw: ${rawPreview}` : ''}`,
      );
    }

    return {
      nationalId,
      prefix: this.asOptionalString(row.prefix) || recoveredIdentity?.prefix || recoveredName?.prefix,
      firstNameTh,
      lastNameTh,
      firstNameEn: this.asOptionalString(row.firstNameEn),
      lastNameEn: this.asOptionalString(row.lastNameEn),
      email: this.asOptionalString(row.email)?.toLowerCase(),
      phone: this.asOptionalString(row.phone),
      schoolName: this.asOptionalString(row.schoolName),
      province: this.asOptionalString(row.province),
      locationCode: this.asOptionalLocationCode(row.locationCode),
      examRound: this.parseRowExamRound(row.examRound),
      importedExamRoundLabel: this.asOptionalString(row.examRound),
      registeredAt: this.parseDate(row.registeredAt) ?? undefined,
      tgat: this.asOptionalNumber(row.tgat),
      tgat1: this.asOptionalNumber(row.tgat1),
      tgat2: this.asOptionalNumber(row.tgat2),
      tgat3: this.asOptionalNumber(row.tgat3),
      rankingOverall: this.asOptionalInteger(row.rankingOverall),
      rankingLocation: this.asOptionalInteger(row.rankingLocation),
      rankingOverallTgat1: this.asOptionalInteger(row.rankingOverallTgat1),
      rankingLocationTgat1: this.asOptionalInteger(row.rankingLocationTgat1),
      rankingOverallTgat2: this.asOptionalInteger(row.rankingOverallTgat2),
      rankingLocationTgat2: this.asOptionalInteger(row.rankingLocationTgat2),
      rankingOverallTgat3: this.asOptionalInteger(row.rankingOverallTgat3),
      rankingLocationTgat3: this.asOptionalInteger(row.rankingLocationTgat3),
      percentile: this.asOptionalNumber(row.percentile),
    };
  }

  private hasScoreData(row: EnrollmentImportRow) {
    return [
      row.tgat,
      row.tgat1,
      row.tgat2,
      row.tgat3,
      row.rankingOverall,
      row.rankingLocation,
      row.rankingOverallTgat1,
      row.rankingLocationTgat1,
      row.rankingOverallTgat2,
      row.rankingLocationTgat2,
      row.rankingOverallTgat3,
      row.rankingLocationTgat3,
      row.percentile,
    ].some((value) => value !== null && value !== undefined);
  }

  private buildScorePayload(row: EnrollmentImportRow) {
    return {
      tgat: row.tgat,
      tgat1: row.tgat1,
      tgat2: row.tgat2,
      tgat3: row.tgat3,
      rankingOverall: row.rankingOverall,
      rankingLocation: row.rankingLocation,
      rankingOverallTgat1: row.rankingOverallTgat1,
      rankingLocationTgat1: row.rankingLocationTgat1,
      rankingOverallTgat2: row.rankingOverallTgat2,
      rankingLocationTgat2: row.rankingLocationTgat2,
      rankingOverallTgat3: row.rankingOverallTgat3,
      rankingLocationTgat3: row.rankingLocationTgat3,
      percentile: row.percentile,
    };
  }

  private mapLocationRow(row: Record<string, unknown>): LocationImportRow | null {
    const recoveredCode = this.recoverLocationCodeFromRawRow(row);
    const rawCode = this.asString(row.code) || recoveredCode;
    const code = this.normalizeLocationCode(rawCode);
    const name = this.asOptionalString(row.name);
    const province = this.asOptionalString(row.province);

    if (this.isLocationSummaryRow(row, rawCode)) {
      return null;
    }

    if (!rawCode || rawCode === 'รวม') {
      if (this.hasMeaningfulLocationRowContent(row)) {
        const rawPreview = this.buildRawRowPreview(row);
        throw new BadRequestException(
          `code is required in location rows${rawPreview ? ` | raw: ${rawPreview}` : ''}`,
        );
      }

      return null;
    }

    if (!code) {
      const rawPreview = this.buildRawRowPreview(row);
      throw new BadRequestException(`code is required in location rows${rawPreview ? ` | raw: ${rawPreview}` : ''}`);
    }

    return {
      code,
      name: name || this.buildFallbackLocationName(code, province),
      province,
      address: this.asOptionalString(row.address),
      seatCapacity: this.asOptionalNumber(row.seatCapacity) ?? this.recoverLocationSeatCapacityFromRawRow(row),
      eventDate: this.parseDate(row.eventDate) ?? undefined,
      ...this.parseLocationTimeMetadata(row.startTime, row.endTime, row.timeRange),
    };
  }

  private recoverLocationCodeFromRawRow(row: Record<string, unknown>) {
    const rawValues = Array.isArray(row.__rawValues) ? row.__rawValues : [];

    if (rawValues.length === 0) {
      return '';
    }

    const candidate = rawValues
      .map((value) => this.asString(value))
      .slice(0, 3)
      .find((value) => this.isLikelyLocationCodeCandidate(value));

    return candidate || '';
  }

  private recoverLocationSeatCapacityFromRawRow(row: Record<string, unknown>) {
    const rawValues = Array.isArray(row.__rawValues) ? row.__rawValues : [];

    if (rawValues.length === 0) {
      return undefined;
    }

    return this.asOptionalNumber(rawValues[rawValues.length - 1]);
  }

  private isLikelyLocationCodeCandidate(value: string) {
    const normalized = this.normalizeLocationCode(value);

    if (!normalized || normalized === 'รวม') {
      return false;
    }

    if (/^\d+$/.test(normalized)) {
      return true;
    }

    return /^(?:สนามสอบที่|สนามสอบหมายเลข|รหัสสนามสอบ|รหัสสถานที่สอบ)\s*\d+(?:\.0+)?$/i.test(this.asString(value));
  }

  private hasMeaningfulLocationRowContent(row: Record<string, unknown>) {
    return [row.name, row.province, row.address, row.seatCapacity, row.eventDate, row.timeRange, row.startTime, row.endTime]
      .some((value) => this.asString(value));
  }

  private isLocationSummaryRow(row: Record<string, unknown>, rawCode?: string) {
    const normalizedCode = this.normalizeHeader(rawCode || this.asString(row.code));

    if (normalizedCode === this.normalizeHeader('รวม')) {
      return true;
    }

    const rawValues = Array.isArray(row.__rawValues) ? row.__rawValues : [];
    const firstMeaningfulCell = rawValues
      .map((value) => this.asString(value))
      .find(Boolean);

    return this.normalizeHeader(firstMeaningfulCell || '') === this.normalizeHeader('รวม');
  }

  private hydrateLocationRowFromPreviousContext(
    row: Record<string, unknown>,
    previousContext: Partial<Record<'name' | 'province' | 'seatCapacity' | 'eventDate' | 'timeRange' | 'startTime' | 'endTime', unknown>>,
  ) {
    if (!this.asString(row.code)) {
      return row;
    }

    const nextRow = { ...row };

    for (const field of ['name', 'province', 'seatCapacity', 'eventDate', 'timeRange', 'startTime', 'endTime'] as const) {
      if (!this.asString(nextRow[field]) && previousContext[field] !== undefined) {
        nextRow[field] = previousContext[field];
      }
    }

    return nextRow;
  }

  private captureLocationRowContext(
    row: Record<string, unknown>,
    previousContext: Partial<Record<'name' | 'province' | 'seatCapacity' | 'eventDate' | 'timeRange' | 'startTime' | 'endTime', unknown>>,
  ) {
    const nextContext = { ...previousContext };

    for (const field of ['name', 'province', 'seatCapacity', 'eventDate', 'timeRange', 'startTime', 'endTime'] as const) {
      if (this.asString(row[field])) {
        nextContext[field] = row[field];
      }
    }

    return nextContext;
  }

  private buildFallbackLocationName(code: string, province?: string | null) {
    if (province) {
      return `${province} ${code}`;
    }

    return `สนามสอบ ${code}`;
  }

  private resolveHeaderIndexes(headers: string[], config: HeaderResolverConfig) {
    const headerIndexes: Record<string, number> = {};

    for (const [field, aliases] of Object.entries(config)) {
      const index = headers.findIndex((header) => aliases.includes(header));

      if (index === -1 && ['nationalId', 'firstNameTh', 'lastNameTh', 'code', 'name'].includes(field)) {
        throw new BadRequestException(`Missing required column for ${field}`);
      }

      if (index !== -1) {
        headerIndexes[field] = index;
      }
    }

    return headerIndexes;
  }

  private tryResolveHeaderIndexes(headerCandidates: string[][], config: HeaderResolverConfig) {
    let bestMatch: { headers: string[]; headerMap: Record<string, number> } | null = null;

    for (const headers of headerCandidates) {
      const headerIndexes: Record<string, number> = {};

      for (const [field, aliases] of Object.entries(config)) {
        const index = this.findHeaderIndex(headers, aliases, field);

        if (index !== -1) {
          headerIndexes[field] = index;
        }
      }

      this.inferTrailingGenericRankHeaders(headers, headerIndexes);

      const requiredFields = this.getRequiredHeaderFields(config);
      const hasRequiredFields = requiredFields.every((field) => field in headerIndexes);

      if (!hasRequiredFields) {
        continue;
      }

      if (!bestMatch || Object.keys(headerIndexes).length > Object.keys(bestMatch.headerMap).length) {
        bestMatch = { headers, headerMap: headerIndexes };
      }
    }

    return bestMatch;
  }

  private inferTrailingGenericRankHeaders(headers: string[], headerIndexes: Record<string, number>) {
    const tgat3Index = headerIndexes.tgat3;

    if (tgat3Index === undefined) {
      return;
    }

    const nextHeader = headers[tgat3Index + 1] || '';
    const lastHeader = headers[tgat3Index + 2] || '';

    if (!('rankingLocationTgat3' in headerIndexes) && nextHeader === 'ลำดับในสนามสอบ') {
      headerIndexes.rankingLocationTgat3 = tgat3Index + 1;
    }

    if (!('rankingOverallTgat3' in headerIndexes) && lastHeader === 'ลำดับทุกสนามสอบ') {
      headerIndexes.rankingOverallTgat3 = tgat3Index + 2;
    }
  }

  private buildHeaderCandidates(currentHeaders: string[], previousHeaders: string[] | null) {
    const candidates = [currentHeaders];

    if (!previousHeaders || previousHeaders.length === 0) {
      return candidates;
    }

    const expandedPreviousHeaders = this.expandMergedHeaders(previousHeaders);
    const mergedHeaders = currentHeaders.map((header, index) => {
      const parentHeader = expandedPreviousHeaders[index] || '';

      if (parentHeader && header) {
        return `${parentHeader}${header}`;
      }

      return header || parentHeader;
    });

    candidates.unshift(mergedHeaders);

    return candidates;
  }

  private expandMergedHeaders(headers: string[]) {
    let activeHeader = '';

    return headers.map((header) => {
      if (header) {
        activeHeader = header;
        return header;
      }

      return activeHeader;
    });
  }

  private findHeaderIndex(headers: string[], aliases: string[], field: string) {
    const exactIndex = headers.findIndex((header) => aliases.includes(String(header ?? '')));

    if (exactIndex !== -1) {
      return exactIndex;
    }

    if (this.isStrictHeaderField(field)) {
      return -1;
    }

    return headers.findIndex((header) => {
      const normalizedHeader = String(header ?? '');
      return aliases.some((alias) => normalizedHeader.endsWith(alias));
    });
  }

  private isLikelyHeaderRow(headers: string[], headerMap: Record<string, number>) {
    if (headers.length === 0 || this.isEmptyRow(headers)) {
      return false;
    }

    const requiredFields = ['nationalId', 'firstNameTh', 'lastNameTh', 'code', 'name'];
    const matchedRequiredFields = requiredFields.filter((field) => field in headerMap);

    if (matchedRequiredFields.length === 0) {
      return false;
    }

    const distinctHeaderLabels = new Set(headers.filter(Boolean));
    return distinctHeaderLabels.size >= matchedRequiredFields.length;
  }

  private isPotentialHeaderFragment(headers: string[]) {
    const nonEmptyHeaders = headers.filter(Boolean);

    if (nonEmptyHeaders.length < 2) {
      return false;
    }

    const firstMeaningfulHeader = nonEmptyHeaders[0];

    if (this.isLikelyLocationCodeCandidate(firstMeaningfulHeader)) {
      return false;
    }

    const aliasSignals = ['nationalid', 'firstname', 'lastname', 'ชื่อ', 'นามสกุล', 'เลขบัตร', 'ข้อมูลผู้สมัคร', 'รอบการสอบ', 'สนามสอบ'];
    const hasAliasSignal = nonEmptyHeaders.some((header) => aliasSignals.some((signal) => header.includes(signal)));

    if (!hasAliasSignal) {
      return false;
    }

    return nonEmptyHeaders.every((header) => !/^\d{6,}$/.test(header) && !header.includes('@'));
  }

  private isStrictHeaderField(field: string) {
    return ['tgat', 'tgat1', 'tgat2', 'tgat3', 'rankingOverall', 'rankingLocation', 'percentile'].includes(field);
  }

  private recoverEnrollmentIdentityFromRawRow(row: Record<string, unknown>) {
    const rawValues = Array.isArray(row.__rawValues) ? row.__rawValues : [];

    if (rawValues.length === 0) {
      return null;
    }

    const stringValues = rawValues.map((value) => this.asString(value));
    const nationalIdIndex = stringValues.findIndex((value) => this.isLikelyStudentIdentifier(value));

    if (nationalIdIndex === -1) {
      return null;
    }

    const nearbyTextCells = stringValues
      .slice(nationalIdIndex + 1, nationalIdIndex + 6)
      .filter((value) => this.looksLikeStudentIdentityCell(value));

    if (nearbyTextCells.length > 0) {
      const combinedName = this.isLikelyThaiNamePrefix(nearbyTextCells[0])
        ? null
        : this.parseCombinedThaiNameCell(nearbyTextCells[0], true);

      if (combinedName) {
        return {
          nationalId: this.normalizeStudentIdentifier(stringValues[nationalIdIndex]),
          ...combinedName,
        };
      }
    }

    if (nearbyTextCells.length > 1 && this.isLikelyThaiNamePrefix(nearbyTextCells[0])) {
      const combinedName = this.parseCombinedThaiNameCell(nearbyTextCells[1]);

      if (combinedName) {
        return {
          nationalId: this.normalizeStudentIdentifier(stringValues[nationalIdIndex]),
          prefix: combinedName.prefix || nearbyTextCells[0],
          firstNameTh: combinedName.firstNameTh,
          lastNameTh: combinedName.lastNameTh,
        };
      }
    }

    if (nearbyTextCells.length < 2) {
      return null;
    }

    let prefix: string | undefined;
    let firstNameTh = nearbyTextCells[0];
    let lastNameTh = nearbyTextCells[1];

    if (this.isLikelyThaiNamePrefix(nearbyTextCells[0]) && nearbyTextCells.length >= 3) {
      prefix = nearbyTextCells[0];
      firstNameTh = nearbyTextCells[1];
      lastNameTh = nearbyTextCells[2];
    }

    if (!this.looksLikePersonName(firstNameTh) || !this.looksLikePersonName(lastNameTh)) {
      if (this.looksLikePersonName(firstNameTh) && !lastNameTh) {
        return {
          nationalId: this.normalizeStudentIdentifier(stringValues[nationalIdIndex]),
          prefix,
          firstNameTh,
          lastNameTh: '-',
        };
      }

      return null;
    }

    return {
      nationalId: this.normalizeStudentIdentifier(stringValues[nationalIdIndex]),
      prefix,
      firstNameTh,
      lastNameTh,
    };
  }

  private recoverEnrollmentNameFromRawRow(row: Record<string, unknown>) {
    const rawValues = Array.isArray(row.__rawValues) ? row.__rawValues : [];

    if (rawValues.length === 0) {
      return null;
    }

    const stringValues = rawValues.map((value) => this.asString(value));

    for (const value of stringValues) {
      if (!this.looksLikeStudentIdentityCell(value) || this.isLikelyStudentIdentifier(value) || this.isLikelyThaiNamePrefix(value)) {
        continue;
      }

      const compact = this.normalizeHeader(value);

      if (['สรุป', 'รวม', 'ข้อมูลผู้สมัคร'].some((token) => compact.includes(this.normalizeHeader(token)))) {
        continue;
      }

      const combinedName = this.parseCombinedThaiNameCell(value);

      if (combinedName) {
        return combinedName;
      }
    }

    return null;
  }

  private looksLikeStudentIdentityCell(value: string) {
    const normalized = this.asString(value);

    if (!normalized || normalized.length > 80 || normalized.includes('@')) {
      return false;
    }

    if (/^\d+(?:\.\d+)?$/.test(normalized)) {
      return false;
    }

    const compact = this.normalizeHeader(normalized);
    return !['จังหวัด', 'โรงเรียน', 'สนามสอบ', 'รอบการสอบ', 'ที่อยู่'].some((token) => compact.includes(this.normalizeHeader(token)));
  }

  private isLikelyStudentIdentifier(value: unknown) {
    const normalized = this.normalizeStudentIdentifier(value);

    if (!normalized || normalized.length < 6 || normalized.length > 24) {
      return false;
    }

    if (normalized.includes('@')) {
      return false;
    }

    return /^[A-Z0-9\-/]+$/.test(normalized);
  }

  private isLikelyThaiNamePrefix(value: string) {
    return THAI_NAME_PREFIXES.has(this.asString(value));
  }

  private looksLikePersonName(value: string) {
    const normalized = this.asString(value);

    if (!normalized || normalized.length > 60) {
      return false;
    }

    if (/^\d+(?:\.\d+)?$/.test(normalized) || normalized.includes('@')) {
      return false;
    }

    return true;
  }

  private parseCombinedThaiNameCell(value: string, allowMononym = false) {
    const normalized = this.asString(value);

    if (!normalized) {
      return null;
    }

    const prefixMatch = Array.from(THAI_NAME_PREFIXES)
      .sort((left, right) => right.length - left.length)
      .find((prefix) => normalized.startsWith(`${prefix} `) || normalized.startsWith(prefix));

    if (prefixMatch) {
      const remainder = normalized.slice(prefixMatch.length).trim();
      const parts = remainder.split(/\s+/).filter(Boolean);

      if (parts.length >= 2) {
        const firstNameTh = parts[0];
        const lastNameTh = parts.slice(1).join(' ');

        if (this.looksLikePersonName(firstNameTh) && this.looksLikePersonName(lastNameTh)) {
          return {
            prefix: prefixMatch,
            firstNameTh,
            lastNameTh,
          };
        }
      }

      if (allowMononym && parts.length === 1 && this.looksLikePersonName(parts[0])) {
        return {
          prefix: prefixMatch,
          firstNameTh: parts[0],
          lastNameTh: '-',
        };
      }
    }

    const parts = normalized.split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      const firstNameTh = parts[0];
      const lastNameTh = parts.slice(1).join(' ');

      if (this.looksLikePersonName(firstNameTh) && this.looksLikePersonName(lastNameTh)) {
        return {
          firstNameTh,
          lastNameTh,
        };
      }
    }

    if (allowMononym && parts.length === 1 && this.looksLikePersonName(parts[0])) {
      return {
        firstNameTh: parts[0],
        lastNameTh: '-',
      };
    }

    return null;
  }

  private normalizeThaiNameParts(firstNameTh: string, lastNameTh: string) {
    const normalizedFirstName = this.asString(firstNameTh);
    const normalizedLastName = this.asString(lastNameTh);

    if (!normalizedFirstName || !normalizedLastName) {
      return {
        firstNameTh: normalizedFirstName,
        lastNameTh: normalizedLastName,
      };
    }

    if (normalizedFirstName.endsWith(` ${normalizedLastName}`)) {
      const firstNameParts = normalizedFirstName.split(/\s+/).filter(Boolean);

      if (firstNameParts.length >= 2) {
        return {
          firstNameTh: firstNameParts.slice(0, -1).join(' '),
          lastNameTh: normalizedLastName,
        };
      }
    }

    return {
      firstNameTh: normalizedFirstName,
      lastNameTh: normalizedLastName,
    };
  }

  private buildRawRowPreview(row: Record<string, unknown>) {
    const rawValues = Array.isArray(row.__rawValues) ? row.__rawValues : [];
    const preview = rawValues
      .map((value) => this.asString(value))
      .filter(Boolean)
      .slice(0, 6)
      .join(' | ');

    if (!preview) {
      return '';
    }

    return preview.length > 140 ? `${preview.slice(0, 137)}...` : preview;
  }

  private normalizeStudentIdentifier(value: unknown) {
    return this.asString(value)
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  private buildStudentNameFallbackIdentifier(firstNameTh: string, lastNameTh: string) {
    return `${NAME_FALLBACK_IDENTIFIER_PREFIX}${this.normalizeHeader(firstNameTh)}|${this.normalizeHeader(lastNameTh)}`;
  }

  private isStudentNameFallbackIdentifier(value: string) {
    return value.startsWith(NAME_FALLBACK_IDENTIFIER_PREFIX);
  }

  private buildSyntheticStudentIdentifier(row: EnrollmentImportRow) {
    const fingerprint = [
      row.firstNameTh,
      row.lastNameTh,
      row.locationCode || '',
      row.examRound || '',
      row.registeredAt?.toISOString() || '',
      row.tgat ?? '',
      row.tgat1 ?? '',
      row.tgat2 ?? '',
      row.tgat3 ?? '',
      row.rankingOverall ?? '',
      row.rankingLocation ?? '',
    ]
      .map((value) => String(value).trim())
      .join('|');

    const hash = createHash('sha1').update(fingerprint).digest('hex').slice(0, 16).toUpperCase();
    return `AUTO-${hash}`;
  }

  private replacePendingLocationNotes(notes: string | null | undefined, locationCode: string | null) {
    const plainLines = this.extractPlainNoteLines(notes);

    if (locationCode) {
      plainLines.push(this.getPendingLocationMarker(locationCode));
    }

    return plainLines.length > 0 ? plainLines.join('\n') : null;
  }

  private removePendingLocationNote(notes: string | null | undefined, locationCode: string) {
    const normalizedTarget = this.normalizeLocationCode(locationCode);
    const plainLines = String(notes ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) {
          return false;
        }

        if (!line.startsWith(PENDING_LOCATION_PREFIX)) {
          return true;
        }

        const pendingCode = line.slice(PENDING_LOCATION_PREFIX.length).trim();
        return this.normalizeLocationCode(pendingCode) !== normalizedTarget;
      });

    return plainLines.length > 0 ? plainLines.join('\n') : null;
  }

  private extractPendingLocationCodes(notes: string | null | undefined) {
    return String(notes ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(PENDING_LOCATION_PREFIX))
      .map((line) => line.slice(PENDING_LOCATION_PREFIX.length).trim())
      .filter(Boolean);
  }

  private async findExamLocationByCode(code: string) {
    const candidates = this.getLocationCodeCandidates(code);

    if (candidates.length === 0) {
      return null;
    }

    return this.prisma.examLocation.findFirst({
      where: {
        code: {
          in: candidates,
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  private getLocationCodeCandidates(value: unknown) {
    const raw = this.asString(value);
    const normalized = this.normalizeLocationCode(value);

    return Array.from(new Set([raw, raw.toUpperCase(), normalized].filter(Boolean)));
  }

  private extractPlainNoteLines(notes: string | null | undefined) {
    return String(notes ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith(PENDING_LOCATION_PREFIX));
  }

  private getPendingLocationMarker(locationCode: string) {
    return `${PENDING_LOCATION_PREFIX}${String(locationCode).trim()}`;
  }

  private buildOnsiteLocationCode(locationName: string) {
    const normalized = String(locationName)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

    const fallbackHash = createHash('sha1').update(String(locationName).trim()).digest('hex').slice(0, 12).toUpperCase();

    return `ONSITE-${normalized || fallbackHash}`;
  }

  private buildEnrollmentStateKey(
    nationalId: string,
    academicYear: number,
    examRound: ExamRound,
    sourceType: EnrollmentSourceType,
  ) {
    return `${nationalId}|${academicYear}|${examRound}|${sourceType}`;
  }

  private async loadExistingEnrollmentState(
    batch: EnrollmentBatchItem[],
    academicYear: number,
    defaultRound: ExamRound,
    sourceType: EnrollmentSourceType,
  ) {
    const nationalIds = Array.from(new Set(batch.map((item) => item.row.nationalId)));
    const examRounds = Array.from(
      new Set(batch.map((item) => item.row.examRound || defaultRound).filter(Boolean)),
    ) as ExamRound[];

    if (nationalIds.length === 0 || examRounds.length === 0) {
      return new Map<string, { barcode: string | null; notes: string | null }>();
    }

    const existingEnrollments = await this.prisma.enrollment.findMany({
      where: {
        deletedAt: null,
        academicYear,
        sourceType,
        examRound: {
          in: examRounds,
        },
        student: {
          nationalId: {
            in: nationalIds,
          },
        },
      },
      select: {
        barcode: true,
        notes: true,
        examRound: true,
        sourceType: true,
        student: {
          select: {
            nationalId: true,
          },
        },
      },
    });

    const enrollmentStateMap = new Map<string, { barcode: string | null; notes: string | null }>();

    for (const enrollment of existingEnrollments) {
      enrollmentStateMap.set(
        this.buildEnrollmentStateKey(
          enrollment.student.nationalId,
          academicYear,
          enrollment.examRound,
          enrollment.sourceType,
        ),
        {
          barcode: enrollment.barcode,
          notes: enrollment.notes,
        },
      );
    }

    return enrollmentStateMap;
  }

  private async prepareStudentMap(batch: EnrollmentBatchItem[]) {
    type PreparedStudent = {
      id: string;
      nationalId: string;
    };

    const nationalIds = Array.from(
      new Set(batch.map((item) => item.row.nationalId).filter((nationalId) => !this.isStudentNameFallbackIdentifier(nationalId))),
    );
    const studentMap = new Map<string, PreparedStudent>();

    if (nationalIds.length > 0) {
      const existingStudents = await this.prisma.student.findMany({
        where: {
          nationalId: {
            in: nationalIds,
          },
        },
        select: {
          id: true,
          nationalId: true,
        },
      });

      for (const student of existingStudents) {
        studentMap.set(student.nationalId, student as PreparedStudent);
      }
    }
    const latestRowsByNationalId = new Map<string, EnrollmentImportRow>();

    for (const item of batch) {
      latestRowsByNationalId.set(item.row.nationalId, item.row);
    }

    const fallbackRows = Array.from(latestRowsByNationalId.entries())
      .filter(([nationalId]) => this.isStudentNameFallbackIdentifier(nationalId))
      .map(([, row]) => row);

    if (fallbackRows.length > 0) {
      const fallbackNamePairs = Array.from(
        new Map(
          fallbackRows.map((row) => [
            this.buildStudentNameFallbackIdentifier(row.firstNameTh, row.lastNameTh),
            { firstNameTh: row.firstNameTh, lastNameTh: row.lastNameTh },
          ]),
        ).values(),
      );

      const matchedStudents = await this.prisma.student.findMany({
        where: {
          deletedAt: null,
          OR: fallbackNamePairs.map((pair) => ({
            firstNameTh: pair.firstNameTh,
            lastNameTh: pair.lastNameTh,
          })),
        },
        select: {
          id: true,
          nationalId: true,
          firstNameTh: true,
          lastNameTh: true,
        },
      });

      const studentsByNameKey = new Map<string, PreparedStudent[]>();

      for (const student of matchedStudents) {
        const nameKey = this.buildStudentNameFallbackIdentifier(student.firstNameTh, student.lastNameTh);
        const existing = studentsByNameKey.get(nameKey) || [];
        existing.push(student as PreparedStudent);
        studentsByNameKey.set(nameKey, existing);
        studentMap.set(student.nationalId, student as PreparedStudent);
      }

      for (const row of fallbackRows) {
        const nameKey = this.buildStudentNameFallbackIdentifier(row.firstNameTh, row.lastNameTh);
        const matches = studentsByNameKey.get(nameKey) || [];

        if (matches.length === 1) {
          row.nationalId = matches[0].nationalId;
          studentMap.set(matches[0].nationalId, matches[0]);
          continue;
        }

        row.nationalId = this.buildSyntheticStudentIdentifier(row);
      }
    }

    const missingStudentRows = Array.from(latestRowsByNationalId.values()).filter(
      (row) => !studentMap.has(row.nationalId),
    );

    if (missingStudentRows.length > 0) {
      const createdStudents = await this.prisma.student.createManyAndReturn({
        data: missingStudentRows.map((row) => ({
          nationalId: row.nationalId,
          prefix: row.prefix,
          firstNameTh: row.firstNameTh,
          lastNameTh: row.lastNameTh,
          firstNameEn: row.firstNameEn,
          lastNameEn: row.lastNameEn,
          email: row.email,
          phone: row.phone,
          schoolName: row.schoolName,
          province: row.province,
        })),
        select: {
          id: true,
          nationalId: true,
        },
      });

      for (const student of createdStudents) {
        studentMap.set(student.nationalId, student as PreparedStudent);
      }
    }

    return studentMap;
  }

  private async prepareEnrollmentBarcodes(
    batch: EnrollmentBatchItem[],
    academicYear: number,
    defaultRound: ExamRound,
    sourceType: EnrollmentSourceType,
    enrollmentStateMap: Map<string, { barcode: string | null; notes: string | null }>,
  ) {
    const barcodeMap = new Map<string, string>();
    const keysNeedingBarcode = batch
      .map((item) =>
        this.buildEnrollmentStateKey(
          item.row.nationalId,
          academicYear,
          item.row.examRound || defaultRound,
          sourceType,
        ),
      )
      .filter((key, index, keys) => keys.indexOf(key) === index)
      .filter((key) => {
        const existing = enrollmentStateMap.get(key);
        return !existing || !this.isEightDigitBarcode(existing.barcode);
      });

    if (keysNeedingBarcode.length === 0) {
      return barcodeMap;
    }

    const allocatedBarcodes = new Set<string>();

    while (barcodeMap.size < keysNeedingBarcode.length) {
      const remainingCount = keysNeedingBarcode.length - barcodeMap.size;
      const candidateBarcodes = new Set<string>();

      while (candidateBarcodes.size < remainingCount * 2) {
        const candidate = String(randomInt(0, 10 ** BARCODE_LENGTH)).padStart(BARCODE_LENGTH, '0');

        if (!allocatedBarcodes.has(candidate)) {
          candidateBarcodes.add(candidate);
        }
      }

      const existingBarcodes = await this.prisma.enrollment.findMany({
        where: {
          barcode: {
            in: Array.from(candidateBarcodes),
          },
        },
        select: {
          barcode: true,
        },
      });

      const blockedBarcodes = new Set(existingBarcodes.map((item) => item.barcode));

      for (const candidate of candidateBarcodes) {
        if (blockedBarcodes.has(candidate)) {
          continue;
        }

        const key = keysNeedingBarcode[barcodeMap.size];

        if (!key) {
          break;
        }

        barcodeMap.set(key, candidate);
        allocatedBarcodes.add(candidate);
      }
    }

    return barcodeMap;
  }

  private async loadExamLocationMap(batch: EnrollmentBatchItem[]) {
    const locationCodes = Array.from(
      new Set(batch.map((item) => this.normalizeLocationCode(item.row.locationCode)).filter(Boolean)),
    );

    if (locationCodes.length === 0) {
      return new Map<string, { id: string; code: string; name: string; eventDate?: Date | null; eventStartMinutes?: number | null; eventEndMinutes?: number | null }>();
    }

    const examLocations = await this.prisma.examLocation.findMany({
      where: {
        code: {
          in: locationCodes,
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        eventDate: true,
        eventStartMinutes: true,
        eventEndMinutes: true,
      },
    });

    return new Map(
      examLocations.map((examLocation) => [
        this.normalizeLocationCode(examLocation.code),
        {
          id: examLocation.id,
          code: examLocation.code,
          name: examLocation.name,
          eventDate: examLocation.eventDate,
          eventStartMinutes: examLocation.eventStartMinutes,
          eventEndMinutes: examLocation.eventEndMinutes,
        },
      ]),
    );
  }

  private resolveEnrollmentRegistrationWindow(
    round: ExamRound,
    rowDate: Date | undefined,
    fallbackExamDate: string | undefined,
    sourceType: EnrollmentSourceType,
    examLocation?: { eventDate?: Date | null; eventStartMinutes?: number | null; eventEndMinutes?: number | null } | null,
  ) {
    const baseDate = rowDate ?? examLocation?.eventDate ?? this.parseDate(fallbackExamDate) ?? new Date();

    if (
      sourceType === EnrollmentSourceType.SIMULATED_EXCEL &&
      (examLocation?.eventStartMinutes != null || examLocation?.eventEndMinutes != null)
    ) {
      return this.buildRegistrationWindowFromMinutes(baseDate, examLocation?.eventStartMinutes, examLocation?.eventEndMinutes);
    }

    return this.getRegistrationWindow(round, baseDate);
  }

  private buildSimulatedLocationRegistrationWindowUpdate(
    enrollment: { examRound?: ExamRound | string | null; registeredAt?: Date | null; registrationStartAt?: Date | null },
    examLocation: { eventDate?: Date | null; eventStartMinutes?: number | null; eventEndMinutes?: number | null },
  ) {
    const round =
      enrollment.examRound === ExamRound.MORNING || enrollment.examRound === ExamRound.AFTERNOON
        ? enrollment.examRound
        : ExamRound.AFTERNOON;
    const baseDate = examLocation.eventDate ?? enrollment.registeredAt ?? enrollment.registrationStartAt ?? new Date();

    const registrationWindow =
      examLocation.eventStartMinutes != null || examLocation.eventEndMinutes != null
        ? this.buildRegistrationWindowFromMinutes(baseDate, examLocation.eventStartMinutes, examLocation.eventEndMinutes)
        : this.getRegistrationWindow(round, baseDate);

    return {
      registrationStartAt: registrationWindow.start,
      registrationEndAt: registrationWindow.end,
    };
  }

  private buildRegistrationWindowFromMinutes(baseDate: Date, startMinutes?: number | null, endMinutes?: number | null) {
    const fallbackStartMinutes = startMinutes ?? 9 * 60;
    const fallbackEndMinutes = endMinutes ?? fallbackStartMinutes + 180;
    const start = new Date(baseDate);
    const end = new Date(baseDate);

    start.setHours(Math.floor(fallbackStartMinutes / 60), fallbackStartMinutes % 60, 0, 0);
    end.setHours(Math.floor(fallbackEndMinutes / 60), fallbackEndMinutes % 60, 0, 0);

    return { start, end };
  }

  private parseLocationTimeMetadata(startTime: unknown, endTime: unknown, timeRange: unknown) {
    const parsedStartTime = this.parseTimeToMinutes(startTime);
    const parsedEndTime = this.parseTimeToMinutes(endTime);
    const parsedRange = this.parseTimeRangeToMinutes(timeRange);

    return {
      eventStartMinutes: parsedStartTime ?? parsedRange?.startMinutes,
      eventEndMinutes: parsedEndTime ?? parsedRange?.endMinutes,
    };
  }

  private parseTimeRangeToMinutes(value: unknown) {
    const raw = this.asString(value);

    if (!raw) {
      return null;
    }

    const matches = raw.match(/\d{1,2}[:.]\d{2}/g);

    if (!matches || matches.length < 2) {
      return null;
    }

    const startMinutes = this.parseTimeToMinutes(matches[0]);
    const endMinutes = this.parseTimeToMinutes(matches[matches.length - 1]);

    if (startMinutes == null || endMinutes == null) {
      return null;
    }

    return { startMinutes, endMinutes };
  }

  private parseTimeToMinutes(value: unknown) {
    const raw = this.asString(value);

    if (!raw) {
      return null;
    }

    const match = raw.match(/(\d{1,2})[:.](\d{2})/);

    if (!match) {
      return null;
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }

    return hours * 60 + minutes;
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    getKey: (item: T) => string,
    handler: (item: T) => Promise<void>,
  ) {
    if (items.length === 0) {
      return;
    }

    const chains = new Map<string, Promise<void>>();
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;

          if (currentIndex >= items.length) {
            return;
          }

          const item = items[currentIndex];
          const key = getKey(item);
          const previous = chains.get(key) ?? Promise.resolve();
          const current = previous.catch(() => undefined).then(() => handler(item));

          chains.set(key, current);
          await current;
        }
      }),
    );
  }

  private getRequiredHeaderFields(config: HeaderResolverConfig): RequiredHeaderField[] {
    if ('nationalId' in config) {
      return ['nationalId', 'firstNameTh', 'lastNameTh'];
    }

    return ['code', 'name'];
  }

  private parseExamRound(input: string | undefined, fallback: 'MORNING' | 'AFTERNOON') {
    return this.parseRowExamRound(input) || (fallback === 'AFTERNOON' ? ExamRound.AFTERNOON : ExamRound.MORNING);
  }

  private parseRowExamRound(input: unknown) {
    const normalized = this.normalizeHeader(String(input ?? ''));

    if (!normalized) {
      return undefined;
    }

    if (
      normalized.includes('afternoon') ||
      normalized.includes('รอบบ่าย') ||
      normalized.includes('บ่าย') ||
      normalized.includes('14001700') ||
      normalized.includes('12001430')
    ) {
      return ExamRound.AFTERNOON;
    }

    if (
      normalized.includes('morning') ||
      normalized.includes('รอบเช้า') ||
      normalized.includes('เช้า') ||
      normalized.includes('09001200') ||
      normalized.includes('08000930')
    ) {
      return ExamRound.MORNING;
    }

    return undefined;
  }

  private getRegistrationWindow(round: ExamRound, examDate: Date) {
    const start = new Date(examDate);
    const end = new Date(examDate);

    if (round === ExamRound.MORNING) {
      start.setHours(8, 0, 0, 0);
      end.setHours(9, 30, 0, 0);
    } else {
      start.setHours(12, 0, 0, 0);
      end.setHours(14, 30, 0, 0);
    }

    return { start, end };
  }

  private isEightDigitBarcode(value: string | null | undefined): value is string {
    return EIGHT_DIGIT_BARCODE_PATTERN.test(String(value ?? '').trim());
  }

  private async generateBarcode() {
    for (let attempt = 0; attempt < BARCODE_MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const barcode = String(randomInt(0, 10 ** BARCODE_LENGTH)).padStart(BARCODE_LENGTH, '0');
      const existing = await this.prisma.enrollment.findUnique({
        where: { barcode },
        select: { id: true },
      });

      if (!existing) {
        return barcode;
      }
    }

    throw new BadRequestException('ไม่สามารถสร้างบาร์โค้ด 8 หลักที่ไม่ซ้ำกันได้ กรุณาลองใหม่อีกครั้ง');
  }

  private async cleanupFiles(files: ImportRequest['files']) {
    const allFiles = [...(files.locations ?? []), ...(files.onsite ?? []), ...(files.simulated ?? [])];

    await Promise.all(
      allFiles.map(async (file) => {
        try {
          await unlink(file.path);
        } catch {
          return undefined;
        }
      }),
    );
  }

  private rowToArray(values: unknown) {
    if (Array.isArray(values)) {
      return Array.from(values.slice(1)).map((value) => this.normalizeWorksheetCellValue(value));
    }

    if (typeof values === 'object' && values !== null) {
      return Array.from(Object.values(values).slice(1)).map((value) => this.normalizeWorksheetCellValue(value));
    }

    return [];
  }

  private normalizeHeader(value: string) {
    return value.replace(/\s+/g, '').replace(/[()_\-]/g, '').toLowerCase();
  }

  private isEmptyRow(values: unknown[]) {
    return values.every((value) => this.asString(value) === '');
  }

  private asString(value: unknown) {
    return String(this.normalizeWorksheetCellValue(value) ?? '').trim();
  }

  private normalizeWorksheetCellValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (value instanceof Date || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.asString(item)).join(' ').trim();
    }

    if (typeof value === 'object') {
      const cellValue = value as {
        text?: unknown;
        result?: unknown;
        richText?: Array<{ text?: unknown }>;
        hyperlink?: unknown;
        value?: unknown;
      };

      if (Array.isArray(cellValue.richText) && cellValue.richText.length > 0) {
        return cellValue.richText.map((item) => this.asString(item.text)).join('').trim();
      }

      if (cellValue.result !== undefined && cellValue.result !== null) {
        return this.normalizeWorksheetCellValue(cellValue.result);
      }

      if (cellValue.text !== undefined && cellValue.text !== null) {
        return this.normalizeWorksheetCellValue(cellValue.text);
      }

      if (cellValue.value !== undefined && cellValue.value !== null) {
        return this.normalizeWorksheetCellValue(cellValue.value);
      }

      if (cellValue.hyperlink !== undefined && cellValue.hyperlink !== null) {
        return this.normalizeWorksheetCellValue(cellValue.hyperlink);
      }
    }

    return value;
  }

  private asOptionalString(value: unknown) {
    const normalized = this.asString(value);
    return normalized || undefined;
  }

  private asOptionalLocationCode(value: unknown) {
    const normalized = this.normalizeLocationCode(value);
    return normalized || undefined;
  }

  private normalizeLocationCode(value: unknown) {
    const raw = this.asString(value);

    if (!raw) {
      return '';
    }

    const compact = raw.replace(/\s+/g, ' ').trim();

    if (/^\d+(?:\.0+)?$/.test(compact)) {
      return String(Number(compact));
    }

    const trailingNumericCode = compact.match(/^(?:สนามสอบที่|สนามสอบหมายเลข|รหัสสนามสอบ|รหัสสถานที่สอบ)\s*(\d+(?:\.0+)?)$/i);

    if (trailingNumericCode?.[1]) {
      return String(Number(trailingNumericCode[1]));
    }

    return compact.toUpperCase();
  }

  private asOptionalNumber(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }

    const numeric = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  private asOptionalInteger(value: unknown) {
    const numeric = this.asOptionalNumber(value);

    if (numeric === undefined) {
      return undefined;
    }

    return Number.isInteger(numeric) ? numeric : Math.trunc(numeric);
  }

  private parseDate(value: unknown) {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'number' && value > 25569) {
      return new Date((value - 25569) * 86400 * 1000);
    }

    const thaiDate = this.parseThaiDateString(value);

    if (thaiDate) {
      return thaiDate;
    }

    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseThaiDateString(value: unknown) {
    const raw = this.asString(value);

    if (!raw) {
      return null;
    }

    const normalized = raw
      .replace(/^วัน[^\s]+\s+/u, '')
      .replace(/\s+/g, ' ')
      .trim();
    const match = normalized.match(/(\d{1,2})\s+([ก-๙A-Za-z.]+)\s+(\d{4})/u);

    if (!match) {
      return null;
    }

    const day = parseInt(match[1], 10);
    const month = THAI_MONTH_ALIASES.get(match[2]);
    const rawYear = parseInt(match[3], 10);

    if (!day || month === undefined || !rawYear) {
      return null;
    }

    const year = rawYear >= 2400 ? rawYear - 543 : rawYear;
    const date = new Date(year, month, day);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  private formatRowError(rowNumber: number, error: unknown) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof response === 'object' && response && 'message' in response
            ? String((response as { message?: string }).message)
            : error.message;

      return `Row ${rowNumber}: ${message}`;
    }

    if (error instanceof Error) {
      return `Row ${rowNumber}: ${error.message}`;
    }

    return `Row ${rowNumber}: Unknown import error`;
  }
}