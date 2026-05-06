import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Referral } from './entities/referral.entity';
import { Visit } from '../visits/entities/visit.entity';
import { VisitStatus } from '../../common/enums';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class ReferralsService {
  constructor(
    @InjectRepository(Referral)
    private referralRepo: Repository<Referral>,
    @InjectRepository(Visit)
    private visitRepo: Repository<Visit>,
    @Inject(forwardRef(() => WalletService))
    private walletService: WalletService,
  ) {}

  // ── Create referral record ──────────────────────────────────────────

  async createReferralRecord(
    referrerId: string,
    refereeId: string,
  ): Promise<Referral> {
    const referral = this.referralRepo.create({ referrerId, refereeId });
    return this.referralRepo.save(referral);
  }

  // ── Milestone 1: first deposit ──────────────────────────────────────

  async checkAndCreditMilestone1(refereeId: string): Promise<void> {
    const referral = await this.referralRepo.findOne({
      where: { refereeId },
    });

    if (!referral || referral.milestone1Credited) {
      return;
    }

    const bonusKobo = 375_000; // ₦3,750

    await this.walletService.creditReferralBonus(
      referral.referrerId,
      bonusKobo,
      'Referral bonus – milestone 1 (referee first deposit)',
    );

    referral.milestone1Credited = true;
    referral.milestone1CreditedAt = new Date();
    referral.totalEarned += bonusKobo;

    await this.referralRepo.save(referral);
  }

  // ── Milestone 2: referee completes 10 visits ────────────────────────

  async checkAndCreditMilestone2(refereeId: string): Promise<void> {
    const referral = await this.referralRepo.findOne({
      where: { refereeId },
    });

    if (!referral || referral.milestone2Credited) {
      return;
    }

    const completedVisits = await this.visitRepo.count({
      where: { userId: refereeId, status: VisitStatus.COMPLETED },
    });

    if (completedVisits < 10) {
      return;
    }

    const bonusKobo = 375_000; // ₦3,750

    await this.walletService.creditReferralBonus(
      referral.referrerId,
      bonusKobo,
      'Referral bonus – milestone 2 (referee completed 10 visits)',
    );

    referral.milestone2Credited = true;
    referral.milestone2CreditedAt = new Date();
    referral.totalEarned += bonusKobo;

    await this.referralRepo.save(referral);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  maskName(fullName: string): string {
    const first = fullName.split(' ')[0];
    return `${first.slice(0, 3)}***`;
  }

  // ── Referral stats for a user ───────────────────────────────────────

  async getReferralStats(userId: string) {
    const totalReferrals = await this.referralRepo.count({
      where: { referrerId: userId },
    });

    const referrals = await this.referralRepo.find({
      where: { referrerId: userId },
      relations: ['referee'],
      order: { createdAt: 'DESC' },
    });

    const referralList = referrals.map((r) => ({
      id: r.id,
      refereeName: r.referee
        ? this.maskName(r.referee.fullName)
        : 'Unknown',
      milestone1Credited: r.milestone1Credited,
      milestone1CreditedAt: r.milestone1CreditedAt,
      milestone2Credited: r.milestone2Credited,
      milestone2CreditedAt: r.milestone2CreditedAt,
      totalEarned: r.totalEarned,
      createdAt: r.createdAt,
    }));

    return {
      totalReferrals,
      referrals: referralList,
    };
  }
}
