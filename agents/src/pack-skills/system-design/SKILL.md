---
name: system-design
description: Architect distributed systems, microservices, and reliable cloud infrastructures. Covers requirements gathering, capacity estimation, component topologies, data modeling, API contracts, caching, fault tolerance, and trade-off analysis.
---
# System Design & Architecture Framework

Use this framework when designing scalable backend architectures, distributed services, and reliable system topologies.

## Structured Methodology

### 1. Requirements & Scope Definition
- **Functional Requirements:** Core user capabilities, APIs, and business logic.
- **Non-Functional Requirements:** Throughput (QPS), p99 latency target (< 100ms), availability (e.g. 99.99%), durability, data consistency (strong vs. eventual).
- **Scale & Capacity Estimation:**
  - Read/Write QPS and ratio.
  - Storage growth per day/year with replication factor.
  - Bandwidth consumption and ingress/egress peaks.

### 2. High-Level Architecture
- Component diagram mapping clients, API gateways, load balancers, application services, and datastores.
- Ingress routing: TLS termination, rate limiting, and authentication verification.
- Asynchronous decoupling: Event queues (Kafka, RabbitMQ, SQS) vs. synchronous RPC (gRPC, HTTP/2).

### 3. Data Tier & Storage Strategy
- Primary datastore selection: Relational (PostgreSQL) vs. Document/NoSQL vs. Wide-Column.
- Partitioning & Sharding: Range-based vs. consistent hashing.
- Caching topology: Read-through, write-behind, cache-aside with TTL and eviction policies (LRU/LFU).

### 4. Reliability & Fault Tolerance
- Single points of failure (SPOF) mitigation through multi-zone redundancy.
- Circuit breakers, exponential backoff with jitter, and dead-letter queues.
- Disaster recovery: Active-active vs. active-passive with defined RPO and RTO.

### 5. Trade-off Analysis
- Document trade-offs explicitly: Consistency vs. Availability (CAP theorem), operational complexity vs. flexibility, and cost vs. performance.

