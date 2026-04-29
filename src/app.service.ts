import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { appConfig } from './env';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'GAT/PAT registration API is running';
  }

  async getHealth() {
    const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        service: 'demo-app-register-gat-pat-api',
        environment: appConfig.nodeEnv,
        version: process.env.npm_package_version ?? '0.0.1',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        startedAt,
        checks: {
          application: 'up',
          database: 'up',
        },
      };
    } catch (error: any) {
      return {
        status: 'degraded',
        service: 'demo-app-register-gat-pat-api',
        environment: appConfig.nodeEnv,
        version: process.env.npm_package_version ?? '0.0.1',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        startedAt,
        checks: {
          application: 'up',
          database: 'down',
        },
        error: appConfig.isProduction ? undefined : error?.message,
      };
    }
  }
}
