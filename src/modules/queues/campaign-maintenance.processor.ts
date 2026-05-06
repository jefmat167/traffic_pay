import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visit } from '../visits/entities/visit.entity';
import { VisitStatus } from '../../common/enums';

@Injectable()
export class CampaignMaintenanceProcessor {
  private readonly logger = new Logger(CampaignMaintenanceProcessor.name);

  constructor(
    @InjectRepository(Visit) private visitRepo: Repository<Visit>,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async expireStaleVisits() {
    const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

    const result = await this.visitRepo
      .createQueryBuilder()
      .update()
      .set({ status: VisitStatus.ABANDONED })
      .where('status = :status AND "serverStartTime" < :threshold', {
        status: VisitStatus.IN_PROGRESS,
        threshold: staleThreshold,
      })
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.log({
        event: 'stale_visits_expired',
        count: result.affected,
      });
    }
  }
}
