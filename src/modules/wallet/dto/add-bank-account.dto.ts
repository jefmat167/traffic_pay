import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddBankAccountDto {
  @ApiProperty({
    description: 'Bank code (Paystack bank code)',
    example: '058',
  })
  @IsString()
  @IsNotEmpty()
  bankCode: string;

  @ApiProperty({
    description: 'NUBAN account number (exactly 10 digits)',
    example: '0123456789',
    minLength: 10,
    maxLength: 10,
  })
  @IsString()
  @Length(10, 10)
  accountNumber: string;

  @ApiProperty({
    description: 'Account holder name',
    example: 'Chidera Okoro',
  })
  @IsString()
  @IsNotEmpty()
  accountName: string;
}
