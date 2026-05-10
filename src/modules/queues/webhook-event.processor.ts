import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WalletService } from '../wallet/wallet.service';

@Processor('webhook-events')
export class WebhookEventProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookEventProcessor.name);

  constructor(private walletService: WalletService) {
    super();
  }

  async process(job: Job<{ event: string; data: any }>) {
    const { event, data } = job.data;
    this.logger.log({
      message: 'Processing webhook job',
      jobId: job.id,
      event,
      reference: data?.reference,
    });

    try {
      await this.walletService.handlePaystackWebhook(event, data);
      this.logger.log({
        message: 'Webhook job completed',
        jobId: job.id,
        event,
      });
    } catch (error) {
      this.logger.error({
        message: 'Webhook job failed',
        jobId: job.id,
        event,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}
