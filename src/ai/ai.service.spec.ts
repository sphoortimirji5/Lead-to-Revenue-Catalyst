import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { GoogleGenerativeAI } from '@google/generative-ai';

jest.mock('@google/generative-ai');

describe('AiService', () => {
    let service: AiService;
    let configService: ConfigService;

    const mockConfigService = {
        get: jest.fn().mockReturnValue('fake-api-key'),
    };

    const mockGenerateContent = jest.fn();
    const mockGetGenerativeModel = jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
    });

    beforeEach(async () => {
        (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
            getGenerativeModel: mockGetGenerativeModel,
        }));

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiService,
                {
                    provide: ConfigService,
                    useValue: mockConfigService,
                },
            ],
        }).compile();

        service = module.get<AiService>(AiService);
        configService = module.get<ConfigService>(ConfigService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('analyzeLead', () => {
        it('should return fitScore and intent from AI response', async () => {
            const mockResponse = {
                response: {
                    text: () => JSON.stringify({ fitScore: 85, intent: 'High Interest' }),
                },
            };
            mockGenerateContent.mockResolvedValue(mockResponse);

            const result = await service.analyzeLead({ email: 'test@test.com' });

            expect(result).toEqual({ fitScore: 85, intent: 'High Interest' });
            expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-1.5-flash' });
        });

        it('should return fallback values if AI fails', async () => {
            mockGenerateContent.mockRejectedValue(new Error('AI Error'));

            const result = await service.analyzeLead({ email: 'test@test.com' });

            expect(result).toEqual({
                fitScore: 50,
                intent: 'Manual Review Required',
            });
        });
    });
});
