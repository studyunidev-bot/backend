import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Log error for monitoring
    this.logger.error(
      `${exception.message}`,
      exception.stack,
      `${exception.constructor.name}`,
    );

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      message:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error - please contact support'
          : exception.message,
      ...(process.env.NODE_ENV === 'development' && {
        error: exception.name,
        details: exception.message,
      }),
    };

    response.status(status).json(errorResponse);
  }
}
