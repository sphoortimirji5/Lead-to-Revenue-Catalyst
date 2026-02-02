import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

import { AiService } from './../src/ai/ai.service';

describe('LeadsController (e2e)', () => {
  let app: INestApplication;

  const mockAiService = {
    analyzeLead: jest
      .fn()
      .mockResolvedValue({ fitScore: 80, intent: 'Test Intent' }),
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

    const response = await request(app.getHttpServer() as unknown as string)
      .post('/leads')
      .send(payload)
      .expect(201);

    const body = response.body as { id: number; email: string; status: string };
    expect(body).toHaveProperty('id');
    expect(body.email).toBe(payload.email);
    expect(body.status).toBe('PENDING');
  });

  it('/leads (POST) - Validation Error', async () => {
    const payload = {
      email: 'invalid-email',
      campaign_id: 'cmp_e2e',
    };

    await request(app.getHttpServer() as unknown as string)
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
    const res1 = await request(app.getHttpServer() as unknown as string)
      .post('/leads')
      .send(payload)
      .expect(201);

    // Second request (same payload)
    const res2 = await request(app.getHttpServer() as unknown as string)
      .post('/leads')
      .send(payload)
      .expect(201);

    const body1 = res1.body as { id: number };
    const body2 = res2.body as { id: number };
    expect(body1.id).toBe(body2.id);
  });
});
