import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Lead } from './../src/leads/lead.entity';

import { AiService } from './../src/ai/ai.service';

describe('LeadsController (e2e)', () => {
    let app: INestApplication;
    let leadRepository;

    const mockAiService = {
        analyzeLead: jest.fn().mockResolvedValue({ fitScore: 80, intent: 'Test Intent' }),
    };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(AiService)
            .useValue(mockAiService)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe());
        await app.init();

        leadRepository = moduleFixture.get(getRepositoryToken(Lead));
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    it('/leads (POST) - Success', async () => {
        const payload = {
            email: `test-${Date.now()}@example.com`,
            campaign_id: 'cmp_e2e',
            name: 'E2E User',
        };

        const response = await request(app.getHttpServer())
            .post('/leads')
            .send(payload)
            .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.email).toBe(payload.email);
        expect(response.body.status).toBe('PENDING');
    });

    it('/leads (POST) - Validation Error', async () => {
        const payload = {
            email: 'invalid-email',
            campaign_id: 'cmp_e2e',
        };

        await request(app.getHttpServer())
            .post('/leads')
            .send(payload)
            .expect(400);
    });

    it('/leads (POST) - Idempotency', async () => {
        const payload = {
            email: `idempotent-${Date.now()}@example.com`,
            campaign_id: 'cmp_idempotent',
        };

        // First request
        const res1 = await request(app.getHttpServer())
            .post('/leads')
            .send(payload)
            .expect(201);

        // Second request (same payload)
        const res2 = await request(app.getHttpServer())
            .post('/leads')
            .send(payload)
            .expect(201);

        expect(res1.body.id).toBe(res2.body.id);
    });
});
