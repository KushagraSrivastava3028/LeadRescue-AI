# Database read performance and measured indexes

Review: **2026-11-01**. No live `DATABASE_URL`, local `.env.local`, hosted database credentials or query-statistics connection was available. Live query frequency, actual slowest production queries and never-used existing indexes are **NOT VERIFIED**. No live database was modified. The measurements below are real PostgreSQL **PGlite/WASM** executions over synthetic data, not hosted Supabase/PostgREST latency or production capacity.

## Baseline and safety

Before changing migrations, `npx vitest run tests/performance-indexes.test.ts` passed the first three regressions: all inventoried main-screen SELECT shapes execute under tenant RLS, another tenant's records remain inaccessible, and the EXPLAIN inventory rejects mutations and arbitrary SELECT functions. Initial synthetic call-fixture column mistakes were corrected before that baseline passed; skipped/failed setup attempts are not passing evidence. The expanded fourth regression applies the actual concurrent-index statements, verifies all new indexes are valid, checks every inventoried query returns the same results and cross-tenant denial still holds, then executes rollback and checks the same results again.

Only inventory-owned read SELECTs enter `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. No INSERT, UPDATE, DELETE, RPC mutation, queue claim with `FOR UPDATE`, provider request or account change is run through EXPLAIN ANALYZE. Fixture inserts and index creation occur only in an ephemeral synthetic PostgreSQL database. The benchmark creates ordinary equivalent B-tree indexes for timing; the migration/rollback regression separately executes `CONCURRENTLY` in autocommit statements. PGlite cannot establish real multi-connection concurrent-build availability or lock behavior.

## What is frequent, and what is known

Source inspection shows each workspace screen calls `/api/workspace`, whose GET runs **17 data SELECT shapes** in parallel. With no business ID it first reads the user's first active membership. The authorization gate also verifies Supabase identity, active session, membership and business. The high-frequency assessment is inferred from this code; it is not production telemetry. Inbox, overview and leads therefore repeatedly load the latest conversation/message lists. Billing usage and notification reads are included on every workspace load too.

The complete parameterized SQL-equivalent inventory is in `scripts/db-performance/queries.ts`: 17 workspace reads, three identity/business selection reads, phone status, three bounded owner export reads plus their exact-count metadata shapes, two admin inspection reads, and the two platform daily-budget reads that gate AI/SMS. It records each query's screen, source file, WHERE/JOIN/ORDER BY and limits. Source routes of record:

| Screen / operation                                                                  | Read shapes                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/workspace` for Overview, Inbox, Leads, Calendar, Assistant, Settings, Billing | Profile by business; newest 100 leads with tenant-consistent contact join; newest 100 conversations by update; newest 500 messages by creation; earliest 100 appointments by start; subscription; entitlements; newest 100 usage events; eligible-call count; inbound-reply count; qualified/booked/won lead count; confirmed-appointment count; newest 30 notifications; total-call count; recovery-send-intent count; delivered-outbound count; owner-confirmed-won count |
| Workspace selection and authorization                                               | First active membership by user and creation order; exact active membership by business/user; business by primary ID. Session/MFA gates are provider/Auth RPC boundaries, not cached or optimized away                                                                                                                                                                                                                                                                      |
| Settings phone status                                                               | One phone by business, already covered by the unique business phone index                                                                                                                                                                                                                                                                                                                                                                                                   |
| Owner export                                                                        | Newest 1,000 joined leads, newest 5,000 messages, newest 1,000 appointments; `count:exact` also requires filtered full-result counts. Bounded rows do not make exact count work constant-time                                                                                                                                                                                                                                                                               |
| Admin inspection                                                                    | Business PK lookup (same business shape), oldest 50 pending outbox events by business, newest 50 job attempts                                                                                                                                                                                                                                                                                                                                                               |
| Every AI qualification / eligible outbound SMS                                      | Current UTC-day usage sums by kind/status/date; the AI read includes a business FILTER plus platform total. These remain privileged, tenant-scoped where applicable, atomic and uncached                                                                                                                                                                                                                                                                                    |
| Other protected mutations                                                           | Their prerequisite record lookups use business/id, unique sender/account/phone, idempotency, membership, or contact/conversation keys already present. They are not timed as modifying operations                                                                                                                                                                                                                                                                           |

