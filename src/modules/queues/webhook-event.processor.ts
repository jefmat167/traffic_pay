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
    this.logger.log({ event: 'processing_webhook', paystackEvent: event });

    await this.walletService.handlePaystackWebhook(event, data);
  }
}
