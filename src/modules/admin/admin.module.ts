import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { User } from '../users/entities/user.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { Transaction } from '../wallet/entities/transaction.entity';
import { Visit } from '../visits/entities/visit.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Campaign, Withdrawal, Wallet, Transaction, Visit]),
    forwardRef(() => AuthModule),
  ],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