Worker details reviewed: queue publication has a pending `available_at` index; message context uses message/conversation/contact composite IDs plus sender/account mappings; consent uses `(business_id, contact_id, granted_at)` and suppression uses the active unique partial index; AI's newest conversation messages use `(business_id, conversation_id, created_at)`; billing uses unique business/customer/subscription IDs; calendar uses appointment/connection IDs plus existing business/start/end index. The existing daily-usage index already supports the measured budget lookups. No additional worker index was justified by these measurements.

## Four selected indexes

Each key contains only actual WHERE and ORDER BY columns. No INCLUDE payload or speculative status combinations were added.

| Index                                                               | Query it targets                                          | Why the existing index was insufficient                                                                                                                        | Write cost                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `conversations_business_updated_idx (business_id, updated_at DESC)` | `conversations_recent`: tenant's latest 100 conversations | Existing tenant/lead and tenant/id keys locate the tenant but still read/sort every tenant conversation before LIMIT                                           | One additional B-tree entry per conversation insert; updates to `updated_at` also maintain this index and can prevent HOT updates |
| `messages_business_created_idx (business_id, created_at DESC)`      | `messages_recent`: tenant's latest 500 messages           | Existing `(business_id, conversation_id, created_at)` is useful for one conversation, but does not directly provide creation ordering across all conversations | One additional B-tree entry per message insert; normal body/status changes do not change these new key columns                    |
| `usage_events_business_created_idx (business_id, created_at DESC)`  | `usage_recent`: tenant's latest 100 usage ledger entries  | Existing `(business_id, kind, created_at)` groups by kind first, so the mixed-kind list sorts all tenant usage                                                 | One additional B-tree entry per usage insert; settlement changes do not change this key                                           |
| `notifications_business_created_idx (business_id, created_at DESC)` | `notifications_recent`: tenant's newest 30 notifications  | Existing tenant/id key cannot satisfy newest-first ordering                                                                                                    | One additional B-tree entry per notification insert; marking a notification read does not change this key                         |

Index storage for the measured synthetic dataset appears in the generated evidence below. Index creation also consumes CPU, I/O, temporary disk/WAL and replication resources; CONCURRENTLY avoids blocking ordinary writes for the duration of the build but is not zero-cost or zero-lock. Monitor actual host/database headroom and replication before applying to a large live table.

Two candidates were measured and rejected: `job_attempts(business_id, created_at DESC)` improved a rare admin read by a few milliseconds but would add writes for every completed job; a partial `usage_events(kind, created_at) WHERE status <> 'released'` saved less than half a millisecond in the exploratory run while adding about 3.6 MB and extra status-transition maintenance. Neither is shipped. Existing calls/leads/appointments ordering keys already serve the common list/range filters; no extra metric-specific indexes were added just in case.

## Before and after for every important read

Data: 10 synthetic businesses, 10,000 contacts/leads/conversations, 200,000 messages, 120,000 usage events, 100,000 calls, 40,000 notifications, 40,000 job attempts and 10,000 requested/confirmed appointments. Normal app queries use authenticated tenant RLS with synthetic Auth/session claims; admin and worker queries run in the privileged fixture role to reproduce those code paths. The SQL mirrors the application's PostgREST read shape; PostgREST JSON wrapping, network, connection pooling, API fanout, SMTP and real provider latency are not measured.

