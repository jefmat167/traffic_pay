import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { WithdrawalProcessor } from './withdrawal.processor';
import { WebhookEventProcessor } from './webhook-event.processor';
import { ReferralMilestoneProcessor } from './referral-milestone.processor';
import { CampaignMaintenanceProcessor } from './campaign-maintenance.processor';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';
import { Visit } from '../visits/entities/visit.entity';
import { PaystackModule } from '../shared/paystack/paystack.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Withdrawal, Visit]),
    BullModule.registerQueue(
      { name: 'withdrawal-processing' },
      { name: 'webhook-events' },
      { name: 'referral-milestones' },
    ),
    PaystackModule,
    WalletModule,
    ReferralsModule,
  ],
  providers: [
    WithdrawalProcessor,
    WebhookEventProcessor,
    ReferralMilestoneProcessor,
    CampaignMaintenanceProcessor,
  ],
})
export class QueuesModule {}
