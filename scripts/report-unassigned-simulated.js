const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createRequire } = require('node:module');

const projectRoot = process.cwd();
const envFilePath = join(projectRoot, '.env');

if (existsSync(envFilePath)) {
  const envContent = readFileSync(envFilePath, 'utf8');

  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const requireFromProjectRoot = createRequire(`${projectRoot}/`);
const { PrismaPg } = requireFromProjectRoot('./.deps/node_modules/@prisma/adapter-pg');
const { Pool } = requireFromProjectRoot('./.deps/node_modules/pg');
const { PrismaClient } = requireFromProjectRoot('./dist/src/generated/prisma/client.js');

async function main() {
  const academicYearArg = process.argv[2];
  const academicYear = Number(academicYearArg || new Date().getFullYear());

  if (!Number.isInteger(academicYear) || academicYear < 2000) {
    throw new Error('Usage: node scripts/report-unassigned-simulated.js [academicYear]');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  });

  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        deletedAt: null,
        academicYear,
        sourceType: 'SIMULATED_EXCEL',
        examLocationId: null,
      },
      select: {
        id: true,
        notes: true,
        examRound: true,
        simulatedImportFile: {
          select: {
            id: true,
            originalName: true,
            uploadedAt: true,
          },
        },
        student: {
          select: {
            nationalId: true,
            firstNameTh: true,
            lastNameTh: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const pendingPrefix = 'pendingLocationCode:';
    const withPendingMarker = enrollments.filter((item) => String(item.notes || '').includes(pendingPrefix));
    const missingImportState = enrollments.filter((item) => !String(item.notes || '').includes(pendingPrefix));

    const summary = {
      academicYear,
      totalWithoutLocation: enrollments.length,
      withPendingMarker: withPendingMarker.length,
      missingImportState: missingImportState.length,
      sampleMissingImportState: missingImportState.slice(0, 20).map((item) => ({
        enrollmentId: item.id,
        nationalId: item.student.nationalId,
        fullName: `${item.student.firstNameTh} ${item.student.lastNameTh}`.trim(),
        examRound: item.examRound,
        simulatedImportFileId: item.simulatedImportFile?.id || null,
        simulatedImportFileName: item.simulatedImportFile?.originalName || null,
        uploadedAt: item.simulatedImportFile?.uploadedAt || null,
      })),
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});