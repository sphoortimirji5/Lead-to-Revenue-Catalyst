import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { z } from 'zod';
import { Lead } from '../../leads/lead.entity';
import {
  AiProvider,
  AiAnalysisResult,
  LeadIntent,
  LeadDecision,
  GroundingSource,
} from '../interfaces/ai-provider.interface';
import { CompanyData } from '../../enrichment/enrichment.service';

const AiResponseSchema = z.object({
  fitScore: z.number().min(0).max(100),
  intent: z.nativeEnum(LeadIntent),
  decision: z.nativeEnum(LeadDecision),
  reasoning: z.string().min(10),
  evidence: z.array(
    z.object({
      source: z.nativeEnum(GroundingSource),
      field: z.string(),
      value: z.any(),
      claim_type: z.enum(['FIRMOGRAPHIC', 'BEHAVIOR', 'PIPELINE', 'SCORE']),
    }),
  ),
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
                
                GROUNDING CONTRACT - STRICT ENFORCEMENT:
                1. AI outputs are accepted ONLY if every non-trivial claim is backed by explicit evidence.
                2. FIRMOGRAPHIC claims (Industry, Size, Tech Stack) MUST cite source: "${GroundingSource.ENRICHMENT}".
                   - IF Enrichment data is NOT provided, you are FORBIDDEN from making firmographic claims.
                3. BEHAVIOR claims (Campaign, Usage) MUST cite source: "${GroundingSource.MARKETO}" or "${GroundingSource.PRODUCT}".
                4. PIPELINE/REVENUE claims MUST cite source: "${GroundingSource.SALESFORCE}" or "${GroundingSource.COMPUTED}".
                
                VALID INTENTS: ${Object.values(LeadIntent).join(', ')}
                VALID DECISIONS: ${Object.values(LeadDecision).join(', ')}

                OUTPUT FORMAT (JSON ONLY):
                {
                  "fitScore": number (0-100),
                  "intent": "Enum Value",
                  "decision": "Enum Value",
                  "reasoning": "Explanation referencing evidence",
                  "evidence": [
                    {
                      "source": "Enum Value",
                      "field": "Field Name (e.g., industry, campaign_id)",
                      "value": "Exact Value from Input",
                      "claim_type": "FIRMOGRAPHIC" | "BEHAVIOR" | "PIPELINE" | "SCORE"
                    }
                  ]
                }
            `,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });
  }

  async analyzeLead(
    leadData: Partial<Lead>,
    enrichmentData?: CompanyData | null,
  ): Promise<AiAnalysisResult> {
    try {
      const contextPayload = {
        lead: leadData,
        enrichment: enrichmentData || 'NOT_AVAILABLE',
      };

      const prompt = `Analyze this lead context: ${JSON.stringify(contextPayload)}`;
      const result = await this.model.generateContent(prompt);
      const responseText = result.response.text().trim();

      // Robust JSON extraction for production safety
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object found in response');

      return AiResponseSchema.parse(JSON.parse(jsonMatch[0]));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`AI_ANALYSIS_ERROR: ${errorMessage}`, {
        leadEmail: leadData.email,
      });
      throw error; // Service handles fallback
    }
  }
}
