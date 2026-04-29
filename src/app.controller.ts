import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AppService } from './app.service';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getRoot(): string {
    return this.appService.getHello();
  }

  @Get('/health')
  @HttpCode(HttpStatus.OK)
  async getHello() {
    return this.appService.getHealth();
  }

  @Get('/favicon.ico')
  @HttpCode(HttpStatus.NO_CONTENT)
  getFavicon(): void {}

  @Get('/register')
  @HttpCode(HttpStatus.OK)
  getRegisterInfo() {
    return {
      message: 'Use POST /register to create a user',
      contentType: 'application/json',
      example: {
        email: 'user@example.com',
        password: 'password123',
      },
    };
  }

  @Post('/register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalJwtAuthGuard)
  async register(
    @Body() createUserDto: CreateUserDto,
    @Req() req: Request & { user?: { sub: string; role: string } },
  ) {
    return this.usersService.register(
      createUserDto,
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as any,
          }
        : null,
    );
  }
}
