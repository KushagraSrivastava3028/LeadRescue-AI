# Scaling the existing architecture

Reviewed **2026-11-01**. The owner confirmed that LeadRescue is **not deployed**.
There is no current hosting account, selected compute plan, live database,
production usage baseline, or measured customer concurrency to inspect. No paid
service was created or resized. A claim that this app already handles 10× its
live traffic would therefore be unsupported.

The application remains a persistent Next.js web service, a separate persistent
pg-boss worker, and Supabase. No Redis, Kubernetes, ECS, new database, upload
service, or changed business workflow was introduced.

## Hosting limits: known versus unverified

Render was discussed as a possible host, not an existing deployment. These are
provider-published options checked on the review date, not limits of an account
we inspected:

| Area                       | Actual current deployment    | Possible Render + Supabase deployment                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web/worker instances       | None                         | Render supports manual replication; load-based autoscaling requires a Pro workspace or higher and must be enabled                                                                                                                                                  |
| Automatic traffic scaling  | None                         | Render balances traffic among configured instances; CPU/memory autoscaling uses configured minimum/maximum counts. It is not automatic merely because a paid service exists                                                                                        |
| Concurrency                | Not measured on hosting      | No fixed HTTP request-concurrency number is established here. Actual concurrency depends on selected CPU/RAM, Node rendering, database connections, upstream limits and workload                                                                                   |
| Function timeout           | Not applicable: not deployed | The proposed web service is a persistent Node process, not a serverless function. No plan-independent request-timeout number was verified. App provider calls already have bounded timeouts; verify the chosen host's current request/proxy behavior at deployment |
| Bandwidth                  | No usage/plan                | Render Hobby includes 5 GB/month; Pro 25 GB/month; public-internet overage is $0.15/GB. This includes service HTTP responses and outbound provider/database traffic                                                                                                |
| Filesystem                 | Source/build/test files only | Render's local filesystem is ephemeral. Do not attach a disk for app sessions or customer data; persistent disks also restrict horizontal replication                                                                                                              |
| Database connections       | No hosted project            | Supabase Nano/Micro defaults are 60 database connections, 200 pooler clients, and a default pool size of 15. These are separate limits, shared with Auth/PostgREST and other platform services                                                                     |
| Database/storage allowance | No hosted project            | Supabase Free lists 500 MB database size and 1 GB file storage; Pro starts at $25/month and includes 8 GB database disk and 100 GB file storage. Free projects can pause after inactivity                                                                          |

