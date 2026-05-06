import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyDepositDto {
  @ApiProperty({
    description: 'Paystack transaction reference returned from initialization',
    example: 'TXN_abc123def456ghi789jk',
  })
  @IsString()
  @IsNotEmpty()
  transactionRef: string;
}
