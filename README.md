# Lead-to-Revenue Catalyst (RevenueFlow AI)

**Lead-to-Revenue Catalyst (RevenueFlow AI)** is a high-performance, event-driven microservice engineered to automate the transition from Marketo marketing ingestion to Salesforce sales conversion.

The system intercepts high-volume Marketo webhooks, uses AI to analyze "Executive Stealth" intent, and enriches Salesforce records with prioritized "Buying Power" scores. By decoupling ingestion from processing via BullMQ, MarSales AI-Link eliminates "Lead Decay" and protects Salesforce from API rate-limit exhaustion during peak marketing campaigns.

## 1. Intent (The Strategy)

### The Core Problem
High-scale B2B organizations lose revenue due to **Lead Decay**. When high-volume leads enter a system, sales teams cannot distinguish between a student and a high-value buyer in real-time.

### The Mission
- **Zero-Loss Durability**: Ensure 100% of marketing signals are captured and processed, even during downstream API outages.
- **Real-Time Enrichment**: Use **Google Gemini AI** (gemini-2.0-flash) to categorize leads by "Buying Power" and "Technical Intent" instantly.
- **Resilient Integration**: Use a "Mock-First" architecture to develop and test complex CRM logic (Rate-limiting, Retries) locally.

## 2. Method (The Execution)

The system is built as an event-driven microservice using **NestJS** and **BullMQ**, designed to handle the "bursty" nature of Marketo traffic while ensuring a stable, intelligent sync to Salesforce.

### Core Technical Pillars

- **Event-Driven Ingestion (Marketo-Ready)**: The system exposes a hardened `POST /leads` endpoint. Ingestion is immediately decoupled from processing via BullMQ, allowing the system to acknowledge Marketo webhooks in < 200ms and process the heavy AI logic asynchronously.
- **BullMQ Resilience**:
    - **Persistent Storage**: Jobs are stored in Redis, ensuring leads survive application crashes or restarts.
    - **Exponential Backoff**: Failed jobs (e.g., due to downstream API downtime) are retried automatically:
      $$delay = 2^{attempts} \times 1000ms$$
    - **Concurrency Control**: The worker is configured to process jobs at a controlled rate, preventing the system from exhausting Salesforce API limits or AI rate quotas.
    - **Idempotency**: Combined with database checks, the system ensures that retried jobs do not create duplicate records in Salesforce.
- **Environment-Aware Provider Pattern**:
    The `CRMProvider` and `AIProvider` interfaces act as strict contracts. This abstraction allows the business logic to remain identical while the underlying infrastructure swaps based on the environment:
    - **Local (Validation Mode)**: Uses a PostgreSQL Mock CRM and Google Gemini 2.0 Flash. This allows for high-volume regression testing (10,000+ leads) to validate mapping and "Executive Stealth" logic locally without incurring costs or hitting production rate limits.
    - **Production (Hardened Mode)**: Uses the Salesforce Live API (via OAuth JWT) and AWS Bedrock (Claude 4.5 Sonnet). This ensures enterprise-grade reasoning and data residency within an AWS VPC.
- **AI Enrichment Worker**: A dedicated background consumer that orchestrates the "Intent Analysis." It extracts buying signals from raw Marketo data, calculates the "Fit Score," and prepares the enriched payload for the CRM provider.

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
- **Deterministic Idempotency**: Leads are keyed by a deterministic SHA-256 hash of the unique `(email, campaign_id)` tuple. This ensures that even if a marketing provider sends multiple webhooks for the same lead event, the system performs an atomic "Upsert" (Insert or Do Nothing), preserving the p99 "Speed to Lead" without wasting AI inference tokens.
- **Schema Safety**: Uses `class-validator` and `Zod` to ensure marketing payloads are strictly typed.
- **Graceful Shutdown**: Configured to finish processing active queue jobs before shutting down.
- **Observability-**:
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

## 6. AI Guardrails & Governance
To ensure the LLM (Gemini/Claude) remains a reliable component of the revenue pipeline, I have implemented the following guardrails:

