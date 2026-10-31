# LeadRescue

A Next.js application for eligible missed-call recovery for U.S. roofing teams, built from the supplied specification and visual references. Includes a usable synthetic demo, Supabase-backed account/workspace APIs, signed provider webhooks, and a separate durable PostgreSQL worker.

**Local implementation is verified; live services are not activated.** No real messages, charges, calls, emails, or calendar bookings were performed. Production setup requires the credentials, approvals, and acceptance tests in [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md). Terms and Privacy are explicitly marked drafts.

## Run the demo

Use Node 24 LTS (the development checks here used Node 26.8.1), npm, and the committed lockfile:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000** for the product site, or **http://127.0.0.1:3000/demo** for the workspace. No environment file is required to explore the demo. It includes working lead filters, conversation selection, human takeover/resume, local replies, lead creation/status updates, callback tasks, inspection requests, calendar agenda, settings, exports, and billing previews. All demo changes stay in browser storage; the Help dialog can reset them. Demo actions never send provider requests. The real `/app` route always requires verified Supabase identity and membership.

Public routes: `/`, `/pricing`, `/signin`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/two-factor`, `/privacy`, `/terms`. Workspace routes under `/demo` or `/app`: overview, `/inbox`, `/leads`, `/calendar`, `/assistant`, `/settings`, `/billing`. `/admin` and its API require separately bootstrapped platform authority and verified MFA. `/invite` and `/confirm-inspection` use short-lived recipient links with tokens in URL fragments, then explicit POST actions.

## Connect a development workspace

1. Copy `.env.example` to ignored `.env.local` using your editor. Enter real credentials **only** locally or in your hosting secret manager. Never paste them into chat or commit them. Set `APP_ORIGIN` exactly to `http://127.0.0.1:3000` for local development. Do not mix localhost and 127.0.0.1 origins.
2. Create a separate development Supabase project, enable email confirmation, configure SMTP, and set its URL, publishable key, service-role key, and a securely generated 32+ character `AUTH_COOKIE_SECRET`. Supabase stores passwords; the app has no custom credential database.
3. Apply `supabase/migrations/*.sql` in order through an operator session. With the Supabase CLI and Docker installed, `supabase start` then `supabase db reset` applies the local migrations and inactive synthetic seed. For a remote project use the Supabase CLI migration workflow or `npm run db:migrate` with an authorized migration connection. The migration runner records checksums and commits each migration and its ledger record atomically. Hosted migration/restore remains unverified here; Docker was unavailable on this machine.
4. Set Supabase Site URL and exact redirect allowlists to your configured origin and `/auth/callback`. For password recovery, use a provider email template linking to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. This verified recovery path issues the short-lived HttpOnly reset grant. Do not substitute an arbitrary return URL. Confirmation token query parameters are inherent in the provider email protocol; redact them from reverse-proxy logs.
5. Run `npm run check:env`. Create and verify an account, then create its business with service ZIP codes and timezone. Settings supports business facts, weekday hours, FAQs, restrictions, team invitations, MFA enrollment, phone setup, and Google Calendar connection. Owners alone manage sensitive settings; staff handle enquiries; viewers read. An owner must confirm a won job.
6. Set a restricted worker `DATABASE_URL`, then run `npm run worker` in a separate terminal. Worker `/health` on port 3001 is internal. Do not expose this port publicly. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for exact provider variables, callbacks, queue behavior, and reconciliation.

Optional integrations are disabled until their explicit enable flag and required variables are set. Enabled integrations never fall back to synthetic success. A missing credential returns a safe unavailable result. Production startup rejects missing/placeholder auth configuration, HTTP/loopback origins, and `DEMO_MODE=true`.

## Provider activation

