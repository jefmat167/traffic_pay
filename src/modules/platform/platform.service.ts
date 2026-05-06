import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { Visit } from '../visits/entities/visit.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { CampaignStatus, VisitStatus } from '../../common/enums';

@Injectable()
export class PlatformService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Campaign) private campaignRepo: Repository<Campaign>,
    @InjectRepository(Visit) private visitRepo: Repository<Visit>,
    @InjectRepository(Wallet) private walletRepo: Repository<Wallet>,
  ) {}

  async getStats() {
    const [totalUsers, activeCampaigns, completedVisits, totalPaidOut] =
      await Promise.all([
        this.userRepo.count(),
        this.campaignRepo.count({ where: { status: CampaignStatus.ACTIVE } }),
        this.visitRepo.count({ where: { status: VisitStatus.COMPLETED } }),
        this.walletRepo
          .createQueryBuilder('w')
          .select('COALESCE(SUM(w.totalEarned), 0)', 'total')
          .getRawOne()
          .then((r) => Number(r.total)),
      ]);

    return { totalUsers, activeCampaigns, completedVisits, totalPaidOut };
  }

  getConfig() {
    return {
      pricingTiers: {
        ECONOMY: { payPerVisit: 5000, label: 'Economy' },
        STANDARD: { payPerVisit: 10000, label: 'Standard' },
        PREMIUM: { payPerVisit: 20000, label: 'Premium' },
      },
      minDeposit: 1500000,
      minWithdrawal: 500000,
      durations: [30, 60, 120, 180, 300],
      referralBonusPerMilestone: 375000,
    };
  }
}
