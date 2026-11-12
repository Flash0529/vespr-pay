# Manager and Worker Agents in VESPR

In VESPR, complex development workflows can be coordinated through structured manager-worker agent pairs operating within the shared CRDT room.

Rather than running autonomous uncoordinated agents that risk colliding or looping, VESPR implements deterministic management patterns modeled on engineering team leads:
1. **Scheduled Heartbeats**: Workers emit periodic heartbeats (`beat` timestamp) while active.
2. **Watchdog Surveillance**: The manager surveys worker liveness every `MANAGER_TICK_SEC` (default 15s).
3. **Stall Detection & Reassignment**: If a worker drops out or stalls beyond `TASK_STALL_SEC` (default 45s), the manager reassigns the task in priority order to the next available worker in the same pair.
4. **Rules Relay**: When room rules change, the manager explicitly mentions each assigned worker; workers must acknowledge the updated rules before receiving new tasks.
5. **Review Gate**: Workers submit completed work with concrete evidence and test output to `review`; the manager inspects evidence before approving the task as `done`.
6. **Room Escalation**: If a task fails across `MAX_ATTEMPTS` (default 3), the manager blocks the task and requests an approval decision from the human participants in the room.

---

## Architecture & Data Flow

```
                      ┌────────────────────────────┐
                      │    Human Room / Settings   │
                      └─────────────┬──────────────┘
                                    │ Rules & Tasks
                                    ▼
                      ┌────────────────────────────┐
                      │    Manager Agent (@lead)   │
                      │  - Watchdog Tick (15s)     │
                      │  - Rules Relay             │
                      │  - Review Gate             │
                      └──────┬──────────────┬──────┘
                             │              │
                Task A (p1)  │              │ Task B (p2)
                             ▼              ▼
                   ┌──────────────┐   ┌──────────────┐
                   │ Worker Coder │   │ Worker Coder2│
                   │ (beat: 5s)   │   │ (beat: 5s)   │
                   └──────────────┘   └──────────────┘
```

### Roles and Pairs
- **Environment Variables**:
  - `AGENT_ROLE`: `manager` or `worker` (default `worker`).
  - `AGENT_PAIR`: Named pair group (default `main`). Multiple pairs can coexist in a single room without task cross-talk.
  - `MANAGER_TICK_SEC`: Watchdog interval (default `15`).
  - `TASK_STALL_SEC`: Threshold to declare an active task stalled (default `45`).
  - `MAX_ATTEMPTS`: Maximum retry attempts before escalating to the room (default `3`).
  - `ACK_SEC`: Window for workers to acknowledge new rules (default `30`).

### Task Lifecycle State Machine
```
[todo] ──(auto-assign)──> [assigned] ──(worker starts)──> [doing]
                               │                             │
                        (stall / down)                 (submit work)
                               │                             │
                               ▼                             ▼
                          [assigned] <──(reject evidence)── [review]
                       (attempt += 1)                        │
                               │                     (approve evidence)
                       (attempts >= 3)                       │
                               │                             ▼
                               ▼                          [done]
                           [blocked] ──(approval card)──> Room Decides
```

---

## Honest Limitations

1. **Liveness is Presence + Heartbeat, Not Semantic Progress**:
   The watchdog verifies that a worker agent is connected and emitting recent timestamps. A worker generating an infinite loop or unproductive code could still emit heartbeats until a command timeout occurs.
2. **Review is Evidence Verification, Not a Formal Proof**:
   The manager checks that the worker supplied non-empty evidence, test execution logs, and zero reported test failures. It does not formally verify code correctness or catch bugs not covered by the test suite.
3. **No Central Lock or Outside Coordinator**:
   All state lives in the shared Yjs room document (`doc.getMap('tasks')`) and awareness states. If all agents and users leave the room, task state persists in the room database until reloaded.
4. **Pair Isolation**:
   Pairs are strictly isolated by pair name; agents assigned to pair `alpha` cannot inspect or reassign tasks assigned to pair `beta`.
