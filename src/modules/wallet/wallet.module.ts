import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { BankAccount } from './entities/bank-account.entity';
import { Withdrawal } from './entities/withdrawal.entity';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { UsersModule } from '../users/users.module';
import { PaystackModule } from '../shared/paystack/paystack.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Transaction, BankAccount, Withdrawal]),
    BullModule.registerQueue(
      { name: 'withdrawal-processing' },
      { name: 'referral-milestones' },
    ),
    forwardRef(() => UsersModule),
    PaystackModule,
  ],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
