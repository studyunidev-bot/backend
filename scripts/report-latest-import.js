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
const { Client } = requireFromProjectRoot('./.deps/node_modules/pg');

function normalizeSourceType(input) {
  const raw = String(input || 'SIMULATED_EXCEL').trim().toUpperCase();
  const aliases = {
    SIMULATED: 'SIMULATED_EXCEL',
    SIMULATED_EXCEL: 'SIMULATED_EXCEL',
    ONSITE: 'ONSITE_EXCEL',
    ONSITE_EXCEL: 'ONSITE_EXCEL',
    LOCATIONS: 'MANUAL',
    MANUAL: 'MANUAL',
    API: 'API',
  };

  const resolved = aliases[raw];

  if (!resolved) {
    throw new Error('Usage: node scripts/report-latest-import.js [SIMULATED|ONSITE|LOCATIONS|API]');
  }

  return resolved;
}

async function main() {
  const sourceType = normalizeSourceType(process.argv[2]);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(
      `
        SELECT id, "sourceType", "originalName", "academicYear", "uploadedAt", "rowCount", "successCount", "failedCount", "errorSnapshot"
        FROM "ImportFile"
        WHERE "sourceType" = $1
        ORDER BY "uploadedAt" DESC
        LIMIT 1
      `,
      [sourceType],
    );

    const latest = result.rows[0];

    if (!latest) {
      console.log(JSON.stringify({ sourceType, found: false }, null, 2));
      return;
    }

    const errors = Array.isArray(latest.errorSnapshot) ? latest.errorSnapshot : [];

    console.log(
      JSON.stringify(
        {
          found: true,
          sourceType: latest.sourceType,
          importId: latest.id,
          originalName: latest.originalName,
          academicYear: latest.academicYear,
          uploadedAt: latest.uploadedAt,
          rowCount: latest.rowCount,
          successCount: latest.successCount,
          failedCount: latest.failedCount,
          sampleErrors: errors.slice(0, 5),
          remainingErrorCount: Math.max(errors.length - 5, 0),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});