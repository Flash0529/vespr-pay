---
name: db-migrations
description: Plan and review database schema changes so they are safe on live data: expand and contract, backfills, locks, rollbacks. Use for any migration.
---
# Database migrations

1. **One change, one migration**, in version control, reviewed like code. Never edit a migration that has already run anywhere.
2. **Expand, then contract.** Step 1 add the new column/table (nullable or with a default that does not rewrite the table); step 2 deploy code that writes both; step 3 backfill in batches; step 4 deploy code that reads the new one; step 5 drop the old thing in a later release.
3. **Locks:** know which statements take heavy locks on your database (adding a NOT NULL with default, changing a type, building an index without `CONCURRENTLY` where supported). Set a lock timeout; run big changes off-peak.
4. **Backfills:** batches with a pause, resumable, idempotent, progress logged; verify counts afterwards.
5. **Rollback:** write the down path or state clearly that it is one-way. Take a backup or snapshot before anything destructive and test the restore.
6. **Test on a copy** of production-sized data, and time it. Check the application's queries and indexes still match.
7. **Data rules:** add constraints (NOT NULL, unique, foreign key) only after existing rows satisfy them; check with a query first.

Output: the ordered steps (migration and deploy order), the risks, the rollback, and the checks to run before and after.
