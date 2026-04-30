import './load-env';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as express from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './http-exception.filter';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { appConfig } from './env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  if (appConfig.trustProxy) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.useGlobalInterceptors(new AuditLogInterceptor());

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    maxAge: 3600,
  });

  app.getHttpAdapter().getInstance().disable('x-powered-by');

  app.use(
    '/uploads',
    express.static(join(process.cwd(), '.tmp', 'public'), {
      fallthrough: false,
      maxAge: appConfig.isProduction ? '7d' : 0,
    }),
  );

  const port = appConfig.port;
  await app.listen(port);
  logger.log(`Application is running on port ${port} in ${appConfig.nodeEnv} mode`);
}
bootstrap();