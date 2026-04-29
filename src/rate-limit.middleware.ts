import {
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { appConfig } from './env';

type RateBucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private static readonly buckets = new Map<string, RateBucket>();

  use(req: Request, _res: Response, next: NextFunction) {
    if (req.path === '/health' || req.path === '/favicon.ico') {
      next();
      return;
    }

    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = req.path === '/auth/login' ? 10 : appConfig.throttleLimit;
    const ttlMs = req.path === '/auth/login' ? 60_000 : appConfig.throttleTtlSeconds * 1000;
    const key = `${ip}:${req.path}`;
    const bucket = RateLimitMiddleware.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      RateLimitMiddleware.buckets.set(key, { count: 1, resetAt: now + ttlMs });
      this.cleanup(now);
      next();
      return;
    }

    if (bucket.count >= limit) {
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    bucket.count += 1;
    next();
  }

  private cleanup(now: number) {
    if (RateLimitMiddleware.buckets.size < 10000) {
      return;
    }

    for (const [key, bucket] of RateLimitMiddleware.buckets.entries()) {
      if (bucket.resetAt <= now) {
        RateLimitMiddleware.buckets.delete(key);
      }
    }

    if (RateLimitMiddleware.buckets.size > 20000) {
      throw new ServiceUnavailableException('Rate limiter memory pressure detected');
    }
  }
}