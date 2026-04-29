import { Injectable } from '@nestjs/common';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';

const DASHBOARD_STATS_CACHE_TTL_MS = 10000;

@Injectable()
export class DashboardService {
  private readonly statsCache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(private readonly prisma: PrismaService) {}

  private getCurrentAcademicYear() {
    return new Date().getFullYear();
  }

  private buildCacheKey(query: {
    academicYear: number;
    locationId?: string;
    requestedSessionId?: string;
    from?: Date;
    to?: Date;
    includeHistory: boolean;
  }) {
    return JSON.stringify({
      academicYear: query.academicYear,
      locationId: query.locationId || null,
      requestedSessionId: query.requestedSessionId || null,
      from: query.from?.toISOString() || null,
      to: query.to?.toISOString() || null,
      includeHistory: query.includeHistory,
    });
  }

  private pruneCache() {
    const now = Date.now();

    for (const [key, entry] of this.statsCache.entries()) {
      if (entry.expiresAt <= now) {
        this.statsCache.delete(key);
      }
    }
  }

  async getStats(query: any) {
    const currentAcademicYear = this.getCurrentAcademicYear();
    const academicYear = query.academicYear ? Number(query.academicYear) : currentAcademicYear;
    const locationId = query.locationId || undefined;
    const requestedSessionId = query.sessionId || undefined;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const includeHistory = String(query.includeHistory ?? 'true').toLowerCase() !== 'false';
    const cacheKey = this.buildCacheKey({ academicYear, locationId, requestedSessionId, from, to, includeHistory });

    this.pruneCache();

    const cachedResult = this.statsCache.get(cacheKey);

    if (cachedResult && cachedResult.expiresAt > Date.now()) {
      return cachedResult.value;
    }

    const activeSessions = await this.prisma.checkInSession.findMany({
      where: {
        isActive: true,
        academicYear,
      },
      include: { examLocation: true },
      orderBy: { startedAt: 'desc' },
    });

    const scopedSessionIds = requestedSessionId
      ? [requestedSessionId]
      : undefined;

    const enrollmentWhere: any = {
      deletedAt: null,
      academicYear,
      ...(locationId ? { examLocationId: locationId } : {}),
    };

    const checkInWhere: any = {
      ...(scopedSessionIds ? { sessionId: { in: scopedSessionIds } } : {}),
      ...(from || to
        ? {
            scannedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      enrollment: {
        academicYear,
        ...(locationId ? { examLocationId: locationId } : {}),
      },
    };

    const [totalEnrollments, checkedInCount, averageScore] = await Promise.all([
      this.prisma.enrollment.count({ where: enrollmentWhere }),
      this.prisma.checkIn.count({ where: checkInWhere }),
      this.prisma.score.aggregate({
        where: {
          enrollment: {
            academicYear,
            ...(locationId ? { examLocationId: locationId } : {}),
          },
        },
        _avg: {
          tgat: true,
        },
      }),
    ]);

    const conditions: Prisma.Sql[] = [Prisma.sql`1 = 1`];

    conditions.push(Prisma.sql`e."academicYear" = ${academicYear}`);

    if (locationId) {
      conditions.push(Prisma.sql`e."examLocationId" = ${locationId}`);
    }

    if (scopedSessionIds) {
      conditions.push(Prisma.sql`c."sessionId" IN (${Prisma.join(scopedSessionIds)})`);
    }

    if (from) {
      conditions.push(Prisma.sql`c."scannedAt" >= ${from}`);
    }

    if (to) {
      conditions.push(Prisma.sql`c."scannedAt" <= ${to}`);
    }

    const hourlyRows = includeHistory
      ? await this.prisma.$queryRaw<Array<{ locationName: string; hour: Date; total: bigint }>>(
          Prisma.sql`
            SELECT COALESCE(l."name", 'Unassigned') AS "locationName",
                   date_trunc('hour', c."scannedAt") AS "hour",
                   COUNT(*)::bigint AS "total"
            FROM "CheckIn" c
            JOIN "Enrollment" e ON e."id" = c."enrollmentId"
            LEFT JOIN "ExamLocation" l ON l."id" = e."examLocationId"
            WHERE ${Prisma.join(conditions, ' AND ')}
            GROUP BY COALESCE(l."name", 'Unassigned'), date_trunc('hour', c."scannedAt")
            ORDER BY "hour" ASC
          `,
        )
      : [];

    const result = {
      currentAcademicYear: academicYear,
      totalEnrollments,
      checkedInCount,
      notCheckedInCount: Math.max(totalEnrollments - checkedInCount, 0),
      averageTgat: averageScore._avg.tgat,
      activeSessions,
      selectedSessionId: requestedSessionId || activeSessions[0]?.id || null,
      hourlyCheckIns: hourlyRows.map((row) => ({
        locationName: row.locationName,
        hour: row.hour,
        total: Number(row.total),
      })),
    };

    this.statsCache.set(cacheKey, {
      expiresAt: Date.now() + DASHBOARD_STATS_CACHE_TTL_MS,
      value: result,
    });

    return result;
  }
}