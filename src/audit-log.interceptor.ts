import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            JSON.stringify({
              method: request.method,
              path: request.originalUrl || request.url,
              statusCode: response.statusCode,
              durationMs: Date.now() - startedAt,
              ip: request.ip,
              userId: request.user?.sub ?? null,
              role: request.user?.role ?? null,
            }),
          );
        },
      }),
    );
  }
}