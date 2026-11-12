# LeadRescue — remaining work before customer launch

Prepared: **12 November 2026**.

The application, integration adapters, security controls and scaling changes are
implemented and tested locally. Deployment and real service activation have not
been verified. This checklist records the remaining work from the repository and
the last confirmed project status; it does not certify any external account.

Supabase, Stripe, Twilio, OpenAI and Google Calendar integration code already
exists. The work below connects, configures and verifies those integrations.
Mark an item complete only after recording evidence from the relevant environment.

## 1. Set up Supabase and account emails

- [ ] Create separate staging and production Supabase projects.
- [ ] Configure the Supabase URL, publishable key and server-only service-role key
      through ignored local configuration or the hosting secret manager.
- [ ] Create restricted web/worker database identities and a separate migration
      operator identity; verify their actual grants.
- [ ] Apply all versioned migrations, including `0007`, using `npm run db:migrate`
      through a direct/session operator connection. Concurrent indexes must run
      outside a transaction. Follow [migration instructions](docs/DATABASE_PERFORMANCE.md).
- [ ] Configure email confirmation, SMTP delivery, Site URL, callback allowlists
      and the password-recovery email template described in [README.md](README.md).
- [ ] Test signup, verification, signin, refresh, logout, password reset, revoked
      sessions and MFA against the real staging Auth service.
- [ ] Test two businesses with owner, staff and viewer accounts through actual
      HTTP/PostgREST requests; verify tenant isolation and permission denial.

**Complete when:** real staging users can use their own workspace and cannot
access another business or exceed their role permissions.

## 2. Deploy staging, then production

- [ ] Choose a Node-compatible host and inspect the selected plan's actual limits
      and costs. See [hosting and connection budgets](docs/HOST_SCALING.md).
- [ ] Deploy the Next.js web service and a separate persistent pg-boss worker.
- [ ] Set database pool caps to fit the project's connection budget. Workers and
      migration sessions must use direct/session connections, not transaction pooling.
- [ ] Purchase/connect the selected domain, configure DNS and enable HTTPS.
- [ ] Set the exact `APP_ORIGIN` and environment-specific callbacks; keep
      `DEMO_MODE=false` and `LOAD_TESTING_ENABLED=false` for ordinary production.
- [ ] Generate and securely store cookie-signing and token-encryption keys. Use
      consistent key versions across replicas and document recovery/rotation.
- [ ] Keep worker health endpoints private; verify web/worker health, restart,
      graceful shutdown, durable jobs, retry and interrupted-job recovery.
- [ ] Verify actual HTTPS/security headers, fresh CSP nonces, private-response
      caching, immutable static assets and denial of private repository/config files.
- [ ] Verify gateway handling of client-IP headers before enabling trusted proxy
      settings; confirm real authentication and mutation rate limits.
- [ ] Verify the chosen deployment method. Docker files exist, but a Docker
      build/deployment has not been verified locally.

## 3. Activate phone and SMS recovery with Twilio

- [ ] Configure the Twilio account/subaccount, credentials and approved phone number.
- [ ] Verify the business and authorized U.S. forwarding destination; configure
      destination/geography restrictions and SMS-capable contact validation.
- [ ] Complete applicable messaging registration and provider approval.
- [ ] Review and approve consent collection, evidence, retention and re-opt-in
      procedures. A missed call alone does not authorize an SMS.
- [ ] Configure exact signed voice, SMS and status webhook URLs for each environment.
- [ ] Test forwarding, busy/no-answer/failed/completed outcomes, voicemail behavior,
      duplicate callbacks and routing-loop prevention with authorized test numbers.
- [ ] Test STOP/HELP handling, suppression after enqueue, quiet hours, human
      takeover/resume, stale jobs, quota limits and uncertain-send reconciliation.
- [ ] Verify provider/local suppression synchronization and number offboarding rules.
- [ ] Enable `TWILIO_ENABLED` only after the applicable checks pass.

## 4. Activate AI qualification

- [ ] Configure the OpenAI API account/key and an approved pinned model.
- [ ] Validate per-call, per-business and platform spending ceilings against the
      selected model; configure account spending alerts and limits where available.
- [ ] Run real-model evaluations for incorrect facts, prompt injection, sensitive
      data requests, other-business claims, malformed output and booking manipulation.
- [ ] Review data retention/subprocessors and approved business facts/templates.
- [ ] Confirm the model remains limited to extraction and application-controlled
      responses, then enable `AI_ENABLED` after acceptance testing.

## 5. Activate Stripe subscriptions

- [ ] Confirm merchant eligibility and approval for the actual business entity.
      If Stripe cannot support it, selecting another processor requires integration work.
- [ ] Configure the recurring price, currency, included allowances, trial terms,
      first-charge timing, cancellation and usage-limit behavior.
- [ ] Configure server-side Stripe credentials and the signed webhook endpoint.
- [ ] Test checkout, customer portal, positive paid periods, zero-value trial
      invoices, failed payments, renewals, cancellation and refund/dispute holds.
- [ ] Test duplicate/reordered events and verify that a success URL or browser flag
      cannot grant paid access or reset usage allowances.
- [ ] Verify business/phone activation prerequisites before starting the one-time
      trial; test expiry, repeat-trial denial and automation pause behavior.
