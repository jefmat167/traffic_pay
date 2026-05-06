import { SetMetadata } from '@nestjs/common';

export const REQUIRES_DEPOSIT_KEY = 'requiresDeposit';
export const RequiresDeposit = () => SetMetadata(REQUIRES_DEPOSIT_KEY, true);
