import '../load-env';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createRequire } from 'node:module';
import { PrismaClient } from '../generated/prisma/client';

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

type PrismaPgConstructor = new (pool: unknown) => unknown;
type PoolConstructor = new (options: {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
}) => unknown;

const { PrismaPg } = requireProjectDependency<{ PrismaPg: PrismaPgConstructor }>(
  './.deps/node_modules/@prisma/adapter-pg',
  '@prisma/adapter-pg',
);
const { Pool } = requireProjectDependency<{ Pool: PoolConstructor }>(
  './.deps/node_modules/pg',
  'pg',
);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    });

    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
