import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class AiService {
    private genAI: GoogleGenerativeAI;

    constructor(private configService: ConfigService) {
        this.genAI = new GoogleGenerativeAI(
            this.configService.get<string>('GEMINI_API_KEY') || '',
        );
    }

    async analyzeLead(leadData: any): Promise<{ fitScore: number; intent: string }> {
        try {
            const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            const prompt = `
        You are a sales assistant. Analyze the lead and return a JSON with "fitScore" (0-100) and "intent" (short string).
        Lead Data: ${JSON.stringify(leadData)}
        Return only the JSON object.
      `;

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();

            // Clean up response text in case it contains markdown blocks
            const jsonMatch = responseText.match(/\{.*\}/s);
            const jsonString = jsonMatch ? jsonMatch[0] : responseText;

            const response = JSON.parse(jsonString);

            return {
                fitScore: response.fitScore || 0,
                intent: response.intent || 'Unknown',
            };
        } catch (error) {
            console.error('AI Analysis failed, using fallback:', error);
            return {
                fitScore: 50,
                intent: 'Manual Review Required',
            };
        }
    }
}
