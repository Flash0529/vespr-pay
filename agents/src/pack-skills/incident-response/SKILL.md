---
name: incident-response
description: Manage production outage and incident lifecycles. Covers severity triage (SEV1-SEV4), war room coordination, containment, blast radius mitigation, timeline tracking, and blameless postmortem generation.
---
# Production Incident Response & Reliability Protocol

Coordinate incident response from initial alert through root-cause analysis and blameless postmortem.

## Severity Classification

| Level | Impact | Target Response | Target Resolution |
|---|---|---|---|
| **SEV1** | Critical customer-facing outage, data loss risk, complete service unavailability | < 5 minutes | Immediate / War Room |
| **SEV2** | Major feature broken, high error rates (> 5%), core workflow degraded | < 15 minutes | < 2 hours |
| **SEV3** | Minor feature degradation, non-blocking bugs with workarounds | < 1 business hour | < 1 business day |
| **SEV4** | Cosmetic issues, internal tooling glitches, minor inquiries | Standard backlog | Next release cycle |

## Incident Lifecycle Phases

1. **Triage & Role Assignment:**
   - Incident Commander (IC): Leads mitigation decisions and assigns responders.
   - Communications Lead: Publishes periodic status updates to stakeholders every 15-30 minutes.
   - Operations / Responders: Investigates telemetry, logs, and system metrics.

2. **Containment & Mitigation:**
   - Prioritize stopping customer harm over deep debugging (e.g., rollback recent deployment, toggle feature flag, scale up replicas, drain bad instances).
   - Capture live state (heap dumps, metric snapshots, error traces) before restarting services.

3. **Blameless Postmortem (RCA):**
   - **Summary:** Concise description of the failure and impact.
   - **Timeline (UTC):** Exact chronological sequence from alert firing to verified recovery.
   - **Root Cause (5 Whys):** Deep systemic failure analysis without blaming individuals.
   - **Corrective Actions:** Specific preventive tasks with assigned owners and deadlines.

