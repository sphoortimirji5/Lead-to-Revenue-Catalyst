import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { LeadsService } from './leads.service';
import { Lead } from './lead.entity';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';

describe('LeadsService', () => {
    let service: LeadsService;
    let repository: Repository<Lead>;
    let queue: Queue;

    const mockLeadRepository = {
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
    };

    const mockLeadQueue = {
        add: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                LeadsService,
                {
                    provide: getRepositoryToken(Lead),
                    useValue: mockLeadRepository,
                },
                {
                    provide: getQueueToken('lead-processing'),
                    useValue: mockLeadQueue,
                },
            ],
        }).compile();

        service = module.get<LeadsService>(LeadsService);
        repository = module.get<Repository<Lead>>(getRepositoryToken(Lead));
        queue = module.get<Queue>(getQueueToken('lead-processing'));
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        const createLeadDto = {
            email: 'test@example.com',
            campaign_id: 'cmp_123',
            name: 'Test User',
        };

        it('should return existing lead if idempotency key matches', async () => {
            const existingLead = { id: 1, ...createLeadDto };
            mockLeadRepository.findOne.mockResolvedValue(existingLead);

            const result = await service.create(createLeadDto);

            expect(result).toEqual(existingLead);
            expect(mockLeadRepository.findOne).toHaveBeenCalled();
            expect(mockLeadRepository.save).not.toHaveBeenCalled();
        });

        it('should create and save a new lead and add to queue', async () => {
            mockLeadRepository.findOne.mockResolvedValue(null);
            mockLeadRepository.create.mockReturnValue(createLeadDto);
            mockLeadRepository.save.mockResolvedValue({ id: 2, ...createLeadDto });

            const result = await service.create(createLeadDto);

            expect(result.id).toBe(2);
            expect(mockLeadRepository.save).toHaveBeenCalled();
            expect(queue.add).toHaveBeenCalledWith(
                'process-lead',
                { leadId: 2 },
                expect.any(Object),
            );
        });
    });
});
