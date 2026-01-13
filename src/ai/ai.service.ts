import { Injectable, Inject } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import type { AiProvider, AiAnalysisResult } from './interfaces/ai-provider.interface';

@Injectable()
export class AiService {
    constructor(
        @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
    ) { }

    async analyzeLead(leadData: Partial<Lead>): Promise<AiAnalysisResult> {
        try {
            return await this.aiProvider.analyzeLead(leadData);
        } catch (error) {
            console.error('AI Analysis failed, using fallback:', error.message);
            return {
                fitScore: 50,
                intent: 'Manual Review Required',
            };
        }
    }
}
