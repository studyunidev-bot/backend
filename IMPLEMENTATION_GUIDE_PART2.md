# Implementation Guide - Part 2: Medium Priority & Enhancements

## 7️⃣ HEALTH CHECKS (Terminus)

### Why Critical:
Kubernetes and load balancers need to know if your app is actually healthy, not just responding.

### Installation:
```bash
npm install @nestjs/terminus
```

### New File: src/health/health.controller.ts

```typescript
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  DatabaseHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: DatabaseHealthIndicator,
    private prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      // Database health
      async () => {
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return {
            database: {
              status: 'up',
            },
          };
        } catch (error) {
          return {
            database: {
              status: 'down',
              error: error.message,
            },
          };
        }
      },
    ]);
  }

  @Get('live')
  async liveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'not_ready',
        reason: 'Database unavailable',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
```

### Create health.module.ts

```typescript
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

### Update app.module.ts

```typescript
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // ... existing imports
    HealthModule,
  ],
})
export class AppModule {}
```

---

## 8️⃣ INPUT SANITIZATION

### New File: src/common/sanitizer/html-sanitizer.ts

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class HtmlSanitizer {
  private readonly dangerousPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /<object[^>]*>.*?<\/object>/gi,
    /<embed[^>]*>/gi,
  ];

  sanitize(input: string): string {
    if (!input || typeof input !== 'string') {
      return input;
    }

    let sanitized = input;
    this.dangerousPatterns.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, '');
    });

    return sanitized.trim();
  }

  validateAndSanitize(input: string, fieldName: string): string {
    if (!input) return input;

    if (typeof input !== 'string') {
      throw new BadRequestException(`${fieldName} must be a string`);
    }

    if (input.length > 10000) {
      throw new BadRequestException(`${fieldName} is too long (max 10000 chars)`);
    }

    return this.sanitize(input);
  }
}
```

### New Decorator: src/common/decorators/sanitize.decorator.ts

```typescript
import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';
import { HtmlSanitizer } from '../sanitizer/html-sanitizer';

export const Sanitize = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const sanitizer = new HtmlSanitizer();
  const body = request.body;

  if (body && typeof body === 'object') {
    Object.keys(body).forEach((key) => {
      if (typeof body[key] === 'string') {
        body[key] = sanitizer.sanitize(body[key]);
      }
    });
  }

  return request;
});
```

### Usage in Controller:

```typescript
import { Sanitize } from '../common/decorators/sanitize.decorator';

@Post('register')
async register(@Body() @Sanitize() registerDto: RegisterDto) {
  return this.authService.register(registerDto);
}
```

---

## 9️⃣ RBAC - ROLES BASED ACCESS CONTROL

### File: src/auth/decorators/require-role.decorator.ts

```typescript
import { SetMetadata } from '@nestjs/common';

export const RequireRole = (...roles: string[]) =>
  SetMetadata('requiredRoles', roles);
```

### File: src/auth/guards/roles.guard.ts (already mentioned, but here's complete)

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>(
      'requiredRoles',
      context.getHandler(),
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // No specific role requirement
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}, but user has: ${user.role}`,
      );
    }

    return true;
  }
}
```

### Usage in Controller:

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtGuard } from './auth/guards/jwt.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { RequireRole } from './auth/decorators/require-role.decorator';

@Controller('admin')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('ADMIN')
export class AdminController {
  @Get('users')
  async getAllUsers() {
    // Only ADMIN role can access
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    // Only ADMIN role can access
  }
}
```

---

## 🔟 AUDIT TRAIL LOGGING

### Update schema.prisma:

```prisma
model AuditLog {
  id        String    @id @default(uuid())
  userId    String?
  action    String    // LOGIN, LOGOUT, CREATE_USER, UPDATE_USER, DELETE_USER
  resource  String    // users, posts, etc
  resourceId String?  // ID of affected resource
  details   Json?     // { email: "old@x.com" -> "new@x.com" }
  ipAddress String?
  userAgent String?
  success   Boolean   @default(true)
  createdAt DateTime  @default(now())

  @@index([userId])
  @@index([createdAt])
  @@index([action])
  @@map("audit_logs")
}
```

### New File: src/common/interceptors/audit.interceptor.ts

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(async () => {
        const duration = Date.now() - startTime;

        // Determine action based on method and route
        const action = this.getAction(method, url);

        if (action) {
          await this.prisma.auditLog.create({
            data: {
              userId: user?.id,
              action,
              resource: this.getResource(url),
              resourceId: this.extractResourceId(url),
              ipAddress: request.ip,
              userAgent: request.get('user-agent'),
              details: {
                method,
                url,
                duration,
              },
            },
          });
        }
      }),
    );
  }

  private getAction(method: string, url: string): string | null {
    if (url.includes('/auth/login') && method === 'POST') return 'LOGIN';
    if (url.includes('/auth/logout') && method === 'POST') return 'LOGOUT';
    if (url.includes('/users') && method === 'POST') return 'CREATE_USER';
    if (url.includes('/users') && method === 'PUT') return 'UPDATE_USER';
    if (url.includes('/users') && method === 'DELETE') return 'DELETE_USER';
    return null;
  }

  private getResource(url: string): string {
    if (url.includes('/users')) return 'users';
    if (url.includes('/posts')) return 'posts';
    return 'unknown';
  }

  private extractResourceId(url: string): string | null {
    const match = url.match(/\/(\w+)\/([a-f0-9-]+)/);
    return match ? match[2] : null;
  }
}
```

