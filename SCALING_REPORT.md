# LeadRescue performance and scaling review

Handoff: **2026-11-02**. The owner confirmed that LeadRescue is **not deployed**. No production account, database, customer records, provider calls or paid infrastructure was changed. All recorded measurements use local synthetic data or public/demo rendering. No new service cost was introduced.

## Database indexes and measurements

Source inspection inventoried **31 read shapes**, including the 17 data queries performed by a workspace load, authorization/business selection, export rows and exact counts, admin inspection and worker budget reads. Every inventoried query was measured using `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on real PGlite PostgreSQL with synthetic tenant RLS. Only read SELECTs enter EXPLAIN ANALYZE.

The repeatable benchmark uses two paired baseline/indexed rounds on identical data and statistics, one warmup and five measured executions per phase per round. The table shows pooled medians from ten executions per phase, in milliseconds:

| Read                     |  Before |  After | What changed                                                                                          |
| ------------------------ | ------: | -----: | ----------------------------------------------------------------------------------------------------- |
| Latest 100 conversations |  29.195 |  3.962 | Reads the requested 100 using tenant/update ordering instead of reading and sorting 1,000 tenant rows |
| Latest 500 messages      | 634.973 | 15.228 | Reads 500 using tenant/creation ordering instead of 20,000 tenant rows                                |
| Latest 100 usage entries | 374.874 |  4.251 | Reads 100 using tenant/creation ordering instead of 12,000 tenant rows                                |
| Latest 30 notifications  | 137.763 |  1.234 | Reads 30 using tenant/creation ordering instead of 4,000 tenant rows                                  |

[The full database report](docs/DATABASE_PERFORMANCE.md) includes every query's before/after time, scan type, min/max, buffer evidence, index size and source mapping. A sequential scan walks the whole relation; the small profile/subscription/membership/business tables sometimes use this rationally. The four targeted reads previously used bitmap access to the tenant's rows, followed by ordering; their new ordered index scans stop at the page limit.

These changes do **not** improve every read. The paired message export median was **638.755 → 681.080 ms**, and its exact count was **572.287 → 622.254 ms**. Both still traverse about 20,000 tenant messages and remain expensive. The report preserves the earlier exploratory export regression too. Neither the source of those timing differences nor native hosted performance is established by these local runs. Separate export pagination/count work needs an actual staging workload and review before changing behavior.

Only four measured non-unique B-tree indexes ship in [migration 0007](supabase/migrations/0007_workspace_read_indexes.sql), totaling **11.023 MiB** on this fixture. Two additional candidates were rejected. Indexes add storage and insert/update maintenance. The runner executes concurrent builds individually outside a transaction, verifies their validity and definition, safely resumes partial builds, and refuses a transaction-pool connection. Existing migrations remain transactional. A [concurrent rollback](supabase/rollback/0007_workspace_read_indexes.sql) drops only these four indexes.

**Live frequency, slowest production queries and never-used existing indexes are unknown.** No database connection was configured. The included [read-only inspection script](scripts/db-performance/inspect-live.ts) reports index counters and, when available, `pg_stat_statements` IDs/call timings without logging SQL bindings or secrets. It safely reported missing configuration locally. No existing index was removed based on synthetic usage counters.

## Caching

The proposed cache list, lifetime, invalidation and cost were presented before editing. The implemented policy is detailed in [CACHING.md](docs/CACHING.md):

| Item                                                              | Boundary and lifetime                                                  | Invalidation / cost                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Hashed Next assets                                                | Existing browser/CDN headers, one year immutable                       | Changed content gets a new URL; no new service                          |
| Verified identity within one workspace GET                        | Private handler closure; request lifetime only, zero cross-request TTL | Discarded at request completion; failures evicted; no new service       |
| HTML, private workspace records, permissions and provider results | No cross-request cache                                                 | Fresh nonce/authorization and authoritative data checks; no new service |

A default workspace GET now verifies identity once instead of twice. Membership and business checks remain fresh. There is no process-wide user cache, Redis dependency, shared tenant key or cache around mutations, usage admission, consent or paid AI calls. Production-origin HTTP checks verified immutable asset headers and uncached nonce HTML/private APIs; deployed CDN behavior still needs checking after a host is chosen.

## Executed load test

Official checksum-verified k6 **2.3.0** was installed locally. The test requests the landing page, pricing, demo overview, leads and inbox, with realistic pauses. It ramps through 20, 50 and 100 virtual users, holds each for two minutes, then ramps down. Global, per-hold and per-step thresholds require p95 below 500 ms and failures below 1%.

The full compiled standalone-server run passed all thresholds: **28,025 requests, 0 failures, overall p95 40.42 ms**.

| Sustained virtual users | Hold duration | Requests in hold | HTTP p95 | Failure rate |
| ----------------------- | ------------- | ---------------: | -------: | -----------: |
| 20                      | 2 minutes     |            2,640 | 20.68 ms |           0% |
| 50                      | 2 minutes     |            6,572 | 29.47 ms |           0% |
| 100                     | 2 minutes     |           13,022 | 46.74 ms |           0% |

**No breaking point was found up to 100 users for this local rendering workload.** Nothing failed first. Overview was the slowest step at 100 users, with p95 48.52 ms; that does not establish a saturated bottleneck. The server and generator shared one Windows laptop. CPU/memory utilization was not measured.

There was no isolated hosted Auth/database available, so this run did not exercise login, protected workspace database reads, saves, queues or external providers. It cannot certify live 100-user or 10× capacity. The next meaningful capacity check is isolated staging with synthetic authenticated users and safe database-only writes, then a separate bounded queue test. [LOAD_TESTING.md](docs/LOAD_TESTING.md) provides exact install/run commands and results. The runner rejects production targets, redirects and missing staging guards; paid integration flags must be off.

## Host readiness and cost

There is no current host or plan to audit. [HOST_SCALING.md](docs/HOST_SCALING.md) records the statelessness review, published Render/Supabase options and limits, serverless versus persistent connection setup, and the three likely pressure points with fixes and monthly prices. Public provider documentation was checked; no account was purchased.

Sessions/customer state already persist in Supabase/PostgreSQL or signed browser cookies; no live session or upload needed moving off server memory/disk. Web, worker and pg-boss pool caps are now configurable separately. Persistent defaults stay unchanged; a declared serverless web runtime defaults its raw-SQL pool to one connection. Worker/migration sessions reject transaction pooling. Supabase REST workspace reads remain separate from the raw SQL adapter.

Priorities are the measured timeline reads/request duplication (**$0 new service**), a database connection budget (**$0 new service**, optional compute upgrade only if measured), and measured web CPU/RAM/egress headroom. For illustration, a Render second 0.5 CPU/512 MB web instance is $7/month, a vertical move from that size to 1 CPU/2 GB adds $18/month, and Supabase Micro to Small compute is about $5/month extra. Autoscaling also requires Render Pro workspace fees where applicable. These are USD list-price options, not purchases or capacity promises; see the linked report for sources, baseline fees and exclusions. No evidence requires Kubernetes or ECS.

## Regression checks

Baseline checks were run before the affected runtime/migration edits: the full local suite passed **133 tests in 11 files**, original desktop/mobile browser coverage passed **9 tests**, and focused cache, pool and query/RLS baselines passed. New migration tests verify results and tenant isolation before index creation, after creation and after rollback.

Final verification:

| Check                                 | Result                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm test`                            | **160 passed**, 15 files                                                                      |
| `npm run test:e2e`                    | **11 passed**, including desktop/mobile demo actions and actual HTTP security/cache responses |
| Compiled-production cache HTTP checks | **2 passed**                                                                                  |
| `npm run typecheck`                   | Passed                                                                                        |
| `npm run lint`                        | Passed                                                                                        |
| `npm run build`                       | Passed                                                                                        |
| `npm run check:secrets`               | Redacted source/build and available Git-history scans passed                                  |
| Paired PostgreSQL benchmark           | All **31** read shapes measured; gains and regressions retained                               |
| Full staged k6 run                    | Passed all thresholds through **100 VUs**; no breaking point found within this workload       |

