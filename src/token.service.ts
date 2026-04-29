import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appConfig } from './env';

type TokenPayload = {
  sub: string;
  email: string;
  role: string;
  fullName?: string | null;
  exp?: number;
};

@Injectable()
export class TokenService {
  sign(payload: TokenPayload) {
    const header = this.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.base64UrlEncode(
      JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + this.parseExpiry(appConfig.jwtExpiresIn),
      }),
    );
    const signature = this.signRaw(`${header}.${body}`);

    return `${header}.${body}.${signature}`;
  }

  verify(token: string) {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) {
      throw new UnauthorizedException('Malformed token');
    }

    const expectedSignature = this.signRaw(`${header}.${body}`);
    if (!this.safeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException('Invalid token signature');
    }

    const payload = JSON.parse(this.base64UrlDecode(body)) as TokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired');
    }

    return payload;
  }

  private signRaw(input: string) {
    return this.base64UrlEncode(
      createHmac('sha256', appConfig.jwtSecret).update(input).digest(),
    );
  }

  private parseExpiry(value: string) {
    if (/^\d+$/.test(value)) {
      return Number(value);
    }

    const match = value.match(/^(\d+)([smhd])$/i);
    if (!match) {
      return 12 * 60 * 60;
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return amount * multipliers[unit];
  }

  private base64UrlEncode(input: string | Buffer) {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private base64UrlDecode(input: string) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }
}