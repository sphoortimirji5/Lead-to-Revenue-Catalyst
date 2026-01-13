import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { z } from 'zod';
import { Lead } from '../../leads/lead.entity';
import { AiProvider, AiAnalysisResult } from '../interfaces/ai-provider.interface';

const AiResponseSchema = z.object({
    fitScore: z.number().min(0).max(100),
    intent: z.string().min(1),
});

@Injectable()
export class GeminiProvider implements AiProvider {
    private readonly logger = new Logger(GeminiProvider.name);
    private model: GenerativeModel;

    constructor(private configService: ConfigService) {
        const genAI = new GoogleGenerativeAI(
            this.configService.get<string>('GEMINI_API_KEY') || '',
        );
        this.model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            systemInstruction: `
                PROTOTYPE NOTICE: This prompt is for initial validation. 
                Production environments MUST use the "Augmented Context Pipelines" 
                (RAG + Few-Shot) described in the README to ensure accuracy.

                You are a Staff-level B2B Sales Development Assistant. 
                Your goal is to identify high-value leads using "Executive Stealth" logic.
                
                LOGIC GUIDELINES:
                - Executive Stealth: A personal email (gmail/outlook) with a high-authority handle (e.g., "cto_pro", "vp_eng") should be scored HIGH (85-100) if correlated with a high-value campaign.
                - Technical Intent: Look for technical keywords in names or enrichment data.
                - Buying Power: Prioritize domains from Fortune 500 or high-growth startups.
                
                OUTPUT:
                Return ONLY a JSON object:
                {
                  "fitScore": number (0-100),
                  "intent": "string (max 5 words)"
                }
            `,
            generationConfig: {
                responseMimeType: "application/json",
            }
        });
    }

    async analyzeLead(leadData: Partial<Lead>): Promise<AiAnalysisResult> {
        try {
            const prompt = `Analyze this lead: ${JSON.stringify(leadData)}`;
            const result = await this.model.generateContent(prompt);
            const responseText = result.response.text().trim();

            // Robust JSON extraction for production safety
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON object found in response');

            return AiResponseSchema.parse(JSON.parse(jsonMatch[0]));
        } catch (error) {
            this.logger.error(`AI_ANALYSIS_ERROR: ${error.message}`, { leadEmail: leadData.email });
            return { fitScore: 50, intent: 'Manual Review Required' };
        }
    }
}
