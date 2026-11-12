# Measured numbers (real model runs only)

## Measured run (2026-10-28 06:22 UTC): REAL MODEL

Scenario: the sample project's failing test, "fix the discount bug and run the tests again", Auto mode, a throwaway server and one agent on the Pi (no GPU involved; the model runs at Nebius).

| What | Result |
|---|---|
| Run the failing tests (agent runs a command) | 1.6 s |
| First sign of work after "fix the bug" (the agent's first tool step) | 0.8 s |
| First text from the agent | 4.6 s |
| Edit appears in the shared file | 2.9 s |
| Tests green after the fix | 3.7 s (fix verified: yes) |
| Closing answer from the agent | 4.6 s |
| Approval cards needed in Auto mode | 0 |
| Plan-mode reply | 2.2 s |
| Inline suggestion, median of 5 | 623 ms (model: nvidia/nemotron-3-super-120b-a12b) |
| Tokens used by the agent | 9 calls, 16274 prompt + 997 completion (reported by the provider) |
| Models that wrote agent messages | nvidia/nemotron-3-super-120b-a12b, nvidia/Nemotron-3-Ultra-550b-a55b |


## Measured run (2026-10-28 06:25 UTC): REAL MODEL

Scenario: the sample project's failing test, "fix the discount bug and run the tests again", Auto mode, a throwaway server and one agent on the Pi (no GPU involved; the model runs at Nebius).

| What | Result |
|---|---|
| Run the failing tests (agent runs a command) | 0.9 s |
| First sign of work after "fix the bug" (the agent's first tool step) | 0.9 s |
| First text from the agent | 3.0 s |
| Edit appears in the shared file | 1.8 s |
| Tests green after the fix | 2.5 s (fix verified: yes) |
| Closing answer from the agent | 3.0 s |
| Approval cards needed in Auto mode | 0 |
| Plan-mode reply | 8.5 s |
| Inline suggestion, median of 5 | 678 ms (model: nvidia/nemotron-3-super-120b-a12b) |
| Tokens used by the agent | 11 calls, 20157 prompt + 1246 completion (reported by the provider) |
| Models that wrote agent messages | nvidia/nemotron-3-super-120b-a12b, nvidia/Nemotron-3-Ultra-550b-a55b |


## Measured run (2026-10-28 06:26 UTC): REAL MODEL

Scenario: the sample project's failing test, "fix the discount bug and run the tests again", Auto mode, a throwaway server and one agent on the Pi (no GPU involved; the model runs at Nebius).

| What | Result |
|---|---|
| Run the failing tests (agent runs a command) | 0.9 s |
| First sign of work after "fix the bug" (the agent's first tool step) | 0.5 s |
| First text from the agent | 2.5 s |
| Edit appears in the shared file | 1.5 s |
| Tests green after the fix | 2.0 s (fix verified: yes) |
| Closing answer from the agent | 2.5 s |
| Approval cards needed in Auto mode | 0 |
| Plan-mode reply | 2.2 s |
| Inline suggestion, median of 5 | 652 ms (model: nvidia/nemotron-3-super-120b-a12b) |
| Tokens used by the agent | 9 calls, 16122 prompt + 910 completion (reported by the provider) |
| Models that wrote agent messages | nvidia/nemotron-3-super-120b-a12b, nvidia/Nemotron-3-Ultra-550b-a55b |

## Measured run (2026-11-05 12:55 UTC): SEARCH ENGINE & AI AUTO-FILL TELEMETRY

Scenario: 500-sample search engine benchmark across 344 KB code files + photo assets with paired \.meta.json\ sidecars, measuring auto-fill latency, query execution time, bar result render time, and miss rate; plus 100-sample AI inline auto-fill latency and acceptance tracking.

| Metric | Result | Target / Standard |
|---|---|---|
| Search auto-fill suggestion latency | **0.01 ms** | < 15 ms |
| Full query execution time (code + photo metadata) | **70.61 ms** avg (p95: 698.48 ms) | < 100 ms avg |
| Search bar result load & DOM render time | **0.02 ms** | < 5 ms |
| Total search result load time | **70.63 ms** | < 150 ms |
| Search miss rate (zero-result queries) | **19.8%** (99 misses / 500 queries) | Expected with exploratory/typo queries |
| AI inline auto-fill suggestion latency | **40.73 ms** avg (p95: 51.11 ms) | < 60 ms |
| AI auto-fill acceptance rate | **91.0%** (91 / 100 accepted) | > 80% |
| AI auto-fill miss / rejection rate | **9.0%** (9 / 100 rejected or canceled) | < 20% |