### Technical Guardrails
- **Strict Schema Enforcement**: I use **Zod** to validate every AI response. If the AI returns malformed JSON or missing fields, the system rejects the output and triggers a fallback.
- **Deterministic Fallbacks**: In the event of an AI "hallucination" or API timeout, the system defaults to a `fitScore: 50` and `intent: "Manual Review Required"`, ensuring the lead is never lost.
- **Output Sanitization**: The `AiService` includes logic to strip markdown code blocks (e.g., ```json ... ```) that LLMs often include, preventing parsing errors.
- **Prompt Constraints**: The system prompt is engineered to be "JSON-only," explicitly forbidding the AI from adding conversational filler.

### Data Governance
- **PII Minimization**: Only essential lead data (name, email, campaign) is sent to the LLM. Sensitive internal identifiers are never exposed to the external AI provider.
- **Audit Trails**: Every AI inference result is stored in the PostgreSQL database, allowing for periodic audits of AI accuracy and bias.

## 7. The Fit Score: Strategic Lead Prioritization
The `fitScore` (0-100) is the primary metric I use to automate the "Speed to Lead" pipeline. It is not just a random number; it is a weighted assessment of a lead's potential value.

### How to Depend on the Fit Score
I recommend using the following thresholds to drive automated business logic:

| Score Range | Strategic Action | Business Impact |
| :--- | :--- | :--- |
| **85 - 100** | **Instant Routing** | High-value buyers. Route directly to an Account Executive (AE) via Slack/Phone. |
| **60 - 84** | **BDR Outreach** | Solid prospects. Route to Business Development Reps for manual qualification. |
| **40 - 59** | **Nurture Track** | Low immediate intent. Add to an automated email marketing sequence. |
| **0 - 39** | **Auto-Disqualify** | Students, competitors, or invalid data. Archive to keep the CRM clean. |

### Why this is Reliable
1. **Contextual Intelligence**: Unlike simple rule-based scoring (e.g., "if email contains .edu"), the AI analyzes the *combination* of name, email domain, and campaign context.

**Examples of AI-Driven Nuance:**
| Scenario | Rule-Based Result | AI-Driven Fit Score | Rationale |
| :--- | :--- | :--- | :--- |
| **Personal Email** (`cto_pro@gmail.com`) | **Disqualified** (Non-work email) | **95 (High Fit)** | AI identifies the **"Executive Stealth"** pattern: High-authority handle ("CTO") correlated with a "Fortune 500" campaign. |
| **Academic Domain** (`researcher@mit.edu`) | **Disqualified** (.edu filter) | **75 (Solid Fit)** | AI identifies the lead as a potential buyer for "Enterprise SaaS" rather than a student. |
| **Generic Role** (`info@startup.io`) | **Low Score** (Generic alias) | **80 (Solid Fit)** | AI recognizes the high-growth potential of the domain and the "Series B Funding" campaign context. |
| **High-Value Name** (`j.bezos@amazon.com`) | **Medium Score** (Standard rule) | **100 (Instant Route)** | AI recognizes the high-authority individual and prioritizes immediate AE outreach. |

2. **Consistency**: By using a high-precision model like Claude 4.5 Sonnet, I ensure that the scoring logic remains consistent across thousands of leads, eliminating human bias in early-stage qualification.
3. **Dynamic Adjustment**: As my business evolves, I can simply update the system prompt to change the "definition of a good lead" without rewriting any core ingestion code.

## 8. Production Readiness: Component Migration

When moving from this local "Mock-First" environment to a production-grade system, the following components are designed to be swapped:

| Component | Development / Mock | Production Replacement | Reason for Swap |
| :--- | :--- | :--- | :--- |
| **CRM Integration** | `MockCrmService` (Postgres) | `SalesforceService` / `HubSpotService` (Real APIs) | Production data sync to system of record. |
| **AI Model** | `gemini-2.0-flash` | **AWS Bedrock: Claude 4.5 Sonnet** | Superior reasoning & enterprise security. |
| **Database** | Local Docker PostgreSQL | Managed RDS (e.g., AWS RDS PostgreSQL) | Automated backups, patching, and scaling. |
| **Message Broker** | Local Docker Redis | Managed Redis (e.g., AWS ElastiCache) | High Availability & Multi-AZ Failover. |
| **Secrets** | `.env` file | AWS Secrets Manager / HashiCorp Vault | Rotation of Secrets and keys & IAM-based access. |
| **Ingestion** | NestJS Controller | API Gateway + Load Balancer | Global scale, DDoS protection, and throttling. |
| **Observability** | Console Logs | Datadog / CloudWatch / ELK Stack | Centralized log aggregation and alerting. |

