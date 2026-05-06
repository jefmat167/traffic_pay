import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaystackWebhookController } from './paystack-webhook.controller';
import { PaystackModule } from '../shared/paystack/paystack.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'webhook-events' }),
    PaystackModule,
  ],
  controllers: [PaystackWebhookController],
})
export class WebhooksModule {}
