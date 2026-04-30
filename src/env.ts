type AppConfig = {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  jwtSecret: string;
  jwtExpiresIn: string;
  throttleTtlSeconds: number;
  throttleLimit: number;
  trustProxy: boolean;
};

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://www.studyunith.com',
  'https://studyunith.com',
];

function parseNumber(name: string, fallback: number) {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function parseBoolean(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function buildConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const port = parseNumber('PORT', 3001);
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me';
  if (isProduction && jwtSecret === 'dev-only-change-me') {
    throw new Error('JWT_SECRET must be set in production');
  }

  return {
    nodeEnv,
    isProduction,
    port,
    corsOrigins: (process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGINS.join(','))
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
    throttleTtlSeconds: parseNumber('THROTTLE_TTL_SECONDS', 60),
    throttleLimit: parseNumber('THROTTLE_LIMIT', 120),
    trustProxy: parseBoolean('TRUST_PROXY', false),
  };
}

export const appConfig = buildConfig();