- **Twilio:** assign a dedicated approved subaccount and encrypted token through the restricted operator procedure, approve a verified U.S. forwarding destination, configure signed voice/Dial-action/SMS/status URLs, complete messaging registration, and validate geography/line type. Settings can request a number and place an authorized destination-verification call; neither action grants routing or registration approval. Uncertain purchases block retry until reconciled.
- **Consent:** a missed call is never consent. Operators must validate the approved disclosure/evidence, sender/scope, country and SMS capability before automation can send. STOP revokes/suppresses queued work. Missing consent creates a callback opportunity. The consent API stores an evidence-review request, not an unverified permission grant.
- **AI:** enable a selected pinned OpenAI snapshot and reviewed per-call/platform cost limits. It extracts facts only; it has no tools, booking authority, or tenant selector. Replies use bounded application templates. Real model evaluation and account retention review are launch gates.
- **Billing:** the initial configurable plan is $299 USD/month, 500 outbound segments and 500 AI replies; the trial is 14 days with 100-segment/AI allowances. Verify the provider price matches reviewed product terms. Merchant approval is required, including actual India-entity availability where applicable. Checkout requires explicit recurring terms; only verified provider state enables paid usage. Overage charging is off. Trial activation requires business/phone verification, messaging approval, and a successful real test; the browser cannot set these flags.
- **Calendar:** Google OAuth uses exact callback/state/PKCE and two narrow scopes, with tenant-bound AES-GCM refresh-token encryption. The team requests a slot, then shares a private link for the customer's explicit confirmation. A booking remains requested/pending until provider creation and local persistence succeed. Unknown outcomes retain the slot for reconciliation. Current inspections are 60 minutes with a 15-minute buffer.

The operator steps, APIs, SQL boundaries, and external acceptance procedure are detailed in [docs/DATABASE.md](docs/DATABASE.md), [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md), and [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md). There is no browser switch that declares a business verified or a messaging policy approved.

## Deployment: web and worker

Run on a Node/container host with PostgreSQL connectivity and persistent worker processes. The full application is **not** published to Sites/Cloudflare Workers: its Node pg-boss worker and PostgreSQL transport require a compatible host. No live customer system was modified. Docker targets and Compose are provided, but a Docker build/deployment was not executed here.

```sh
npm ci
npm run check:env -- --production --worker
npm run build
npm start
# Separate process/deployment:
npm run worker
```

Or use `docker compose up --build -d` after securely creating `.env.local`. Compose binds web only to loopback; put a configured HTTPS reverse proxy in front. Deploy the `web` and `worker` Docker targets as separate services. Both run without root; runtime production variables come from the secret manager, not build arguments. Keep staging/prod databases, provider subaccounts, callback URLs, and secrets separate.

Use a migration-only identity for DDL/backups and distinct restricted runtime identities. Normal web reads/writes use the authenticated Supabase client and RLS. Direct provider/worker SQL is privileged and explicitly tenant-scoped. Before deployment, provision and review the worker's table/function/schema grants (including private queue/cost records and its pg-boss schema), RLS bypass, certificate-verified TLS, and the supported direct/session pooler. Do not use the database superuser as runtime identity or assume `GRANT service_role` alone inherits BYPASSRLS. The exact restricted-role/bootstrap and pooler setup must be tested against the chosen Supabase project.

`/api/health` reports web liveness without secrets; worker `/health` reports recent database/outbox ticks. Monitor webhook errors, queue age, failed FIFO heads, unknown sends/purchases/bookings, usage, registration/suppression drift, billing reconciliation, and operator response. Roll back application images to a verified prior source version; database rollback requires a reviewed forward repair or isolated provider restore. Never automatically reverse destructive migrations. See [SECURITY.md](SECURITY.md) for incident handling and [docs/DATABASE.md](docs/DATABASE.md) for the unexecuted restore drill.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e  # start the local web server first; uses synthetic data only
npm audit --audit-level=high
npm run check:secrets
```

Playwright requires its matching Chromium: `npx playwright install chromium`. Gitleaks must be installed from its official checksum-verified release; the PowerShell wrapper also recognizes `.cache/gitleaks/gitleaks.exe`. Source, production browser/server artifacts, and all available Git refs are scanned with full redaction. Narrow documented allowlists cover known private Next-generated keys and an exact synthetic fixture; production browser bundles remain eligible. Never upload scanner reports or env files as CI artifacts. Enable the supplied pre-commit hook with `git config core.hooksPath .githooks` after installing Gitleaks. CI has read-only repository permissions and does not deploy or access production secrets.

The SQL suite runs real PostgreSQL in PGlite with synthetic Supabase Auth interfaces; it does not verify hosted JWT/GoTrue, multiple TCP connections, real providers, or managed backups. Browser tests verify desktop/mobile demo behavior, inert untrusted text, actual local response headers, CSRF failures, protected pages, and private-file HTTP exposure. [SECURITY_AUDIT.md](SECURITY_AUDIT.md) records exact final results, failed attempts and limitations. Complete the staging/live acceptance checklist before inviting real customers.

Current dependency review: the runtime-only audit reports no known vulnerabilities. The full graph reports 16 moderate findings in development lint dependencies; no force downgrade or incompatible override was applied. See SECURITY_AUDIT.md for the advisory and remediation limits.
