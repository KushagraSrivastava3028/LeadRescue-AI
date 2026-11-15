# Multi-industry workspaces

LeadRescue supports U.S. service businesses with Roofing, Plumbing, HVAC,
Electrical, Landscaping, Cleaning and Pest Control presets, plus an Other / custom
services option. A preset supplies editable service names, intake questions and an
appointment label. It does not approve a business or activate any provider.

## Try it locally

1. Run `npm run dev` and open `/demo`.
2. Use **Load sample industry** in the sidebar. This explicitly replaces only
   browser-local demo data with the selected industry's sample business, enquiries,
   conversations and calendar entry. It makes no provider requests.
3. Open Leads and create a demo enquiry. The Service choices come from that
   business's configured services. Open Calendar → Agenda to see its appointment label.
4. Open Settings → Business profile. Select an industry, then click **Apply industry
   defaults** if you want its suggested services/questions/label. Selection alone
   does not overwrite those fields. Edit them and save.
5. Choose Other / custom services to configure a different service business. For
   example, use Washer repair and Dryer repair, an Appliance assessment appointment
   label, and a question about the appliance that needs attention.
6. Reload or navigate to another page to verify persistence. Editing settings does
   not rename or delete existing customer records. Only loading a sample industry
   deliberately replaces demo records.

## Real business setup and storage

Apply `supabase/migrations/0008_multi_industry.sql` with `npm run db:migrate`
before deploying the new web and worker versions. This ordinary transactional
migration follows the concurrent index migration `0007`; the repository runner
handles their different transaction requirements.

Existing profiles receive `industry=roofing`, `appointment_label=Roof inspection`
and an empty intake-question list. Existing services, leads, messages, appointments
and permissions are preserved. Leaving legacy intake questions empty avoids
silently introducing new qualification requirements for existing businesses.

The new `create_business_for_industry` RPC calls the original verified-account,
active-session and business-limit gate, then applies the selected catalog entry
inside the same transaction. The original `create_business` RPC remains available
for compatibility. New browser onboarding defaults to the custom preset and
requires the user to review business setup before activation.

The `industry_presets` table is a read-only catalog for authenticated users.
Its services/questions/labels match `src/lib/industries.ts`; tests check parity.
Profile industry, questions and appointment labels retain the existing owner-only
RLS, mutation throttling and audit trigger. Unknown industry IDs, oversized question
lists and invalid labels are rejected in the API/database. Industry selection
never grants an entitlement, trial, messaging approval or calendar connection.

If using separately restricted worker database roles, review SELECT access to the
new catalog and profile columns as part of the existing role/bootstrap procedure.
No real hosted database migration or provider activation was executed locally.

## Qualification and appointments

- Recovery SMS uses the business name and general service language, with STOP
  instructions. Consent, suppression, contact eligibility, quiet hours, human
  takeover, spending and delivery safeguards still apply.
- The `service-qualification-v2` prompt receives the tenant's canonical industry,
  approved services, ZIP codes, up to three intake questions and bounded conversation
  context as untrusted data. The model has no tools or booking authority.
- Service extraction must match the approved list. Intake answers are restricted to
  configured question keys; missing answers remain null. The deterministic reply
  asks for service, ZIP and then the first unanswered question, or requests a callback.
  Hazardous enquiries take priority and go to human review without repair instructions
  or an emergency-response promise.
- Answers are included in the lead summary and the private AI-run result for human
  follow-up. An AI response cannot confirm a booking or grant customer consent.
- Google Calendar event titles use the business's configured appointment label.
  Customer confirmation, entitlement, hours, availability and reconciliation checks
  remain required.

The existing scheduling rule is still **60-minute appointments with a 15-minute
buffer**. Variable duration/buffer settings, international phone/address support,
industry-specific pricing and regulated-sector compliance are not implemented by
this change. Custom intake questions must be reviewed for privacy and accuracy;
they are not a mechanism for collecting payment credentials or sensitive records.

## Release checks

The baseline before implementation passed 160 regression tests. Added checks cover
all presets, custom services, question progression, urgency, model prompt boundaries,
catalog parity, legacy migration preservation, owner/staff/cross-tenant permissions,
revoked-session onboarding, worker qualification and calendar titles. Browser checks
cover industry samples, persistent custom settings, enquiry options and mobile use.
Final local verification passed **183 regression tests in 19 files**, **14
desktop/mobile browser tests**, TypeScript and lint. The initial new browser
scenarios exposed a selector-label lookup issue; explicit accessible names fixed
it, and the complete browser suite then passed. The production build and redacted source/build/Git-history secret scans also passed.
No paid provider was invoked.

Before real customer activation, evaluate the pinned model on each offered
industry, test hosted Supabase/Auth and provider flows, and repeat representative
staging load. The existing historical k6 result covers public/demo rendering only.
See [remaining work](../REMAINING_WORK.md) and [launch gates](../LAUNCH_CHECKLIST.md).

## Rollback

The schema is additive. An application rollback can leave the catalog and columns
in place; do not automatically drop them, as doing so would erase business setup.
The old app and worker are roofing-specific, so pause automation for non-roofing
businesses before reverting application code. Review and reconcile already queued
work before resuming. Repair schema/configuration through a reviewed forward
migration and preserve customer records and migration history.
