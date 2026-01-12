import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MockCrmService } from './crm.service';
import { SalesforceService } from './salesforce.service';
import { Lead } from '../leads/lead.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), ConfigModule],
  providers: [
    MockCrmService,
    SalesforceService,
    {
      provide: 'CRM_PROVIDER',
      useFactory: (configService: ConfigService, mock: MockCrmService, real: SalesforceService) => {
        const provider = configService.get<string>('CRM_PROVIDER');
        return provider === 'REAL' ? real : mock;
      },
      inject: [ConfigService, MockCrmService, SalesforceService],
    },
  ],
  exports: ['CRM_PROVIDER'],
})
export class CrmModule { }
