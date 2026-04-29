import '../load-env';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createRequire } from 'node:module';
import { PrismaClient } from '../generated/prisma/client';

const requireFromProjectRoot = createRequire(`${process.cwd()}/`);
const { PrismaPg } = requireFromProjectRoot('./.deps/node_modules/@prisma/adapter-pg');
const { Pool } = requireFromProjectRoot('./.deps/node_modules/pg');

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
