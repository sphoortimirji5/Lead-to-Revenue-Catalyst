# Project Security

The RevenueFlow AI architecture implements a defense-in-depth security model to protect customer data, ensure operational integrity, and maintain compliance.

> **Note**: For AI-specific safety and hallucination prevention, see [AI Grounding & Guardrails](ai_grounding.md).

## Network Security

### 1. Network Isolation
- **Private Subnets**: All persistent data stores (PostgreSQL, Redis) and processing workers (`LeadProcessor`) reside in private subnets with no public ingress.
- **Strict Egress**: Outbound traffic is restricted via NAT Gateway to allowlisted domains only (Salesforce API, Google Gemini API, Enrichment Providers).
- **Public Ingress**: Only the `Ingestion Controller` (`POST /leads`) is exposed to the public internet, protected by a WAF.

### 2. Transport Security
- **TLS 1.3**: Enforced for all data in transit.
- **mTLS**: Database connections require mutual TLS authentication in production.
- **Service-to-Service**: Internal communication between Microservices and Redis is encrypted.

## Data Protection

### 1. Data Minimization
- **PII Handling**: Only essential contact fields (Email, Name) are persisted.
- **Log Redaction**: Standardized logging middleware automatically redacts sensitive fields (`password`, `token`, `email`, `phone`) before logs are shipped to the observability pipeline.

### 2. Encryption
- **At Rest**: AES-256 encryption for PostgreSQL volumes and Redis persistence files.
- **Secrets Management**: All sensitive credentials (API Keys, Client Secrets) are injected via Environment Variables at runtime. No secrets are committed to version control.

## Authentication & Authorization

### 1. API Security
- **Webhook Validation**: Requests to `/leads` are validated using a shared secret (HMAC SHA-256) to ensure they originate from the trusted Marketo instance.
- **Rate Limiting**: Token-bucket rate limiting protects the ingestion endpoint from Denial of Service (DoS) attacks.

### 2. Infrastructure Access
- **Least Privilege**: IAM roles for ECS tasks grant minimum necessary permissions (e.g., specific S3 bucket access, specific SSM parameter reads).
- **No SSH**: Production containers are immutable; no SSH access is permitted. Debugging is performed via observability tools (logs/traces).

