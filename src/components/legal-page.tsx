import Link from 'next/link';
import { Brand } from './brand';
export function LegalPage({ type }: { type: 'privacy' | 'terms' }) {
  return (
    <div className="legal-page public-width">
      <Brand />
      <Link href="/" className="text-link">
        ← Back to home
      </Link>
      <span className="eyebrow">DRAFT · BUSINESS AND LEGAL REVIEW REQUIRED</span>
      <h1>{type === 'privacy' ? 'Privacy notice' : 'Terms of service'}</h1>
      <div className="notice amber-notice">
        This is an implementation placeholder. The operator must approve and publish final terms,
        contact details, retention periods, subprocessors, and disclosures before accepting real
        customers.
      </div>
      {(type === 'privacy'
        ? [
            [
              'Information processed',
              'The service processes business account details, missed-call metadata, customer phone numbers, SMS conversations, consent records, appointments, and billing-provider identifiers to deliver missed-call recovery. Payment-card details stay with the hosted billing provider.',
            ],
            [
              'Service providers',
              'The proposed stack includes Supabase, Twilio, OpenAI, a hosted billing provider, and Google Calendar. The operator must verify the actual provider agreements, regions, security settings, and retention practices before launch.',
            ],
            [
              'Retention and rights',
              'Final retention periods, deletion/export procedures, jurisdiction-specific rights, and a verified privacy contact must be supplied by the business. Do not submit sensitive personal information in SMS.',
            ],
            [
              'Messaging choices',
              'Automated messages require an appropriate documented consent basis. STOP and supported provider opt-out signals suppress further automated sending. A missed call alone does not establish consent.',
            ],
          ]
        : [
            [
              'Service and eligibility',
              'LeadRescue assists roofing businesses with eligible missed-call follow-up. The contractor remains responsible for the accuracy of its approved business facts and for confirming work, estimates, insurance matters, and emergency response.',
            ],
            [
              'Subscription and trial',
              'The initial configurable plan is $299 USD per month with explicit usage allowances. A 14-day trial begins only after activation prerequisites and a successful live test. Recurring billing requires clear acceptance through an approved merchant account.',
            ],
            [
              'Cancellation and usage',
              'An owner can request cancellation through Billing. Overage charging is disabled by default. Automation pauses when trial or included allowances expire; essential account and callback access remains available.',
            ],
            [
              'Required final provisions',
              'The business must supply its legal entity, contact, governing law, dispute terms, liability provisions, acceptable-use policy, number-retention policy, and reviewed messaging disclosures before launch.',
            ],
          ]
      ).map(([title, text]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{text}</p>
        </section>
      ))}
    </div>
  );
}
