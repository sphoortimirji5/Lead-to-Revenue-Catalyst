# Lead-to-Revenue Catalyst (RevenueFlow AI)

**Lead-to-Revenue Catalyst (RevenueFlow AI)** is a high-performance, event-driven microservice engineered to bridge the gap between marketing ingestion and sales conversion. By leveraging **Google Gemini AI** for real-time intent analysis and **BullMQ** for zero-loss durability, the system ensures that every marketing signal—from Marketo webhooks to direct API calls—is captured, enriched with "Buying Power" and "Technical Intent" scores, and seamlessly synced to your CRM. This architecture eliminates "Lead Decay" by providing sales teams with prioritized, high-context leads the moment they enter the funnel, all while maintaining a cost-effective, mock-first development environment.

## 1. Intent (The Strategy)

### The Core Problem
High-scale B2B organizations lose revenue due to **Lead Decay**. When high-volume leads enter a system, sales teams cannot distinguish between a student and a high-value buyer in real-time.

### The Mission
- **Zero-Loss Durability**: Ensure 100% of marketing signals are captured and processed, even during downstream API outages.
- **Real-Time Enrichment**: Use **Google Gemini AI** (gemini-2.0-flash) to categorize leads by "Buying Power" and "Technical Intent" instantly.
- **Resilient Integration**: Use a "Mock-First" architecture to develop and test complex CRM logic (Rate-limiting, Retries) locally.

## 2. Method (The Execution)

The system is built as an event-driven microservice using **NestJS** and **BullMQ**.

### Core Technical Pillars
- **Event-Driven Ingestion (Marketo/Webhook Ready)**: The system exposes a `POST /leads` endpoint designed to be the target for **Marketo Webhooks** or other marketing signals. Ingestion is decoupled from processing via **BullMQ**.
- **BullMQ Resilience**:
    - **Persistent Storage**: Jobs are stored in Redis, ensuring they survive application crashes.
    - **Exponential Backoff**: Failed jobs (e.g., due to AI API or CRM downtime) are retried with an exponential backoff strategy:
      $$delay = 2^{attempts} \times 1000ms$$
    - **Concurrency Control**: The worker is configured to process jobs at a controlled rate to avoid overwhelming downstream services.
    - **Idempotency**: Combined with database checks, BullMQ ensures that even if a job is retried, the system remains consistent.
- **Provider Pattern (Strategic Business Decision)**:
    - **Cost & Rate Limit Optimization**: In enterprise environments, third-party APIs (like Salesforce or Gemini) are expensive and subject to strict rate limits.
    - **Abstraction Layer**: The `CRMProvider` interface acts as a contract. The business logic only knows how to "push a lead"; the specific connection details (OAuth, API endpoints) are encapsulated in the provider implementation.
    - **Mock-First Development**: I designed this system with a Mock-First Provider Pattern so we can run a full regression suite of 10,000 leads locally without incurring costs or hitting rate limits, ensuring the system is bulletproof before we flip the switch to production.
- **AI Enrichment Worker**: A background worker consumes leads, calls the **Gemini AI API** for intent analysis, and attaches a "Fit Score" to the lead.

### Architecture
```mermaid
graph LR
    subgraph "Producer"
        M[Marketing Webhook Simulator]
    end

    subgraph "NestJS Middleware"
        C[Webhook Controller]
        Q[BullMQ / Redis]
        W[AI Enrichment Worker]
    end

    subgraph "CRM Providers"
        P{Provider Switcher}
        DB[(Postgres Mock CRM)]
        API[Real Salesforce API]
    end

    M --> C
    C --> Q
    Q --> W
    W --> P
    P -->|ENV=MOCK| DB
    P -.->|ENV=REAL| API
```

## 3. Getting Started

### Prerequisites
- Docker & Docker Compose
- Node.js (v18+)
- Google Gemini API Key

### Setup
1. **Clone the repository**
2. **Configure Environment Variables**:
   Create a `.env` file (see `.env.example` or use the following):
   ```env
   PORT=3000
   DATABASE_URL=postgresql://user:pass@localhost:5432/crm
   REDIS_HOST=localhost
   REDIS_PORT=6379
   CRM_PROVIDER=MOCK
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
3. **Start Infrastructure**:
   ```bash
   docker-compose up -d
   ```
4. **Install Dependencies**:
   ```bash
   npm install
   ```
5. **Run the Application**:
   ```bash
   npm run start:dev
   ```

### Testing the Flow
Send a sample lead via CURL:
```bash
curl -X POST http://localhost:3000/leads \
  -H "Content-Type: application/json" \
  -d '{
    "email": "high_value_lead@enterprise.com",
    "campaign_id": "global_launch_2024",
    "name": "Alex Smith"
  }'
