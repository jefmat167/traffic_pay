import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { User } from '../users/entities/user.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Visit } from '../visits/entities/visit.entity';
import { Wallet } from '../wallet/entities/wallet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Campaign, Visit, Wallet])],
  providers: [PlatformService],
  controllers: [PlatformController],
})
export class PlatformModule {}
