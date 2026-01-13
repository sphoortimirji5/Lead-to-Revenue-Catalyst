# Local Development Stack

Local development prioritizes correctness and failure behavior over performance realism.

This document details the local development environment for **RevenueFlow AI**.

## Services
The local stack is orchestrated via Docker Compose and includes:
- **PostgreSQL**: Primary database for lead storage and idempotency tracking.
- **Redis**: Message broker and state store for BullMQ.

## Mock vs. Real Components
To ensure a fast, cost-effective development cycle, we use a "Mock-First" approach:
- **CRM**: `MockCrmService` simulates Salesforce interactions by persisting data to a local Postgres table.
- **AI**: `GeminiProvider` uses the Gemini 2.0 Flash model for cost-effective validation of intent logic.
- **Auth**: Local development uses simplified environment-based configuration rather than full OAuth/JWT.

## Validation Goals
The local stack is designed to validate:
- **Flow Correctness**: Ensuring leads move from ingestion to CRM sync without data loss.
- **Idempotency**: Verifying that duplicate webhooks do not create duplicate CRM records.
- **Retries/Backoff**: Testing the BullMQ worker's ability to handle transient failures.
- **Schema Validation**: Ensuring all incoming and outgoing payloads adhere to Zod/class-validator schemas.

| Validated Locally | Not Validated |
| :--- | :--- |
| Control flow | AWS networking |
| Retries/backoff | Real quotas |
| Idempotency | Multi-region failure |

## What is NOT Validated Locally
- **Real Rate Limits**: Local mocks do not simulate Salesforce or AI API rate limits.
- **Multi-AZ Failures**: The stack runs as a single instance.
- **Real Latency/SLOs**: Performance metrics in Docker Desktop do not reflect AWS production latencies.
