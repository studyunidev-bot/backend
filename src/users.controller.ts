import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { Role } from './generated/prisma/client';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { UpdateManagedUserDto } from './dto/update-managed-user.dto';

type AuthenticatedRequest = Request & { user?: { sub: string; role: string } };

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async listUsers(@Req() req: AuthenticatedRequest) {
    return this.usersService.listUsers(
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }

  @Post()
  async createUser(@Body() body: CreateManagedUserDto, @Req() req: AuthenticatedRequest) {
    return this.usersService.createManagedUser(
      body,
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }

  @Patch(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() body: UpdateManagedUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.updateManagedUser(
      id,
      body,
      req.user
        ? {
            id: req.user.sub,
            role: req.user.role as Role,
          }
        : null,
    );
  }
}