An exploratory single-pass run overlapped other build activity and recorded message-export regression from 646.132 ms to 1195.763 ms. This is retained in `.cache/db-performance/initial-results.json`, not discarded or called a pass. The repeatable benchmark now runs **two paired baseline/indexed rounds** with the same rows and table statistics, drops only the new synthetic indexes between rounds, and records all samples, min/max and plans. Do not claim every query improves; export exact counts and broad row materialization remain expensive and are listed even when unchanged or slower.

<!-- performance-evidence:start -->

Generated from a real local run at `2026-10-31T19:20:37.296Z`. Engine: PostgreSQL 18.6 (PGlite 0.5.13) on wasm32-unknown-emscripten, compiled by emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.5 (1db513782be24469589d7cb8a1f1834e9a33f271), 32-bit. Measurement: `{"rounds":2,"warmupsPerRound":1,"samplesPerRound":5,"samplesPerPhase":10,"statistic":"median across 10 measured executions per phase; one warmup per paired round; same table statistics; no ANALYZE between phases"}`. Times below are PostgreSQL EXPLAIN execution medians in milliseconds. Scan row figures are per plan loop, not summed across nested join loops.

| Read query                  | Before ms | After ms | Before scan                                                                 | After scan                                                                  |
| --------------------------- | --------: | -------: | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `profile`                   |     0.227 |    0.079 | business_profiles: Seq Scan (1 rows, 9 filtered)                            | business_profiles: Seq Scan (1 rows, 9 filtered)                            |
| `leads_recent`              |     7.004 |    5.623 | leads: Index Scan (100 rows); contacts: Index Scan (1 rows)                 | leads: Index Scan (100 rows); contacts: Index Scan (1 rows)                 |
| `conversations_recent`      |    29.195 |    3.962 | conversations: Bitmap Heap Scan (1000 rows)                                 | conversations: Index Scan (100 rows)                                        |
| `messages_recent`           |   634.973 |   15.228 | messages: Bitmap Heap Scan (20000 rows)                                     | messages: Index Scan (500 rows)                                             |
| `appointments_upcoming`     |     4.716 |    3.944 | appointments: Index Scan (100 rows)                                         | appointments: Index Scan (100 rows)                                         |
| `subscription`              |     0.138 |    0.116 | subscriptions: Seq Scan (1 rows, 9 filtered)                                | subscriptions: Seq Scan (1 rows, 9 filtered)                                |
| `entitlements`              |     0.118 |    0.120 | entitlements: Seq Scan (1 rows, 9 filtered)                                 | entitlements: Seq Scan (1 rows, 9 filtered)                                 |
| `usage_recent`              |   374.874 |    4.251 | usage_events: Bitmap Heap Scan (12000 rows)                                 | usage_events: Index Scan (100 rows)                                         |
| `eligible_calls_count`      |    10.662 |   15.598 | calls: Bitmap Heap Scan (392 rows, 786 filtered)                            | calls: Bitmap Heap Scan (392 rows, 786 filtered)                            |
| `replies_count`             |    43.837 |   43.654 | messages: Bitmap Heap Scan (1185 rows, 1187 filtered)                       | messages: Bitmap Heap Scan (1185 rows, 1187 filtered)                       |
| `qualified_count`           |     2.337 |    2.519 | leads: Bitmap Heap Scan (55 rows, 73 filtered)                              | leads: Bitmap Heap Scan (55 rows, 73 filtered)                              |
| `booked_count`              |     1.411 |    1.404 | appointments: Bitmap Heap Scan (25 rows, 975 filtered)                      | appointments: Bitmap Heap Scan (25 rows, 975 filtered)                      |
| `notifications_recent`      |   137.763 |    1.234 | notifications: Bitmap Heap Scan (4000 rows)                                 | notifications: Index Scan (30 rows)                                         |
| `all_calls_count`           |    47.428 |   41.229 | calls: Bitmap Heap Scan (1178 rows)                                         | calls: Bitmap Heap Scan (1178 rows)                                         |
| `recovery_attempts_count`   |    38.480 |   36.140 | messages: Bitmap Heap Scan (593 rows, 1779 filtered)                        | messages: Bitmap Heap Scan (593 rows, 1779 filtered)                        |
| `delivered_count`           |    35.703 |   41.758 | messages: Bitmap Heap Scan (1187 rows, 1185 filtered)                       | messages: Bitmap Heap Scan (1187 rows, 1185 filtered)                       |
| `owner_wins_count`          |     0.982 |    0.797 | leads: Bitmap Heap Scan (17 rows, 983 filtered)                             | leads: Bitmap Heap Scan (17 rows, 983 filtered)                             |
| `first_membership`          |     0.139 |    0.129 | memberships: Seq Scan (1 rows)                                              | memberships: Seq Scan (1 rows)                                              |
| `membership_gate`           |     0.089 |    0.078 | memberships: Seq Scan (1 rows)                                              | memberships: Seq Scan (1 rows)                                              |
| `business_gate`             |     0.073 |    0.077 | businesses: Seq Scan (1 rows, 9 filtered)                                   | businesses: Seq Scan (1 rows, 9 filtered)                                   |
| `phone_status`              |     0.011 |    0.017 | phone_numbers: Seq Scan (0 rows)                                            | phone_numbers: Seq Scan (0 rows)                                            |
| `export_leads`              |    57.208 |   66.748 | leads: Bitmap Heap Scan (1000 rows); contacts: Bitmap Heap Scan (1000 rows) | leads: Bitmap Heap Scan (1000 rows); contacts: Bitmap Heap Scan (1000 rows) |
| `export_messages`           |   638.755 |  681.080 | messages: Bitmap Heap Scan (20000 rows)                                     | messages: Bitmap Heap Scan (20000 rows)                                     |
| `export_appointments`       |    25.870 |   34.454 | appointments: Bitmap Heap Scan (1000 rows)                                  | appointments: Bitmap Heap Scan (1000 rows)                                  |
| `export_leads_count`        |    29.620 |   31.245 | leads: Bitmap Heap Scan (1000 rows)                                         | leads: Bitmap Heap Scan (1000 rows)                                         |
| `export_messages_count`     |   572.287 |  622.254 | messages: Bitmap Heap Scan (20000 rows)                                     | messages: Bitmap Heap Scan (20000 rows)                                     |
| `export_appointments_count` |    26.817 |   30.227 | appointments: Bitmap Heap Scan (1000 rows)                                  | appointments: Bitmap Heap Scan (1000 rows)                                  |
| `admin_pending_events`      |     0.019 |    0.020 | outbox: Seq Scan (0 rows)                                                   | outbox: Seq Scan (0 rows)                                                   |
| `admin_attempts`            |     2.862 |    3.022 | job_attempts: Bitmap Heap Scan (4000 rows)                                  | job_attempts: Bitmap Heap Scan (4000 rows)                                  |
| `worker_ai_daily_budget`    |     0.345 |    0.378 | usage_events: Bitmap Heap Scan (332 rows)                                   | usage_events: Bitmap Heap Scan (332 rows)                                   |
| `worker_sms_daily_budget`   |     0.321 |    0.286 | usage_events: Bitmap Heap Scan (336 rows)                                   | usage_events: Bitmap Heap Scan (336 rows)                                   |

