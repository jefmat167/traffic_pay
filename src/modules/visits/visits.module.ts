import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Visit } from './entities/visit.entity';
import { VisitsService } from './visits.service';
import { VisitsController } from './visits.controller';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Visit]),
    BullModule.registerQueue({ name: 'referral-milestones' }),
    CampaignsModule,
    WalletModule,
  ],
  providers: [VisitsService],
  controllers: [VisitsController],
  exports: [VisitsService],
})
export class VisitsModule {}
