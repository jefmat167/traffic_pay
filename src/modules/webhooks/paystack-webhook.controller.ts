import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ApiTags,
  ApiOperation,
  ApiForbiddenResponse,
  ApiHeader,
  ApiResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaystackService } from '../shared/paystack/paystack.service';

interface PaystackWebhookEvent {
  event: string;
  data: {
    reference: string;
    amount: number;
    status: string;
    metadata?: Record<string, unknown>;
    transfer_code?: string;
    recipient?: {
      recipient_code: string;
    };
  };
}

@ApiTags('Webhooks')
@Controller('webhooks')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private paystackService: PaystackService,
    @InjectQueue('webhook-events') private webhookQueue: Queue,
  ) { }

  @Post('paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paystack webhook', description: 'Handles Paystack webhook events (charge.success, transfer.success, transfer.failed, transfer.reversed). Signature is verified using HMAC-SHA512.' })
  @ApiHeader({ name: 'x-paystack-signature', description: 'HMAC-SHA512 signature from Paystack', required: true })
  @ApiResponse({ status: 200, description: 'Webhook processed', schema: { example: { received: true } } })
  @ApiForbiddenResponse({ description: 'Invalid webhook signature' })
  async handleWebhook(
    @Body() body: PaystackWebhookEvent,
    @Headers('x-paystack-signature') signature: string,
  ) {
    const rawBody = JSON.stringify(body);
    if (!this.paystackService.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Invalid Paystack webhook signature');
      throw new UnauthorizedException('Invalid signature');
    }

    const { event, data } = body;
    this.logger.log(`Received Paystack webhook: ${event}`);

    await this.webhookQueue.add(`paystack-${event}`, { event, data });

    this.logger.log({ message: 'Webhook event queued', event });
    return { received: true };
  }
}