| Read query                  | Before min–max ms | After min–max ms | Before hit/read blocks | After hit/read blocks |
| --------------------------- | ----------------: | ---------------: | ---------------------: | --------------------: |
| `profile`                   |       0.074–0.432 |      0.071–0.097 |                    5/0 |                   5/0 |
| `leads_recent`              |       5.545–7.955 |      5.301–8.870 |                 1202/0 |                1202/0 |
| `conversations_recent`      |     26.025–46.750 |      2.468–4.418 |                 4163/0 |                 502/0 |
| `messages_recent`           |   516.328–779.504 |    12.476–21.894 |                87835/0 |                2504/0 |
| `appointments_upcoming`     |       3.527–5.132 |      2.563–4.402 |                  421/0 |                 421/0 |
| `subscription`              |       0.118–0.159 |      0.104–0.140 |                    5/0 |                   5/0 |
| `entitlements`              |       0.088–0.133 |      0.116–0.406 |                    5/0 |                   5/0 |
| `usage_recent`              |   336.377–391.950 |      3.613–4.832 |                49715/0 |                 503/0 |
| `eligible_calls_count`      |      9.644–16.876 |    11.383–16.812 |                 1872/0 |                1872/0 |
| `replies_count`             |     40.219–50.326 |    30.769–48.700 |                 5882/0 |                5684/0 |
| `qualified_count`           |       2.272–3.069 |      1.926–3.238 |                  254/0 |                 254/0 |
| `booked_count`              |       1.150–1.854 |      0.915–2.064 |                  289/0 |                 289/0 |
| `notifications_recent`      |   112.455–148.069 |      0.775–1.547 |                16565/0 |                 154/0 |
| `all_calls_count`           |     29.207–56.343 |    30.040–48.735 |                 5016/0 |                5016/0 |
| `recovery_attempts_count`   |     30.727–53.570 |    29.211–46.471 |                 5890/0 |                5692/0 |
| `delivered_count`           |     30.538–55.464 |    30.278–47.232 |                 5890/0 |                5692/0 |
| `owner_wins_count`          |       0.719–1.228 |      0.712–1.345 |                  262/0 |                 262/0 |
| `first_membership`          |       0.100–0.347 |      0.092–0.312 |                    5/0 |                   5/0 |
| `membership_gate`           |       0.072–0.135 |      0.065–0.100 |                    5/0 |                   5/0 |
| `business_gate`             |       0.069–0.082 |      0.068–0.089 |                    5/0 |                   5/0 |
| `phone_status`              |       0.009–0.015 |      0.009–0.019 |                    0/0 |                   0/0 |
| `export_leads`              |     50.832–76.607 |    50.707–83.520 |                 8357/0 |                8357/0 |
| `export_messages`           |   581.016–719.160 |  608.037–772.140 |                87835/0 |               87750/0 |
| `export_appointments`       |     25.163–36.085 |    26.704–43.045 |                 4189/0 |                4189/0 |
| `export_leads_count`        |     24.403–38.479 |    24.618–40.781 |                 4194/0 |                4194/0 |
| `export_messages_count`     |   530.601–646.635 |  568.180–684.709 |                87835/0 |               87750/0 |
| `export_appointments_count` |     23.649–38.539 |    25.386–43.609 |                 4189/0 |                4189/0 |
| `admin_pending_events`      |       0.016–0.030 |      0.016–0.130 |                    0/0 |                   0/0 |
| `admin_attempts`            |       2.777–3.596 |      2.792–3.802 |                  524/0 |                 524/0 |
| `worker_ai_daily_budget`    |       0.301–0.770 |      0.286–0.483 |                  120/0 |                 120/0 |
| `worker_sms_daily_budget`   |       0.301–0.508 |      0.275–0.439 |                   96/0 |                  96/0 |

