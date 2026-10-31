# Integrations and worker operations

All fixtures are synthetic. Provider code is implemented; no production provider
credentials, real SMS delivery, live payment, hosted calendar write, or TCP worker
deployment was tested in this build. Never label the demo as a connected account.

## Queue decision

Use **pg-boss 12.38.0**, a maintained PostgreSQL durable queue. BullMQ is a strong
alternative with retries and Redis persistence, but would add a separately operated
store and require an outbox-to-Redis publisher. PostgreSQL already stores our
events. pg-boss accepts the existing SQL transaction for queue publication, so the
outbox's processed marker and durable job commit together. Hosting must support
a long-running Node worker and PostgreSQL connections. No Redis Pub/Sub is used.

`key_strict_fifo` with `business:<uuid>` serializes every business's jobs across
workers; different businesses can progress independently. Business ordering is a
deliberately conservative MVP tradeoff. Retries use backoff and a five-retry cap.
A permanently failed head blocks its business until an operator investigates and
retries it. Dead-letter records and `job_attempts` retain the evidence. Jobs hold
identifiers, never provider credentials. Provider clients stay server-only.

An external HTTP side effect cannot be atomically committed with PostgreSQL.
SMS send intents are stored before dispatch; timeouts and crash-interrupted sends
become `unknown`, keep their usage reservation, and are never blindly resent.
Signed callbacks contain the intent ID so callbacks can reconcile a send even if
the provider ID was not persisted yet. Review provider logs for unresolved cases.

## Start the worker

Run migrations first. Set secrets in ignored `.env.local` or the deployment's
secret manager. Never paste secrets into chat or put them in source control.

```sh
node --conditions=react-server --import=tsx src/worker/index.ts
```

The worker loads `.env.local` when it exists. `DATABASE_URL` is a server-only
PostgreSQL connection for the worker's restricted database role; it must have the
documented grants and RLS bypass needed for its explicit tenant-scoped queries.
Production requires TLS certificate validation. Use a supported direct/session
pooling endpoint; validate the chosen pooler with pg-boss before launch. Queue
migrations need a separate operator role if the runtime role cannot create the
`pgboss` schema. Run both web and worker; a web-only serverless deployment cannot
run this worker. Worker `/health` on `WORKER_HEALTH_PORT` (default 3001) returns only
availability based on recent successful database/outbox ticks. Keep it internal.

Optional integrations are disabled unless their `*_ENABLED` flag is exactly
`true`. The production worker refuses `DEMO_MODE=true`. No real integration falls
back to a mock. Configure `PLATFORM_DAILY_SMS_SEGMENT_LIMIT` before dispatch;
quota reservation is atomic per tenant plus a shared platform daily circuit breaker.

Offline operator utility (do not expose through a public route):

```sh
node --conditions=react-server --import=tsx src/worker/operate.ts inspect BUSINESS_UUID
node --conditions=react-server --import=tsx src/worker/operate.ts retry BUSINESS_UUID JOB_UUID
```

Use an audited operator session with `OPERATOR_MAINTENANCE_ENABLED=true` and
`OPERATOR_ID` set, plus restricted worker credentials. Only the exact failed job
whose durable outbox belongs to that business can be retried. The operation is
audited; unknown SMS sends remain non-retriable at the dispatch layer. A retry is
not a substitute for investigating the failure or reconciling external effects.

## Twilio voice and SMS

Configure `TWILIO_ENABLED`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and exact
`TWILIO_WEBHOOK_ORIGIN`. Configure these POST callbacks in the provider account:

| Endpoint                                          | Purpose                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `/api/webhooks/twilio/voice`                      | Signature-check and durably persist parent; promptly return Dial TwiML |
| `/api/webhooks/twilio/call-status`                | Dial action; persist the forwarded child outcome                       |
| `/api/webhooks/twilio/sms`                        | Inbound texts; synchronous durable STOP suppression                    |
| `/api/webhooks/twilio/message-status?intent=UUID` | Signed delivery callback set on each send                              |

Account SID and receiving number map through trusted `provider_accounts` and
`phone_numbers`; no browser, model, message-body business ID, or unsigned callback
can select the tenant. Subaccounts need their own encrypted account auth token.
Never validate a subaccount signature using an unrelated parent token. Signature
validation uses the exact configured external URL and untouched form parameters.
Duplicate form keys are rejected. Twilio signatures do not include a timestamp;
we do not invent a freshness requirement. Composite SHA-256 identities cover the
signed callback type, query, and full sorted parameter set. SQL deduplicates them.
Signed admission has a shared database limit of 2,400 events/minute/number;
calibrate provider retry/burst capacity and gateway limits in staging.