Sources: [Render scaling](https://render.com/docs/scaling),
[Render bandwidth](https://render.com/docs/outbound-bandwidth),
[Render ephemeral/free-service limits](https://render.com/docs/free),
[Supabase pricing](https://supabase.com/pricing), and
[Supabase compute/connection limits](https://supabase.com/docs/guides/platform/compute-and-disk).
Verify the selected account's actual dashboard limits before launch; provider
prices, resources and quotas can change.

## Statelessness review

- Identity and refresh state use Supabase and signed cookies; app processes do not
  keep a login-session map. Tenant data, consent, suppression, subscriptions,
  audit records, messages, usage reservations, OAuth ciphertext, outbox and jobs
  persist in PostgreSQL. The worker survives restart through pg-boss/outbox state.
- There are no general file uploads. Exports are bounded, authenticated responses,
  not files written into the web server's static directory. Production assets are
  immutable build output. Operational credentials belong in deployment secrets.
- A connection pool, heartbeat timing, worker identity and shutdown flags are
  process resources; losing them does not lose business records. The new identity
  memo exists only inside one read request, never in a process-wide user cache.
- Demo changes intentionally remain in the visitor's browser and are labeled
  synthetic. They are separate from live records and are not a server session.
- Replicas must share the same appropriate cookie-signing and token-encryption
  key versions. Their database/schema/provider settings must refer to the same
  environment. Never copy production data or keys into previews.

No customer state needed to be moved to a new service.

## Connection budgets implemented

`src/lib/server/providers/pool-settings.ts` makes process connection caps explicit:

| Variable                          | Default                      | Purpose                                                                             |
| --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `APPLICATION_RUNTIME`             | `persistent`                 | Explicit `serverless` changes the default raw-SQL web pool to 1                     |
| `DB_POOL_MAX`                     | 10 persistent / 1 serverless | Web raw-SQL adapter connections per process, bounded 1–50                           |
| `WORKER_DB_POOL_MAX`              | 10                           | Worker domain/provider SQL connections per process, bounded 1–50                    |
| `QUEUE_DB_POOL_MAX`               | 5                            | Additional pg-boss connections per worker process, bounded 1–20                     |
| `WORKER_DATABASE_URL`             | Falls back to `DATABASE_URL` | Optional separately permissioned direct/session endpoint for worker SQL and pg-boss |
| `DATABASE_CONNECTION_MODE`        | `direct` in example          | Declare `direct`, `session`, or `transaction` for the web connection                |
| `WORKER_DATABASE_CONNECTION_MODE` | `direct` in example          | Worker must use direct/session; transaction mode/port 6543 is refused               |
| `MIGRATION_DATABASE_URL`          | Falls back to `DATABASE_URL` | Separate operator connection; migration sessions also refuse transaction pooling    |

Defaults preserve existing persistent-process behavior. No production values were
changed. Connection acquisition remains bounded to 5 seconds; idle pool sockets
expire after 30 seconds. TLS certificate verification remains enabled in production.

Normal workspace queries use Supabase's REST Data API; they do not create a new
`pg.Pool` per browser request. Raw SQL is used for provider admission/worker work.
Pools are created once per process and reused. Application queries pass SQL text
and parameter arrays, without a persistent named prepared-statement `name`.
For node-postgres this avoids relying on a named prepared statement surviving a
shared transaction pooler. Do not add Postgres.js's `prepare:false` option to this
different driver.

For persistent Render processes use a verified direct endpoint or Supabase session
pooler. If the **web** is later deployed on serverless functions, use its transaction
pooler and `APPLICATION_RUNTIME=serverless`, normally `DB_POOL_MAX=1`. Keep the
continuously running worker on a direct/session connection. Queue installation,
polling features and migration advisory locks must not be forced through a
transaction pooler simply to reduce the connection count. Supabase's dedicated
pooler can have different prepared-statement capabilities; copy the actual
endpoint from its dashboard rather than constructing it.

An upper-bound budget for direct/session application connections is:

```text
web_instances × DB_POOL_MAX
+ worker_instances × (WORKER_DB_POOL_MAX + QUEUE_DB_POOL_MAX)
+ reserved connections for Supabase Auth/PostgREST/operators/maintenance
```

At the unchanged defaults, one web plus one worker can reserve up to **25** app
connections before Supabase overhead; ten of each could request **250**. That
would exceed a default 60-connection database. A conservative starting example,
not an applied setting, is two web instances at 3 each and one worker at 4+2:
**12** application connections plus a separately reserved platform budget. Watch
actual `pg_stat_activity`, pool waiting counts and queue age before increasing it.
For transaction pooling, client sockets and database backend slots are different
budgets; do not mistake 200 pooler clients for 200 available database connections.

Sources: [Supabase connection selection](https://supabase.com/docs/guides/database/connecting-to-postgres),
[connection-management guidance](https://supabase.com/docs/guides/database/connection-management),
and [node-postgres pooling](https://node-postgres.com/features/pooling).

## Three likely pressure points and costs

These are code/measurement-based risks, not three proven production failures.

| Likely pressure point                                                                  | First fix on this architecture                                                                                                                   | Additional monthly service cost                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant timelines sort/filter many rows and repeat identity checks                      | Four measured tenant/order indexes plus request-local identity reuse; retain exact authorization and results                                     | **$0 new service**. Indexes consume measured database disk and add write maintenance; disk overage depends on the chosen database plan                                                                                                                                    |
| Replication multiplies SQL pools and exhausts the database                             | Apply a measured connection budget, use the existing appropriate Supabase pooler, and tune web/worker caps independently                         | **$0 new service**. If measured database CPU/RAM still requires it, Supabase Micro→Small compute is approximately **+$5/month**, excluding other plan/usage charges                                                                                                       |
| Next.js rendering or memory saturates the web process; more traffic also raises egress | Keep existing immutable asset caching, deploy the compiled build, then add CPU/RAM or another web instance only when measured on the chosen plan | Render's published 0.5 CPU/512 MB instance is **$7/month**; 1 CPU/2 GB is **$25/month**, an **+$18/month** vertical increase. A second $7 instance is **+$7/month**. Autoscaling also requires a **$25/month Pro workspace** if not already present, plus running compute |

All prices are USD provider list prices checked on the review date, excluding
taxes, domain registration, email, AI, SMS/carrier, payment and other usage charges.
These are options, not purchases or promised capacity. A possible paid starting
configuration is $7 web + $7 worker + $25 Supabase Pro = **$39/month** before usage.
It is not a quote for the owner's nonexistent current plan.

Sources: [Render pricing](https://render.com/pricing) and
[Supabase compute pricing](https://supabase.com/docs/guides/platform/compute-and-disk).
Render's current compute SKU names describe CPU/RAM; older “Starter/Standard”
labels should not be assumed to be the current plan names.

No evidence requires Kubernetes or ECS. First deploy this architecture, collect
real authenticated/staging measurements, and compare the observed resource/queue
limits with the selected host's available replicas and compute sizes.