- [ ] Publish reviewed checkout terms and complete payment acceptance before
      enabling live billing or setting `BILLING_LIVE_APPROVED`.

## 6. Activate Google Calendar bookings

- [ ] Configure Google Cloud OAuth credentials, consent screen, requested scopes
      and exact environment-specific callback URLs; complete any required approval.
- [ ] Connect a real staging calendar and verify encrypted refresh-token storage,
      refresh, revocation and a rehearsed key-rotation/recovery procedure.
- [ ] Test customer-confirmation links, business hours, timezones/DST, 60-minute
      inspections, 15-minute buffers, overlaps and stale availability.
- [ ] Test duplicate jobs and provider-success/local-failure reconciliation;
      uncertain outcomes must retain reservations for review.
- [ ] Enable `CALENDAR_ENABLED` after acceptance. A request must not appear as a
      confirmed booking before provider success and local persistence.

## 7. Finish production security and operations

- [ ] Bootstrap platform operators through the restricted procedure, require MFA,
      and verify that contractor owners cannot access platform admin APIs.
- [ ] Test audit records, last-owner protection, session revocation and sensitive
      actions requiring recent authentication against the hosted services.
- [ ] Review the previously recorded **16 moderate development-tool dependency
      findings** and rerun a current dependency audit. Fix or document remaining risk;
      do not treat the historical runtime audit as current evidence.
- [ ] Obtain an independent security review before a broad customer launch and
      address its findings.
- [ ] Configure queue/webhook/provider failure monitoring, unknown-outcome review,
      spending alerts and an operator response channel. Notifications currently
      persist in-app; external notification delivery is not implemented.
- [ ] Rehearse provider outages, automation kill switches, sticky risk/admin holds
      and manual reconciliation without losing consent/suppression protections.
- [ ] Configure encrypted backups and test an isolated restore; record recovery
      time, recovery point and data integrity.
- [ ] Approve retention/deletion policies, implement the required scheduled jobs,
      and test private export, deletion, legal holds and offboarding.
- [ ] Review and finalize the draft Terms of Service and Privacy Policy, including
      billing, messaging consent and processor/data-handling disclosures.

## 8. Complete hosted scaling verification

- [ ] Inspect the actual database's frequent/slow queries using the included
      [read-only inspection helper](scripts/db-performance/inspect-live.ts), using
      `pg_stat_statements` when available.
- [ ] Measure important reads on representative staging data before/after the
      indexes; verify concurrent builds and rollback with native PostgreSQL writers.
- [ ] Observe existing index counters over a meaningful workload window before
      proposing removal. Zero recorded scans alone does not justify dropping an index.
- [ ] Investigate broad message exports and exact counts, which remained expensive
      and had slower paired medians in the local benchmark. Review pagination/count
      changes separately if staging measurements justify them.
- [ ] Extend/run staging load with synthetic authenticated users, protected
      workspace reads and safe database-only saves. Keep paid providers mocked or off.
- [ ] Run bounded worker/queue and multi-connection quota-race tests; measure queue
      age, retry/failure rate, database/pool waits, CPU, RAM and storage pressure.
- [ ] Record the selected host/plan's actual concurrency, timeout, bandwidth,
      connection and storage limits; tune caps and replicas to the measured budget.
- [ ] Verify the deployed CDN cache behavior and confirm that users' private
      responses never share a cache entry.
- [ ] Record capacity limits and fixes before claiming production 100-user or 10×
      readiness. Follow [load-test setup](docs/LOAD_TESTING.md); never load-test production.

## 9. Final release and controlled activation

- [ ] Run typecheck, lint, regression tests, browser tests, production build,
      redacted source/history/artifact secret scanning and dependency audit on the
      exact release commit. Record results and any skipped checks.
- [ ] Complete a staging customer journey: verified signup → business setup →
      authorized test call → eligible consented follow-up → qualification → human
      takeover → customer-confirmed inspection → verified subscription state.
- [ ] Configure business services, ZIP codes, timezone, hours, FAQs, escalation
      contacts, quiet hours, assistant restrictions and reviewed usage limits.
- [ ] Record provider acceptance, recovery procedures, remaining limitations and
      the operator responsible for monitoring.
- [ ] Release production and activate capabilities individually after their gates
      pass; verify the deployed application and monitor initial usage.

## Existing evidence and detailed procedures

The previous local verification passed **160 regression tests**, **11 browser
tests**, build, typecheck, lint and redacted secret scans. The public/demo k6 run
passed through **100 virtual users** with **28,025 requests and zero failures**.
Those results do not cover real hosted Auth, database writes or provider throughput.

- [Full launch acceptance checklist](LAUNCH_CHECKLIST.md)
- [Provider configuration and behavior](docs/INTEGRATIONS.md)
- [Security control status](SECURITY_CONTROL_MATRIX.md)
- [Security review and historical dependency findings](SECURITY_AUDIT.md)
- [Scaling results and limitations](SCALING_REPORT.md)
- [Configuration variable template](.env.example)

No new Redis service, Kubernetes deployment or ECS migration is required by the
current measured work. Reassess infrastructure only when actual hosted limits
justify it.