### Usage in app.module.ts:

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

@Module({
  // ...
  providers: [
    // ...
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
```

---

## 1️⃣1️⃣ REQUEST CORRELATION ID (Observability)

### New File: src/common/middleware/request-id.middleware.ts

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

export const requestIdStorage = new AsyncLocalStorage<string>();

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = req.get('X-Request-ID') || v4();

    // Store in async context
    requestIdStorage.run(requestId, () => {
      res.setHeader('X-Request-ID', requestId);
      req['requestId'] = requestId;
      next();
    });
  }
}
```

### Update main.ts:

```typescript
app.use(new RequestIdMiddleware());
```

### Update logger config to include request ID:

```typescript
// In your logger or interceptor
const requestId = requestIdStorage.getStore();
logger.log(`[${requestId}] Request to ${url}`);
```

---

## 1️⃣2️⃣ API DOCUMENTATION WITH SWAGGER

### Installation:
```bash
npm install @nestjs/swagger swagger-ui-express
```

### Update main.ts:

```typescript
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Demo App API')
    .setDescription('User registration and authentication API')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'Authorization',
    )
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management endpoints')
    .addTag('health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // ... rest of bootstrap
}
```

### Add decorators to controllers:

```typescript
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    schema: {
      example: {
        user: { id: 'uuid', email: 'user@x.com', role: 'USER' },
        accessToken: 'jwt...',
        refreshToken: 'jwt...',
      },
    },
  })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
```

---

## 1️⃣3️⃣ COMPREHENSIVE ERROR HANDLING FOR PRISMA

### Enhanced error filter: src/filters/all-exceptions.filter.ts

```typescript
import {
  Catch,
  HttpException,
  HttpStatus,
  ArgumentsHost,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

interface ErrorResponse {
  statusCode: number;
  message: string;
  timestamp: string;
  path: string;
  error?: string;
}

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'object'
          ? (exceptionResponse as any).message || exception.message
          : exception.message;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      statusCode = HttpStatus.BAD_REQUEST;
      message = 'Invalid input data';
      this.logger.error(`Prisma Validation: ${exception.message}`);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ statusCode, message, error } = this.handlePrismaError(exception));
    } else if (exception instanceof Error) {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      this.logger.error(exception.message, exception.stack);
    }

    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (error && process.env.NODE_ENV === 'development') {
      errorResponse.error = error;
    }

    response.status(statusCode).json(errorResponse);
  }

  private handlePrismaError(exception: Prisma.PrismaClientKnownRequestError) {
    const baseResponse = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database error occurred',
      error: exception.code,
    };

    const errorMap = {
      P2002: {
        statusCode: HttpStatus.CONFLICT,
        message: 'A record with this value already exists',
      },
      P2025: {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Record not found',
      },
      P2003: {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid reference to related record',
      },
      P2000: {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Input value is too long',
      },
      P2014: {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Required related record is missing',
      },
      P2011: {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Null constraint violation',
      },
    };

    this.logger.error(
      `Prisma Error ${exception.code}: ${exception.message}`,
    );

    return {
      ...baseResponse,
      ...(errorMap[exception.code] || baseResponse),
    };
  }
}
```

---

## Database Constraint Best Practices

Add to schema.prisma:

```prisma
model User {
  // ... fields ...
  
  // Constraints
  @@unique([email])  // Unique at DB level
  @@index([email])   // Index for queries
  @@index([createdAt])
  @@map("users")     // Map to table name for clarity
}
```

---

## Testing Checklist

After implementing each section:

- [ ] Test happy path (successful request)
- [ ] Test error paths (missing data, duplicates)
- [ ] Test rate limiting (send 6+ requests in 60s)
- [ ] Test auth guard (access without token)
- [ ] Test role guard (wrong role access)
- [ ] Test Prisma errors (unique constraint, not found)
- [ ] Test health checks (curl /health/ready, /health/live)
- [ ] Verify logs are written to file
- [ ] Verify no sensitive data in error responses

---

## Security Verification Checklist

```
✓ Rate limiting prevents brute force
✓ JWT tokens validated on protected routes
✓ Passwords not returned in responses
✓ Database errors don't leak schema
✓ Input validation and sanitization
✓ CORS restricted to allowed origins
✓ Helmet headers set correctly
✓ Health checks verify DB connectivity
✓ Logs captured with timestamps
✓ Roles enforced on admin endpoints
✓ No hardcoded secrets in code
✓ Environment variables validated at startup
```

After completing these implementations, your score should increase from **35/100 to 75+/100** ✅