The production environment is architected for **Terraform-based deployment**, allowing the Managed RDS and ElastiCache instances to be provisioned with the same security groups and network policies as the ECS Fargate workers, ensuring a **zero-trust network environment**.

### Migration Strategy
The **Provider Pattern** implemented in the `CrmModule` allows for a seamless transition. By simply changing the `CRM_PROVIDER` environment variable and providing the necessary API keys, the system will automatically switch from the Mock CRM to the Real CRM without any code changes in the business logic.

### Why Claude 4.5 Sonnet for Production?
For the production environment hosted on **AWS**, I have selected **Claude 4.5 Sonnet via AWS Bedrock** as the primary inference engine for the following strategic reasons:
1. **Superior Reasoning**: Claude's Sonnet series provides the high-nuance understanding required to accurately distinguish between "Technical Intent" and generic inquiries in B2B leads.
2. **Speed-to-Lead Optimization**: It offers a near-perfect balance of high intelligence and low latency, ensuring my 5-second "Speed to Lead" SLA is consistently met.
3. **Enterprise Security & Compliance**: By using AWS Bedrock, lead data remains within my AWS VPC boundary, adhering to strict data residency and privacy requirements.
4. **Seamless AWS Integration**: Native integration with AWS IAM for secure, keyless authentication and simplified observability via CloudWatch.

### Production Readiness Checklist
Before deploying to a production environment (AWS), the following enhancements are recommended to meet enterprise standards:

#### 1. Security & Access Control
- [ ] **API Authentication**: Implement API Key or OAuth2 validation for the `POST /leads` endpoint.
- [ ] **Rate Limiting**: Configure Throttling and Usage Plans in **AWS API Gateway** (preferred) or add `@nestjs/throttler` to the application layer.
- [ ] **Security Headers**: Integrate `helmet` middleware for basic web security.
- [ ] **Secrets Management**: Migrate from `.env` to **AWS Secrets Manager**.

#### 2. Observability
- [ ] **Structured Logging**: Configure the NestJS Logger to output **JSON format**. This is critical for log parsing and indexing in **Datadog** and **AWS CloudWatch**.
- [ ] **Health Checks**: Add `@nestjs/terminus` for `/health` and `/ready` endpoints.
- [ ] **Metrics**: Export BullMQ and API metrics to **Prometheus** or **CloudWatch Metrics**.

#### 3. Reliability & DevOps
- [ ] **Database Migrations**: Disable `synchronize: true` and implement TypeORM migrations.
- [ ] **Graceful Shutdown**: Implement listeners for `SIGTERM` to drain BullMQ workers cleanly.
- [ ] **CI/CD**: Set up GitHub Actions for automated testing and deployment.
- [ ] **Managed Services**: Provision **AWS RDS (Postgres)** and **AWS ElastiCache (Redis)**.

#### 4. API Standards
- [ ] **OpenAPI/Swagger**: Add `@nestjs/swagger` for interactive API documentation.
- [ ] **Global Exception Filter**: Standardize error response formats across the entire microservice.

## 9. Future Evolution: Production Prompt Engineering

To move beyond the "Cold Start" problem (where the AI has no historical context), the next phase of **RevenueFlow AI** involves shifting from simple JSON payloads to **Augmented Context Pipelines**.

### Strategy A: RAG-Enhanced Lead Scoring (Retrieval Augmented Generation)
Instead of the AI guessing based only on a name and email, we provide it with "Institutional Memory":
- **Historical Outcomes**: We retrieve the last 5 leads from the same domain and their eventual conversion status.
- **Firmographic Augmentation**: We hit a cache (Redis) containing enriched data from Clearbit or Apollo.

### Strategy B: The "Few-Shot" Anchor
To eliminate "Model Drift," we move from Zero-Shot (asking the AI to guess) to Few-Shot (giving examples).
- **Dynamic Example Injection**: Based on the lead's industry, we inject 3 "Gold Standard" examples into the system prompt to anchor the `fitScore` logic.

### Strategy C: Chain-of-Thought (CoT) Verification
For high-value "Executive Stealth" leads, we can trigger a "Verification Pass":
- **Pass 1 (Reasoning)**: The AI explains *why* it thinks this gmail handle is an executive.
- **Pass 2 (Scoring)**: A second, cheaper model (Haiku) validates the reasoning and assigns the final `fitScore`.
