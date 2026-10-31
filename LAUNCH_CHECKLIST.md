# Launch checklist

Review date: **2026-10-31**. The source and synthetic local demo do not establish
production readiness. Keep automation disabled until every applicable gate below
has evidence. `SECURITY_AUDIT.md` records executed commands and limits;
`SECURITY_CONTROL_MATRIX.md` distinguishes local passes from unverified services.

- [ ] Provision isolated staging and production Supabase projects. Apply all
      versioned migrations through an operator identity, verify RLS/grants through
      real PostgREST with two tenants and owner/staff/viewer users, and restrict the
      web/worker roles. Validate actual revoked/expired sessions, email confirmation,
      refresh/logout, password reset, SMTP deliverability, and auth rate limits.
- [ ] Enter credentials directly into ignored local env or the hosting secret
      manager. Never paste them into chat, Git, screenshots, fixtures, or build logs.
      Run the typed configuration check, scan the source/history/build with a maintained
      **redacted** scanner, and record exact scope. Rotate actual exposures at their
      provider; deleting a file alone is insufficient.
- [ ] Deploy a persistent Node web process **and** a separate persistent Node
      worker with supported PostgreSQL connectivity. Test graceful shutdown, retry,
      heartbeat, dead letters, failed FIFO-head recovery, atomic outbox publication
      and restoration after termination. A web-only serverless/Cloudflare Worker
      deployment is insufficient for this pg-boss runtime.
- [ ] Set production `APP_ORIGIN` to the exact HTTPS origin and `DEMO_MODE=false`.
      Verify actual CSP nonces/enforcement, absence of unsafe-eval, HSTS after HTTPS,
      MIME/referrer/permissions/frame policies, private/no-store caching, same-origin
      mutations and CORS. Probe only our app for `.git`, real env, backups, debug routes,
      source maps and sensitive artifacts. Validate gateway header stripping before
      enabling a trusted client-IP header.
- [ ] Bootstrap platform admins through the restricted SQL/operator procedure,
      enroll MFA, and verify server-side aal2 and recent authentication on the real
      provider. Confirm normal contractor owners cannot reach any admin API. Audit
      support access, billing/routing changes, membership changes, and last-owner
      protection. Store operational audit logs with appropriate access/retention.
- [ ] Verify the business and authorized U.S. forwarding destination. Restrict
      provider destinations/calling geography, block toll/premium/international routes,
      and enforce the approved destination list. NANP `+1` alone is insufficient.
      Assign at most the approved number count; reconcile uncertain purchases before
      retrying. Configure per-subaccount encrypted auth tokens when using subaccounts.
- [ ] Obtain Twilio messaging registration and legal/provider approval of the
      exact consent disclosure and policy version. Store sender/scope/source/time/
      expiry/evidence; never infer consent from a missed call. Validate U.S. and
      SMS-capable contact line type before a restricted operator marks `sms_eligible`.
      Confirm provider/local STOP suppression, Advanced Opt-Out HELP/confirmation,
      and the approved evidenced re-opt-in procedure. Set retention for evidence.
- [ ] Set exact signed Twilio webhook URLs. Run sandbox calls for no-answer,
      busy, failed, completed/voicemail, callback replay/reordering and routing loops.
      Verify the intended child outcome drives eligibility. Run STOP after enqueue,
      opt-out during a send, manual takeover during AI, explicit resume, stale recovery,
      quiet hours/DST, duplicate cooldown and unknown send reconciliation. Make no
      claims that in-flight provider sends can be recalled.
- [ ] Configure business services, ZIP codes, timezone, working days/hours,
      approved FAQs, escalation contacts, quiet-hour policy, assistant restrictions,
      trial/paid usage caps and pause behavior. Set
      `PLATFORM_DAILY_SMS_SEGMENT_LIMIT`. Test simultaneous quota reservation using
      multiple real PostgreSQL connections. Check conservative segment accounting
      against actual carrier/provider billing and reconcile before final allowances.
- [ ] Select a pinned OpenAI model and review its account retention/subprocessors.
      Configure conservative validated per-call/per-business/platform spending ceilings
      (`AI_MAX_CALL_COST_MINOR`, `PLATFORM_DAILY_AI_COST_LIMIT_MINOR`). Run an evaluation
      corpus covering injection, secret requests, other-tenant claims, fake tool output,
      hazardous enquiries, booking manipulation, malformed output and cost exhaustion.
      The model has extraction authority only; confirm application policy remains the
      boundary. Test prompt/model changes before release.
- [ ] Verify merchant availability/approval for the actual business entity;
      do not assume a new Stripe India account is available. Configure the approved
      recurring USD price, included allowance, first charge date, trial, overage pause
      and cancellation terms. Publish reviewed Terms/Privacy and provider checkout
      terms. Set `BILLING_LIVE_APPROVED` only after approval, not as a substitute for it.
      Test hosted checkout/portal in test mode, subscription reconciliation, positive
      paid periods, zero trial invoices, failed/auth-required payments, duplicates,
      reordered events, renewals, cancellation and refund/dispute holds. Verify no
      checkout URL or client flag grants paid access and no cap charges early.
- [ ] Record business verification and a successful actual activation test before
      starting its single 14-day trial. Verify repeat identity/destination denial,
      approved support override, reminders, expiry, payment failure and usage caps.
      Essential routing, suppression, account/export access must continue when
      automation pauses. Test number retention and offboarding explicitly.
- [ ] Configure Google OAuth with exact allowlisted callback, verified consent
      screen and the two requested scopes. Generate encryption keys securely, store
      separately from ciphertext, and rehearse tenant-bound key rotation/recovery.
      Test state/PKCE tampering, expired cookies, wrong owner, revoked refresh token,
      DST, opening days/hours, 60-minute duration, 15-minute buffers, customer evidence,
      stale availability, duplicate jobs and provider-created/local-failed results.
      Reconcile deterministic event IDs and preserve unknown reservations. Account for
      external calendar writers; never promise perfect external conflict prevention.
- [ ] Monitor queue age/failed heads, webhook failures, registration and suppression
      drift, unknown sends/bookings, entitlement sync lag, usage and spending. Route
      alerts to an approved operator channel. In-app notifications alone do not prove
      someone will respond. Rehearse provider outage and automation kill-switch drills;
      verify sticky risk/admin holds require explicit audited clearance.
- [ ] Configure encrypted backups, least-privilege access, private exports,
      retention/deletion jobs and legal holds. Restore a backup into an isolated
      environment and record timing, integrity checks, schema version and recovery
      point. Run a deletion/export drill with synthetic data. No restore has been
      tested merely because a procedure is documented.
- [ ] Run production build, typecheck, lint, tests, redacted secret scanning and
      current dependency audit on the final source state. Fix critical/high issues
      and add regressions. Record exact commit provenance, tool versions, results,
      skipped checks and residual risks. Validate install scripts, source/artifact
      exposure, CI token permissions and artifact retention. Never force-upgrade or
      suppress findings only to achieve a clean report.
- [ ] Run representative load in authorized staging with stated workload,
      concurrency, dataset, hardware/runtime, queue/DB settings and mocked versus
      real provider boundaries. Measure latency, failed/retried jobs, cap races,
      memory and DB pressure. Synthetic/mock load is not proof of 1,000 live
      businesses or real provider/carrier throughput. Obtain an independent security
      review before a broad customer launch and resolve its findings.

Enable capabilities one at a time after the corresponding gates pass. Preserve
separate staging/production resources and callback URLs. No real unsolicited SMS,
live card charges, customer system mutation, or third-party flooding is part of
the local automated test suite.