| New index                            | Synthetic size MiB |
| ------------------------------------ | -----------------: |
| `conversations_business_updated_idx` |              0.406 |
| `messages_business_created_idx`      |              5.086 |
| `usage_events_business_created_idx`  |              3.953 |
| `notifications_business_created_idx` |              1.578 |
| Total                                |             11.023 |

<!-- performance-evidence:end -->

A Seq Scan means PostgreSQL walks the whole relation, applying its filter to each row. A Bitmap Heap/Index Scan in these plans reads matching tenant/date candidates, not the entire table. An Index Scan with LIMIT can stop after the requested page when index ordering matches. Tiny one-row-per-business tables may reasonably use Seq Scan even with a primary/unique index; the planner considers a ten-row scan cheaper. None of the four new indexes exists to eliminate those tiny scans.

The phone-status and pending-outbox relations are empty in this fixture, so their
reported times establish only that the read shape executes, not populated-table
performance. The paired message export and exact-count medians increased to
681.080 ms and 622.254 ms respectively, with similar broad bitmap plans. Their
cause and hosted significance remain unresolved; the new indexes target the
bounded frequent lists and do not remove broad export/count work. Native staging
measurements should check these paths before a capacity claim.

## Reproduce and inspect real statistics

```sh
npx vitest run tests/performance-indexes.test.ts
node --import=tsx scripts/db-performance/benchmark.ts
node --import=tsx scripts/db-performance/render-report.ts
# Optional, when an authorized database connection is configured securely:
node --import=tsx scripts/db-performance/inspect-live.ts
```