Parent calls and Dial child legs are separate. Only explicit `busy`, `no-answer`,
`failed`, or `canceled` child outcomes request recovery. A completed leg may be
voicemail, and must never be advertised as a confirmed human answer. There is no
voicemail detector in this MVP. There are no automated repeat no-response nudges.
Forwarding requires destination ownership verification, approved geography and a
non-looping destination. NANP `+1` is **not proof of U.S. geography**. Restrict
destinations in the owner API and provider account to operator-approved U.S.
numbers and disable premium/international destinations before enabling routing.

Every outbound SMS, including manual messages, rechecks consent for that sender,
scope, expiry and revocation; suppression; approved messaging registration;
contact `sms_eligible`; quiet hours in the tenant timezone; TTL; mode/takeover;
subscription/trial entitlement; duplicate cooldown; and atomic segment budgets.
`contacts.sms_eligible` defaults false: a restricted operator must verify U.S.
country and SMS-capable line type through approved provider lookup/evidence.
A missed call or arbitrary inbound text never creates consent. Record approved
disclosure, source, scope, sender, timestamp, policy version and minimal evidence
in `consents`. Provider/legal approval of that process remains a launch gate.

STOP and provider error 21610 persist suppression, revoke existing consent, and
suppress pending sends before HTTP acknowledgement. Require Twilio Advanced
Opt-Out for provider-managed STOP/HELP responses; the app sends no duplicate
confirmation. START does not clear local suppression. Explicit approved re-opt-in
and evidence are required. The worker rechecks again immediately before the
network call. Messages already in flight cannot be recalled after a concurrent
STOP; staging must verify provider-side suppression behavior. A 30-second dispatch
lease prevents a takeover reporting success while a dispatch is in flight; the
owner must retry after the lease. No database transaction stays open over a
provider network call. Manual sends are limited to 480 characters. Segment
reservation conservatively uses UCS-2 67-character segments, so included usage is
not understated; reconcile exact billed segments before choosing allowances.

## OpenAI qualification

Set `AI_ENABLED=true`, `OPENAI_API_KEY`, an explicitly selected `OPENAI_MODEL`
snapshot, `AI_MAX_CALL_COST_MINOR`, and
`PLATFORM_DAILY_AI_COST_LIMIT_MINOR`. Validate the configured conservative maximum
call cost against the selected model's current pricing and bounded input/output.
Per-business budgets live in `entitlements`. The shared daily reservation includes
unknown outcomes; there is no cost-free retry after a timeout.

Prompt version is `roof-qualification-v1`. The Responses API uses `store:false`,
structured schema output, max 450 output tokens, at most 12 messages of 1,600
characters, and eight qualification turns. The model receives only approved
services/ZIPs and this business's conversation. It has **no tools**, credentials,
tenant selector, arbitrary network access, billing authority, or booking authority.
Runtime strict validation rejects extra fields; service qualification is checked
against the approved list. Model free text is displayed through React escaping;
outbound questions are deterministic application templates. Hazard flags notify
the team without promising emergency response. Qualification never means a booked
job or recovered revenue. Review subprocessors/retention in the actual provider
account; `store:false` is not a claim of zero provider retention. Evaluate the
actual pinned model on adversarial and ordinary transcripts before launch; mocked
schema tests do not establish production model behavior.

## Stripe billing

