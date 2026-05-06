import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_DEPOSIT_KEY } from '../decorators/requires-deposit.decorator';

@Injectable()
export class DepositGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresDeposit = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_DEPOSIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiresDeposit) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.isDeposited) {
      throw new ForbiddenException({
        code: 'DEPOSIT_REQUIRED',
        message: 'You must make a deposit before visiting campaigns.',
      });
    }
    return true;
  }
}