Do not run the CPU-heavy synthetic benchmark at the same time as k6, builds or the production service. The benchmark never reads DATABASE_URL or contacts an external database. Its raw synthetic plans/timings stay under ignored `.cache/db-performance`.

The live-inspection helper reads only the necessary `DATABASE_URL` locally and never logs it. It opens a READ ONLY transaction with a five-second statement timeout, reads extension availability and index counters, and—if `pg_stat_statements` is available—reports IDs/calls/mean/total duration for frequent and slow queries. It never prints customer SQL text or bindings, resets statistics, enables an extension, or changes indexes. If configuration is absent it states NOT VERIFIED. Configure any real secret through `.env.local` or your host secret manager, never chat.

**Existing never-used indexes: unknown.** No production `pg_stat_user_indexes` window was available. `idx_scan = 0` only means no recorded scans since statistics/reset/creation in that observed window; it is not proof that an index is unnecessary. Primary and unique indexes also enforce correctness and must not be removed on that basis. There is a possible overlapping-prefix pair `outbox_pending_idx (available_at)` / `outbox_worker_claim_idx (available_at, locked_until)` with the same pending predicate; neither is dropped without real observation, validity/constraint checks, backup/rollback planning and a separate reviewed migration.

## Apply and undo

Review `supabase/migrations/0007_workspace_read_indexes.sql` and run it through the repository migration runner on a **direct or session-pooled operator connection**:

```sh
npm run db:migrate
```

The `-- leadrescue:no-transaction` directive and explicit statement breaks tell the runner to execute each `CREATE INDEX CONCURRENTLY` separately. Do not wrap this file in BEGIN, send the entire file as a single multi-statement execution, or route its session advisory lock through a transaction pooler. Any other migration tool must first be verified to preserve these autocommit semantics. Existing SQL migrations remain transactional. A concurrent build can fail and leave an invalid index; the runner must detect this and refuse to mark the migration applied. Inspect the named index, then drop/rebuild it in a reviewed operator procedure. IF NOT EXISTS alone does not repair an invalid index.

For a performance-only rollback, use an authorized direct/session psql connection and execute:

```sh
psql "service=leadrescue-operator" -v ON_ERROR_STOP=1 -f supabase/rollback/0007_workspace_read_indexes.sql
```

Configure the `leadrescue-operator` libpq service and its password source in your secure operator profile outside the repository; do not put a database password or expanded URL in shell arguments, source or chat. psql sends the concurrent DROP statements individually. Do not wrap the rollback in a transaction. It drops only the four newly added non-unique indexes, preserving tables, data, roles, RLS, existing indexes and app behavior. Migration history is intentionally retained. Reintroduce indexes with a new reviewed forward migration; do not casually alter historical checksums or delete applied ledger entries. If the custom runner applied the migration and an operator intentionally plans to replay that same version after rollback, ledger reconciliation must be explicit, restricted and separately reviewed; no automatic history deletion is included.

Hosted Supabase planning, actual concurrent writers, lock wait/IO impact, native hardware timings, production query frequencies and genuinely unused indexes remain NOT VERIFIED. References: [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html), [multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html), [concurrent index build caveats](https://www.postgresql.org/docs/current/sql-createindex.html).
