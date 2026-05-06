import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReferralsService } from '../referrals/referrals.service';

@Processor('referral-milestones')
export class ReferralMilestoneProcessor extends WorkerHost {
  private readonly logger = new Logger(ReferralMilestoneProcessor.name);

  constructor(private referralsService: ReferralsService) {
    super();
  }

  async process(job: Job<{ userId: string }>) {
    const { userId } = job.data;

    if (job.name === 'check-milestone-1') {
      this.logger.log({ event: 'checking_milestone_1', userId });
      await this.referralsService.checkAndCreditMilestone1(userId);
    } else if (job.name === 'check-milestone-2') {
      this.logger.log({ event: 'checking_milestone_2', userId });
      await this.referralsService.checkAndCreditMilestone2(userId);
    }
  }
}
