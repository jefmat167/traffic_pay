import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

export interface InitializeTxnPayload {
  email: string;
  amount: number;
  reference?: string;
  callback_url?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly headers: Record<string, string>;

  constructor(private config: ConfigService) {
    this.headers = {
      Authorization: `Bearer ${this.config.get('paystackSecretKey')}`,
      'Content-Type': 'application/json',
    };
  }

  private async paystackRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json()) as any;
    if (!res.ok || !json.status) {
      this.logger.error({
        event: 'paystack_api_error',
        path,
        status: res.status,
        message: json.message,
      });
      throw new InternalServerErrorException(
        `Paystack error: ${json.message ?? res.statusText}`,
      );
    }
    return json.data as T;
  }

  async initializeTransaction(payload: InitializeTxnPayload) {
    return this.paystackRequest<{ authorization_url: string; reference: string }>(
      'POST',
      '/transaction/initialize',
      payload,
    );
  }

  async verifyTransaction(reference: string) {
    return this.paystackRequest<{
      status: string;
      amount: number;
      reference: string;
      channel: string;
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  async resolveAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ account_name: string; account_number: string }> {
    const params = new URLSearchParams({
      account_number: accountNumber,
      bank_code: bankCode,
    });
    try {
      return await this.paystackRequest('GET', `/bank/resolve?${params}`);
    } catch {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Could not verify bank account.',
      });
    }
  }

  async createTransferRecipient(
    bankCode: string,
    accountNumber: string,
    accountName: string,
  ): Promise<{ recipient_code: string }> {
    return this.paystackRequest('POST', '/transferrecipient', {
      type: 'nuban',
      bank_code: bankCode,
      account_number: accountNumber,
      name: accountName,
      currency: 'NGN',
    });
  }

  async initiateTransfer(
    amountKobo: number,
    recipientCode: string,
    reason: string,
  ): Promise<{ transfer_code: string; reference: string }> {
    return this.paystackRequest('POST', '/transfer', {
      source: 'balance',
      amount: amountKobo,
      recipient: recipientCode,
      reason,
    });
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    const hash = createHmac(
      'sha512',
      this.config.get('paystackWebhookSecret')!,
    )
      .update(rawBody)
      .digest('hex');
    return hash === signatureHeader;
  }
}
