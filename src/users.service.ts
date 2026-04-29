import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback } from 'crypto';
import { promisify } from 'util';
import { PrismaService } from './prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { Role, User } from './generated/prisma/client';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { UpdateManagedUserDto } from './dto/update-managed-user.dto';

const scrypt = promisify(scryptCallback);

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async register(dto: CreateUserDto, actor?: Pick<User, 'id' | 'role'> | null) {
    this.validateCreateUserDto(dto);

    const userCount = await this.prisma.user.count({ where: { deletedAt: null } });

    if (userCount > 0 && !this.canManageUsers(actor)) {
      throw new ForbiddenException('Authenticated ADMIN or SUPERADMIN is required to create additional users');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already exists');

    const hashedPassword = await this.hashPassword(dto.password);

    const role = userCount === 0 ? Role.SUPERADMIN : Role.STAFF;

    return this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        fullName: dto.fullName?.trim() || undefined,
        role,
      },
      select: { id: true, email: true, fullName: true, role: true },
    });
  }

  async findActiveUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: {
        email: email.trim().toLowerCase(),
        isActive: true,
        deletedAt: null,
      },
    });
  }

  async listUsers(actor?: Pick<User, 'id' | 'role'> | null) {
    this.assertCanManageUsers(actor);

    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createManagedUser(dto: CreateManagedUserDto, actor?: Pick<User, 'id' | 'role'> | null) {
    this.assertCanManageUsers(actor);
    this.validateCreateUserDto(dto);

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await this.hashPassword(dto.password);
    const role = this.normalizeRole(dto.role);

    return this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        fullName: dto.fullName?.trim() || undefined,
        role,
        isActive: dto.isActive ?? true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async updateManagedUser(userId: string, dto: UpdateManagedUserDto, actor?: Pick<User, 'id' | 'role'> | null) {
    this.assertCanManageUsers(actor);

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.deletedAt) {
      throw new BadRequestException('User not found');
    }

    if (actor?.id === userId && (dto.isActive === false || dto.role)) {
      throw new ForbiddenException('You cannot deactivate or change your own role');
    }

    const email = dto.email?.trim().toLowerCase();
    if (email && email !== target.email) {
      const duplicate = await this.prisma.user.findUnique({ where: { email } });
      if (duplicate && duplicate.id !== userId) {
        throw new ConflictException('Email already exists');
      }
    }

    if (dto.password) {
      this.validateCreateUserDto({
        email: email ?? target.email,
        password: dto.password,
        fullName: dto.fullName ?? target.fullName ?? undefined,
      });
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        email: email || undefined,
        fullName: dto.fullName?.trim() || (dto.fullName === '' ? null : undefined),
        role: dto.role ? this.normalizeRole(dto.role) : undefined,
        isActive: typeof dto.isActive === 'boolean' ? dto.isActive : undefined,
        password: dto.password ? await this.hashPassword(dto.password.trim()) : undefined,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });
  }

  async verifyPassword(password: string, storedHash: string) {
    const [salt, originalHash] = storedHash.split(':');

    if (!salt || !originalHash) {
      return false;
    }

    const computedHash = (await scrypt(password, salt, 64)) as Buffer;
    return computedHash.toString('hex') === originalHash;
  }

  private validateCreateUserDto(dto: CreateUserDto) {
    const email = dto.email?.trim().toLowerCase();
    const password = dto.password?.trim();

    if (!email) {
      throw new BadRequestException('Email is required');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Invalid email address');
    }

    if (!password) {
      throw new BadRequestException('Password is required');
    }

    if (password.length < 8 || password.length > 128) {
      throw new BadRequestException('Password must be between 8 and 128 characters');
    }

    dto.email = email;
    dto.password = password;
    dto.fullName = dto.fullName?.trim() || undefined;
  }

  private canManageUsers(actor?: Pick<User, 'id' | 'role'> | null) {
    return actor?.role === Role.ADMIN || actor?.role === Role.SUPERADMIN;
  }

  private assertCanManageUsers(actor?: Pick<User, 'id' | 'role'> | null) {
    if (!this.canManageUsers(actor)) {
      throw new ForbiddenException('Authenticated ADMIN or SUPERADMIN is required');
    }
  }

  private normalizeRole(role?: string) {
    const normalized = String(role ?? Role.STAFF).toUpperCase();

    if (!Object.values(Role).includes(normalized as Role)) {
      throw new BadRequestException('Invalid role');
    }

    return normalized as Role;
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${hash.toString('hex')}`;
  }
}