```

**Sample Response**:
```json
{
  "id": 1,
  "email": "high_value_lead@enterprise.com",
  "name": "Alex Smith",
  "campaignId": "global_launch_2024",
  "idempotencyKey": "a1b2c3d4...",
  "status": "PENDING",
  "createdAt": "2026-01-11T03:12:22.171Z",
  "updatedAt": "2026-01-11T03:12:22.171Z"
}
```

## 4. Highlights
- **Idempotency**: Leads are keyed by `SHA-256(email + campaign_id)` to prevent duplicates.
- **Schema Safety**: Uses `class-validator` and `Zod` to ensure marketing payloads are strictly typed.
- **Graceful Shutdown**: Configured to finish processing active queue jobs before shutting down.
- **Observability (The "Staff" Edge)**:
    - **Queue Latency (TTL)**: I monitor the time between a webhook hitting the controller and the lead appearing in the CRM.
    - **Speed to Lead**: If latency exceeds 5 seconds, it triggers an alert, as "Speed to Lead" directly correlates with conversion rates.
    - **Structured Logging**: Detailed logs for AI inference results and CRM sync status for rapid debugging.

## 5. BullMQ Deep Dive

### Why BullMQ?
In a high-scale lead processing system, downstream APIs (like Gemini or Salesforce) can be slow or experience outages. BullMQ provides the durability layer needed to ensure no lead is ever lost.

### Queue Configuration
The `lead-processing` queue is configured with:
- **Attempts**: 5 retries per job.
- **Backoff**: Exponential strategy starting at 1 second.
- **Remove on Complete**: Jobs are kept for a short period for auditing before being removed.

> [!NOTE]
> **Redis Technical Requirement**: BullMQ relies heavily on **Lua scripts** for atomic operations. The `redis:alpine` image used in this stack provides full Lua support, ensuring 100% compatibility with BullMQ's concurrency and durability requirements.

### Monitoring
While not included in this local setup, BullMQ can be easily monitored using tools like **BullBoard** to visualize job status (Active, Waiting, Completed, Failed).

## 6. Production Readiness: Component Migration

When moving from this local "Mock-First" environment to a production-grade system, the following components are designed to be swapped:

| Component | Development / Mock | Production Replacement |
| :--- | :--- | :--- |
| **CRM Integration** | `MockCrmService` (Postgres) | `SalesforceService` / `HubSpotService` (Real APIs) |
| **AI Model** | `gemini-2.0-flash` | **AWS Bedrock: Claude 4.5 Sonnet** |
| **Database** | Local Docker PostgreSQL | Managed RDS (e.g., AWS RDS PostgreSQL) |
| **Message Broker** | Local Docker Redis | Managed Redis (e.g., AWS ElastiCache) |
| **Secrets** | `.env` file | AWS Secrets Manager / HashiCorp Vault |
| **Ingestion** | NestJS Controller | API Gateway + Load Balancer |
| **Observability** | Console Logs | Datadog / CloudWatch / ELK Stack |

### Migration Strategy
The **Provider Pattern** implemented in the `CrmModule` allows for a seamless transition. By simply changing the `CRM_PROVIDER` environment variable and providing the necessary API keys, the system will automatically switch from the Mock CRM to the Real CRM without any code changes in the business logic.

### Why Claude 4.5 Sonnet for Production?
For the production environment hosted on **AWS**, we have selected **Claude 4.5 Sonnet via AWS Bedrock** as the primary inference engine for the following strategic reasons:
1. **Superior Reasoning**: Claude's Sonnet series provides the high-nuance understanding required to accurately distinguish between "Technical Intent" and generic inquiries in B2B leads.
2. **Speed-to-Lead Optimization**: It offers a near-perfect balance of high intelligence and low latency, ensuring our 5-second "Speed to Lead" SLA is consistently met.
3. **Enterprise Security & Compliance**: By using AWS Bedrock, lead data remains within our AWS VPC boundary, adhering to strict data residency and privacy requirements.
4. **Seamless AWS Integration**: Native integration with AWS IAM for secure, keyless authentication and simplified observability via CloudWatch.
