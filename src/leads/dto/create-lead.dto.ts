import { IsEmail, IsString, IsOptional } from 'class-validator';

export class CreateLeadDto {
  @IsEmail()
  email: string;

  @IsString()
  campaign_id: string;

  @IsString()
  @IsOptional()
  name?: string;
}