Set `BILLING_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`STRIPE_PRICE_ID`. Only use a merchant-approved account; India merchant
availability/approval is an external prerequisite. Live keys in production also
require `BILLING_LIVE_APPROVED=true`; this flag is an operator gate, not proof of
merchant approval. Verify the configured provider price matches approved business
pricing/allowances. Checkout/portal never collect raw card data through our app.

`PLAN_MONTHLY_PRICE_MINOR` defaults to 29900 USD cents;
`PLAN_PAID_SMS_LIMIT` and `PLAN_PAID_AI_LIMIT` default to 500. The server validates
integer bounds and exposes only these safe business settings through `planSettings()`.
Before checkout and reconciliation, the actual Stripe Price must match its
configured ID, USD minor amount, monthly interval/count one, licensed per-unit
quantity one, and have no custom amount or quantity transform. Checkout disables
adaptive currency conversion and checks an open session's actual line items before
reuse. A mismatch pauses automation and requires operator correction; no paid grant
is inferred from a mismatched payment configuration.

Migration `0006_plan_entitlements.sql` stores a protected trial/paid marker. The
first verified positive paid activation replaces trial limits with the approved
paid allowance and resets counters once. An actual new provider period applies
the then-approved settings and resets once. Same-period reconciliation preserves
already granted caps and usage; an environment setting change alone does not
silently alter a running paid period. Scheduled reconciliation never advances the
provider-event timestamp watermark with the application clock.

`POST /api/webhooks/stripe` verifies original bytes with the SDK and a 300-second
tolerance, durably stores supported events, and acknowledges only after commit.
The worker fetches current provider subscription state, verifies the configured
price and positive paid USD invoice, and mirrors entitlements. Checkout return
URLs, client flags, subscription creation, and zero-value trial invoices grant no
paid access. Older event timestamps do not roll state backward. Reconciliation
runs at least every six hours via the durable outbox. Past-due/unpaid/canceled or
risk events pause automation; forwarding and opt-out admission remain available.
Checkout with less than 48 hours of a trial remaining is rejected until expiry
rather than shortening a promised trial. A provider or communication failure never
shows a fake payment-success state. Verify refund/dispute and authentication-required
events for the actual approved account/API version during live sandbox acceptance.

## Google Calendar

Set `CALENDAR_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, exact
`GOOGLE_REDIRECT_URI=APP_ORIGIN/api/calendar/callback`, a base64 32-byte
`TOKEN_ENCRYPTION_KEY`, and `TOKEN_ENCRYPTION_KEY_VERSION`. Generate the key locally
in a secure terminal and transfer directly to the secret manager; do not print it
into chat, build output or screenshots. OAuth uses exact redirects, state and
PKCE, an owner/recent-auth boundary, and these scopes only:

- `calendar.events.owned` to manage events on the owner's calendar.
- `calendar.events.freebusy` to check availability.

Only the primary calendar is connected in this MVP. Refresh tokens use Node's
AES-256-GCM with a random nonce and tenant/key-version authenticated data. Keep
keys separate from ciphertext. Before rotation, retain the old key under a
restricted operator migration, decrypt/re-encrypt each tenant token to the new
version, verify a staging refresh, and then retire the old key. The app rejects
unknown key versions; do not change the active version before re-encryption.

Bookings require an explicit customer confirmation evidence path. A request alone
remains `requested`. Before create the worker reserves against overlapping app
bookings under a tenant lock, checks 60-minute duration, business opening hours,
IANA timezone/DST, a 15-minute buffer, and current provider free/busy. A deterministic
provider event ID permits reconciliation after a timeout; existing matching events
are checked before free/busy so a retry can recognize its own event. Only provider
success plus local persistence yields `confirmed`/`booked`. Failure is `unknown`
and triggers human review. External calendar writers can still introduce a race;
there is no claim of perfect external concurrency protection.

## Verified local checks and external acceptance

`tests/domain-recovery.test.ts` and `tests/domain-webhooks.test.ts`: 20 passing
local checks using real signature SDKs, synthetic records, and mocked provider
HTTP. `tests/domain-queue.test.ts`: four passing pg-boss/PostgreSQL WASM integration
checks for transaction rollback, stable-ID replay, per-business FIFO, and worker
restart. Initial test startup required Windows process escalation after sandbox
EPERM. Queue test setup initially failed on syntax and an unsupported zero monitor
interval; corrected and rerun successfully. TypeScript passed after using the
installed pg-boss named export. Root's final audit records subsequent overall
validation. These do not establish TCP/hosted concurrency, provider throughput,
real delivery, merchant approval, production model safety, or calendar success.

`tests/domain-worker.test.ts` additionally runs complete worker handlers against
the migrated PostgreSQL WASM schema with only external provider calls mocked.
It checks successful durable intent/usage, STOP and no-consent withholding,
takeover before dispatch and during AI, provider-unknown no-resend, canceled/
expired work, event deduplication, sticky billing/admin holds, zero trial invoices,
same-period cap preservation, one-time renewal reset, and canceled queued booking.
The final root audit records the final test count after all source changes.

Before launch, run signed sandbox callbacks with duplicate and reordered delivery,
restart the separate worker during outbox publication and unknown send outcomes,
test STOP after enqueue and in flight, take over during qualification, revoke
calendar OAuth and reconcile a timeout, and validate invoice failure/renewal/cancel
against two isolated staging tenants. Run a real PostgreSQL multi-connection quota
race and representative load workload with the chosen provider limits. No real
unsolicited SMS, live charge, or third-party load test is authorized by test setup.

Official documentation consulted:

- [pg-boss queue policies](https://pgboss.io/api/queues)
- [pg-boss workers](https://pgboss.io/api/workers)
- [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [Stripe webhook signature troubleshooting](https://docs.stripe.com/events/manage-webhook-endpoints)
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
