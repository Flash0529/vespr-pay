---
name: sql-review
description: Review or write SQL for correctness, safety and speed: joins, NULLs, indexes, transactions, injection. Use for queries, migrations and reports.
---
# SQL review

- **Correctness:** check join type and keys (a missed condition makes a cross join); `NULL` is not equal to anything (use `IS NULL`, mind `NOT IN` with NULLs); integer division; time zones and inclusive/exclusive date ranges; `GROUP BY` lists every non-aggregated column; `DISTINCT` hiding a bad join is a smell.
- **Safety:** parameters, never string-built SQL from user input. `UPDATE`/`DELETE` without `WHERE` is a bug until proven otherwise: run the same `WHERE` as a `SELECT COUNT(*)` first and inside a transaction. Destructive changes need a backup or a way back.
- **Speed:** look at the plan (`EXPLAIN`/`EXPLAIN ANALYZE`) before guessing. Indexes should match the `WHERE` and `JOIN` columns and the sort order; functions on an indexed column defeat the index; `SELECT *` on wide tables and `OFFSET` for deep paging are costly (use keyset paging).
- **Consistency:** multi-step writes in one transaction; know the isolation level; lock order the same everywhere to avoid deadlocks; unique constraints to stop duplicates instead of checking in code.
- **Style:** explicit column lists, explicit `JOIN ... ON`, one idea per CTE, names that say what the thing is.

For every finding give the line, the risk and a corrected query. Say which database you assumed.
