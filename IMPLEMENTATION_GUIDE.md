# Implementation Guide - Gap Fixes

## 1️⃣ RATE LIMITING (Throttler)

### Why Critical:
- Prevents brute force on `/register` (unlimited password attempts)
- Protects database from connection exhaustion
- Prevents DDoS attacks
- Required for any production API

### Installation:
Already in `package.json`: `@nestjs/throttler: ^6.4.0`

### File: src/throttler.config.ts

```typescript
import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const throttlerConfig: ThrottlerModuleOptions = [
  {
    name: 'default',
    ttl: 60000, // 60 seconds
    limit: 100, // 100 requests per minute (general limit)
  },
  {
    name: 'strict',
    ttl: 60000,
    limit: 5, // 5 requests per minute (for login/register)
  },
];
```

### Updates to app.module.ts:

```typescript
import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersService } from './users.service';
import { throttlerConfig } from './throttler.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot(throttlerConfig),
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    UsersService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
```

### Update main.ts to remove old config:
Just remove ConfigModule.forRoot() - it should now be in app.module.ts with global scope.

---

## 2️⃣ JWT AUTHENTICATION

### New Files Needed:

### File: src/auth/auth.service.ts

```typescript
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    // Check if user exists
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user);

    return {
      user,
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      ...tokens,
    };
  }

  async generateTokens(user: { id: string; email: string; role: string }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRATION', '24h'),
      secret: this.configService.get('JWT_SECRET'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
      secret: this.configService.get('JWT_REFRESH_SECRET', this.configService.get('JWT_SECRET')),
    });

    return { accessToken, refreshToken };
  }

  async validateToken(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET'),
      });
      return payload;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
```

### File: src/auth/jwt.strategy.ts

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
```

### File: src/auth/jwt.guard.ts

```typescript
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('No token provided');
    }
    return user;
  }
}
```

### File: src/auth/roles.guard.ts

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());

    if (!requiredRoles) {
      return true; // No role requirement
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Access denied - insufficient permissions');
    }

    return true;
  }
}
```

### File: src/auth/decorators/roles.decorator.ts

```typescript
import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

### File: src/auth/dto/login.dto.ts

```typescript
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
```

### File: src/auth/dto/register.dto.ts

```typescript
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
```

### File: src/auth/auth.module.ts

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRATION', '24h'),
        },
      }),
    }),
  ],
  controllers: [],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

### File: src/auth/auth.controller.ts

```typescript
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
```

### Update app.module.ts:

```typescript
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot(throttlerConfig),
    PrismaModule,
    AuthModule,  // Add this
  ],
  controllers: [AppController],
  providers: [AppService, UsersService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

---

## 3️⃣ PRISMA EXCEPTION HANDLING

### New File: src/filters/prisma-exception.filter.ts

```typescript
import { Catch, HttpException, HttpStatus, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

@Catch()
export class PrismaExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.handlePrismaError(exception, response);
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      this.handleValidationError(exception, response);
    } else {
      super.catch(exception, host);
    }
  }

  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
    response: any,
  ) {
    this.logger.error(`Prisma Error Code: ${exception.code}`, exception.message);

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An error occurred';

    switch (exception.code) {
      case 'P2002': // Unique constraint
        statusCode = HttpStatus.CONFLICT;
        message = 'A record with this value already exists';
        break;
      case 'P2025': // Record not found
        statusCode = HttpStatus.NOT_FOUND;
        message = 'Record not found';
        break;
      case 'P2003': // Foreign key constraint
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Invalid reference to related record';
        break;
      case 'P2000': // Value too long
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Input value is too long';
        break;
      case 'P2014': // Required relation
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Required related record is missing';
        break;
      default:
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Database error occurred';
    }

    response.status(statusCode).json({
      statusCode,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  private handleValidationError(
    exception: Prisma.PrismaClientValidationError,
    response: any,
  ) {
    this.logger.error('Prisma Validation Error', exception.message);

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Invalid data provided',
      timestamp: new Date().toISOString(),
    });
  }
}
```

### Update main.ts to use it:

```typescript
import { PrismaExceptionFilter } from './filters/prisma-exception.filter';

async function bootstrap() {
  // ... existing code ...
  
  app.useGlobalFilters(new HttpExceptionFilter(), new PrismaExceptionFilter());
  
  // ... rest of code ...
}
```

---

## 4️⃣ ENVIRONMENT VARIABLE VALIDATION

### New File: src/config/validate-env.ts

```typescript
import { plainToClass } from 'class-transformer';
import { IsString, IsNumber, IsEnum, validateSync, IsOptional, Min, Max } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_REFRESH_SECRET?: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRATION: string = '24h';

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  DB_POOL_MAX?: number = 20;

  @IsNumber()
  @IsOptional()
  DB_IDLE_TIMEOUT?: number = 30000;

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(
    EnvironmentVariables,
    config,
    { enableImplicitConversion: true },
  );

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.toString()}`);
  }

  return validatedConfig;
}
```

### Update app.module.ts:

```typescript
import { validate } from './config/validate-env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate, // Add validation
    }),
    // ... rest
  ],
})
export class AppModule {}
```

---

## 5️⃣ STRUCTURED LOGGING

### New File: src/common/logger/winston.config.ts

```typescript
import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';

export const winstonConfig = {
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        nestWinstonModuleUtilities.format.nestLike('App', {
          prettyPrint: true,
        }),
      ),
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/app.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),

    // Separate file for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
};
```

### Update main.ts:

```typescript
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { winstonConfig } from './common/logger/winston.config';

async function bootstrap() {
  const logger = WinstonModule.createLogger(winstonConfig);

  const app = await NestFactory.create(AppModule, {
    logger,
  });

  // ... rest of configuration
}
```

---

## 6️⃣ DATABASE SCHEMA IMPROVEMENTS

### Update schema.prisma:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

model User {
  id        String    @id @default(uuid())
  email     String    @unique
  password  String
  role      Role      @default(USER)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime? // Soft delete

  @@index([email])
  @@index([createdAt])
  @@index([deletedAt])
  @@map("users")
}

model AuditLog {
  id        String    @id @default(uuid())
  userId    String
  action    String    // 'LOGIN', 'CREATE', 'UPDATE', 'DELETE'
  resource  String    // Table name
  details   Json?     // Changed fields
  createdAt DateTime  @default(now())

  @@index([userId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

Run migration:
```bash
npx prisma migrate dev --name add_indexes_and_audit_logs
```

---

## .env.example Update

```env
# Environment
NODE_ENV=development

# Server
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/demo_app_db
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000

# JWT
JWT_SECRET=your-super-secret-change-this-in-production
JWT_REFRESH_SECRET=your-refresh-secret-change-this-in-production
JWT_EXPIRATION=24h

# CORS
CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# Logging
LOG_LEVEL=info
```

---

**Next: Review each file and apply them in order (1→2→3→4→5→6)**
