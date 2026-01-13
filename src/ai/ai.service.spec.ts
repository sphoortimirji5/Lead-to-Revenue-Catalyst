import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';

describe('AiService', () => {
    let service: AiService;
    let mockAiProvider: any;

    beforeEach(async () => {
        mockAiProvider = {
            analyzeLead: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiService,
                {
                    provide: AI_PROVIDER,
                    useValue: mockAiProvider,
                },
            ],
        }).compile();

        service = module.get<AiService>(AiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('analyzeLead', () => {
        it('should return fitScore and intent from AI provider', async () => {
            const mockResponse = { fitScore: 85, intent: 'High Interest' };
            mockAiProvider.analyzeLead.mockResolvedValue(mockResponse);

            const result = await service.analyzeLead({ email: 'test@test.com' });

            expect(result).toEqual(mockResponse);
            expect(mockAiProvider.analyzeLead).toHaveBeenCalledWith({ email: 'test@test.com' });
        });

        it('should return fallback values if AI provider fails', async () => {
            mockAiProvider.analyzeLead.mockRejectedValue(new Error('AI Provider Error'));

            const result = await service.analyzeLead({ email: 'test@test.com' });

            expect(result).toEqual({
                fitScore: 50,
                intent: 'Manual Review Required',
            });
        });
    });
});
