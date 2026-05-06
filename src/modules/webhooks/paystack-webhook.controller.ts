import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaystackService } from '../shared/paystack/paystack.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class PaystackWebhookController {
  constructor(
    private paystackService: PaystackService,
    @InjectQueue('webhook-events') private webhookQueue: Queue,
  ) {}

  @Post('paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Paystack webhook receiver',
    description:
      'Receives webhook events from Paystack (charge.success, transfer.success, transfer.failed, transfer.reversed). ' +
      'Verifies HMAC SHA-512 signature using the raw request body. ' +
      'Events are queued for async processing via BullMQ. ' +
      'This endpoint should only be called by Paystack servers.',
  })
  @ApiHeader({
    name: 'x-paystack-signature',
    description: 'HMAC SHA-512 signature of the raw request body',
    required: true,
  })
  @ApiOkResponse({
    description: 'Webhook received and queued for processing',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            received: { type: 'boolean', example: true },
          },
        },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Invalid webhook signature' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    const isValid = this.paystackService.verifyWebhookSignature(
      req.rawBody!,
      signature,
    );
    if (!isValid) throw new ForbiddenException('Invalid webhook signature');

    const payload = JSON.parse(req.rawBody!.toString());
    await this.webhookQueue.add(`paystack-${payload.event}`, {
      event: payload.event,
      data: payload.data,
    });

    return { received: true };
  }
}