The final independent code review found no actionable correctness/security
issue. Local tests use synthetic data; hosted Auth, concurrent native PostgreSQL
writers, provider accounts and deployment remain unverified.

## Check it yourself

1. Run `npm run dev`, then open `http://127.0.0.1:3000`. Follow Pricing, expand a question, and open the demo. Product pages and navigation should work.
2. In `/demo`, filter recent enquiries, select Jessica Wilson and open Inbox. Take over the conversation, type a demo reply and send it. The reply should appear locally and typing should retain focus. Demo actions must not call a paid messaging API.
3. Open Leads, create a synthetic enquiry, reload, and find it again. In Settings, change the demo business details, save and reload; the saved demo values should remain. In Calendar, request a synthetic inspection and confirm it appears in the agenda. These are browser-local demo changes.
4. On a phone or a 390-pixel browser viewport, open the navigation and visit Overview, Inbox, Leads, Calendar, Assistant, Settings and Billing. Each heading should appear and the page should fit without horizontal overflow.
5. In browser Network tools, inspect HTML and `/api/workspace`: responses must forbid shared caching. Reload twice and compare CSP nonces; they should differ. Development HTML may say only `no-store`; compiled production HTML should include `private, no-store`. On the isolated production build, hashed `/_next/static/` assets should say `public, max-age=31536000, immutable`.
6. Run `npm run db:benchmark` with builds/load tests stopped, then `node --import=tsx scripts/db-performance/render-report.ts`. Review all 31 query timings in the database report. The demo has no live database, so it cannot visibly demonstrate these SQL speedups.
7. Before deploying, apply reviewed migrations using `npm run db:migrate` with a securely configured direct/session operator connection. Then use two synthetic staging browser accounts to verify tenant isolation, session revocation and real workspace actions. Follow the authenticated staging follow-up above before making a capacity claim.

## Review and undo

All performance changes belong to one isolated Git commit. Use `git log -1 --oneline` to identify it. If migration 0007 has been applied, first review the database report's `psql` rollback procedure on a direct/session operator connection. It preserves data and migration history. Reintroduce indexes through a new forward migration. Reverting source alone does not remove database indexes.

To undo the source change, use `git revert <performance-commit>` and deploy the reviewed prior behavior. No new paid cache or infrastructure needs cancelling. No live migration or deployment was executed during this task.
