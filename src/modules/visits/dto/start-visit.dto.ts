import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartVisitDto {
  @ApiProperty({
    description: 'UUID of the campaign to visit',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  @IsUUID()
  campaignId: string;
}
