import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from './token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(private readonly tokenService: TokenService) {}

	canActivate(context: ExecutionContext) {
		const request = context.switchToHttp().getRequest();
		const authorization = String(request.headers.authorization ?? '');

		if (!authorization.startsWith('Bearer ')) {
			throw new UnauthorizedException('Missing bearer token');
		}

		const token = authorization.slice('Bearer '.length).trim();
		request.user = this.tokenService.verify(token);
		return true;
	}
}