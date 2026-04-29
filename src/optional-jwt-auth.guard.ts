import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { TokenService } from './token.service';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authorization = String(request.headers.authorization ?? '');

    if (!authorization) {
      return true;
    }

    if (authorization.startsWith('Bearer ')) {
      const token = authorization.slice('Bearer '.length).trim();
      request.user = this.tokenService.verify(token);
    }

    return true;
  }
}