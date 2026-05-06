import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class BlockGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return true; // public route
    if (user.isBlocked) {
      throw new ForbiddenException({
        code: 'ACCOUNT_BLOCKED',
        message: 'Your account has been blocked.',
      });
    }
    return true;
  }
}
