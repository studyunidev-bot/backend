import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { UsersService } from './users.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}

  async login(dto: LoginDto) {
    const email = String(dto.email ?? '').trim().toLowerCase();
    const password = String(dto.password ?? '').trim();

    if (!email || !password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = await this.usersService.findActiveUserByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValid = await this.usersService.verifyPassword(dto.password, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    };

    return {
      accessToken: this.tokenService.sign(payload),
      user: payload,
    };
  }
}