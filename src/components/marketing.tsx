'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  MessageSquare,
  Phone,
  Play,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  Menu,
} from 'lucide-react';
import { Brand } from './brand';

const faqs = [
  [
    'What’s included in the plan?',
    'One business workspace, a shared two-way SMS inbox, AI qualification, lead summaries, inspection requests, and team access. The initial plan includes 500 outbound SMS segments and 500 AI replies each billing period. These are configurable launch settings.',
  ],
  [
    'Are there any usage limits?',
    'Yes. Usage is shown in your workspace. Automation pauses at your limit; you can still access enquiries and make callbacks. Overage billing is off by default and requires your explicit acceptance. Carrier registration requirements also apply.',
  ],
  [
    'Can I cancel at any time?',
    'Yes. An owner can request cancellation from Billing. A live subscription ends according to the provider-confirmed cancellation date. Your essential account and enquiry access stays available.',
  ],
  [
    'How does the 14-day trial work?',
    'Create your account and complete phone setup, messaging registration, consent policy review, and a successful live test. Your 14-day trial starts only when those prerequisites are complete, with a 100-segment trial allowance. No credit card is needed to begin setup.',
  ],
  [
    'Will it text every missed caller?',
    'Only eligible contacts. A missed call alone does not grant SMS consent. When consent, messaging registration, quiet hours, or another requirement prevents a text, the enquiry stays in your inbox for a manual callback.',
  ],
];
export function Marketing({
  pricingOnly = false,
  plan = { monthlyPriceMinor: 29900, paidSmsLimit: 500, paidAiLimit: 500 },
}: {
  pricingOnly?: boolean;
  plan?: { monthlyPriceMinor: number; paidSmsLimit: number; paidAiLimit: number };
}) {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobile, setMobile] = useState(false);
  return (
    <div className="marketing">
      <header className="public-header">
        <Brand />
        <nav className={mobile ? 'public-nav open' : 'public-nav'}>
          <Link href="/#how-it-works" onClick={() => setMobile(false)}>
            How it works
          </Link>
          <Link href="/pricing" className={pricingOnly ? 'active' : ''}>
            Pricing
          </Link>
          <Link href="/signin">Sign in</Link>
          <Link className="button primary small" href="/signup">
            Start your 14-day trial <ArrowUpRight size={15} />
          </Link>
        </nav>
        <button
          className="icon-button mobile-menu"
          aria-label="Toggle navigation"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <Menu />}
        </button>
      </header>
      {!pricingOnly && (
        <>
          <main className="hero public-width">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="live-dot" /> A little backup. A lot more possibility.
              </span>
              <h1>
                Missed the call?
                <br />
                <span>Meet your next job.</span>
              </h1>
              <p className="hero-description">
                You’re on the roof. Your next customer is on the line.
                <br className="desktop-break" /> Let LeadRescue follow up, start the conversation,
                <br className="desktop-break" /> and bring the right enquiries back to you.
              </p>
              <div className="hero-actions">
                <Link className="button primary" href="/signup">
                  Start your 14-day trial <ArrowRight size={18} />
                </Link>
                <Link className="button secondary" href="/demo">
                  <Play size={17} /> Explore the demo
                </Link>
              </div>
              <p className="microcopy">
                <Check size={14} /> No credit card needed <span>·</span> Your trial starts after
                setup
              </p>
              <div className="hero-proof">
                <div className="mini-avatars">
                  <span>AM</span>
                  <span>JR</span>
                  <span>DB</span>
                </div>
                <div>
                  <strong>Built for the people who build.</strong>
                  <span>Purpose-made for independent roofing teams.</span>
                </div>
              </div>
            </div>
            <div className="hero-visual">
              <div className="hero-oval" />
              <span className="decor-spark">✳</span>
              <div className="hero-conversation">
                <div className="mock-heading">
                  <span className="mock-logo">
                    <Phone size={17} />
                  </span>
                  <div>
                    <strong>Summit Roofing</strong>
                    <span>
                      <i /> Your assistant is here
                    </span>
                  </div>
                  <span className="mock-menu">•••</span>
                </div>
                <div className="missed-call">
                  <span>
                    <Phone size={21} />
                  </span>
                  <div>
                    <strong>Missed call</strong>
                    <p>(214) 555-0101</p>
                  </div>
                  <small>10:14 AM</small>
                </div>
                <div className="mock-message out">
                  Hi there! This is Summit Roofing’s virtual assistant. We saw you called about a
                  roof leak. Are you still looking for help?
                  <small>
                    10:15 AM <CheckCheck size={13} />
                  </small>
                </div>
                <div className="mock-message in">
                  Yes, I am. Can someone take a look this week?<small>10:17 AM</small>
                </div>
                <div className="mock-message out last">
                  Absolutely. Let’s find a time that works for you.
                  <small>
                    10:17 AM <CheckCheck size={13} />
                  </small>
                </div>
                <div className="mock-input">
                  <span>A better conversation starts here.</span>
                  <span>
                    <ArrowRight size={17} />
                  </span>
                </div>
              </div>
              <div className="recovered-card">
                <span>
                  <Check size={19} />
                </span>
                <div>
                  <strong>A missed call. A new opportunity.</strong>
                  <small>Enquiry recovered & ready for your team</small>
                </div>
                <Sparkles size={19} />
              </div>
              <div className="visual-caption">
                <ShieldCheck size={14} /> Thoughtful follow-up. You stay in control.
              </div>
            </div>
          </main>
          <section className="how-section" id="how-it-works">
            <div className="public-width">
              <div className="section-intro">
                <span className="eyebrow">LESS PHONE TAG. MORE FORWARD.</span>
                <h2>
                  From a missed ring to
                  <br />a real conversation.
                </h2>
                <p>
                  A simple way to keep good opportunities
                  <br />
                  from slipping through the cracks.
                </p>
              </div>
              <div className="step-grid">
                {[
                  {
                    n: '01',
                    icon: Phone,
                    title: 'Connect your phone',
                    text: 'Keep your business number. Set up verified call forwarding and your business details.',
                  },
                  {
                    n: '02',
                    icon: MessageSquare,
                    title: 'Keep the conversation going',
                    text: 'Your assistant sends eligible SMS follow-ups, asks the right questions, and gathers the details.',
                  },
                  {
                    n: '03',
                    icon: Users,
                    title: 'Show up with confidence',
                    text: 'See every enquiry in one inbox. Take over anytime and turn the next step into a booked inspection.',
                  },
                ].map((s) => (
                  <article className="step" key={s.n}>
                    <div className="step-top">
                      <s.icon size={24} />
                      <span>{s.n}</span>
                    </div>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
          <section className="control-section public-width">
            <div className="control-art">
              <div className="control-card">
                <span className="avatar blue">JW</span>
                <div>
                  <strong>Jessica Wilson</strong>
                  <span>Roof leak · Dallas, TX</span>
                </div>
                <span className="badge amber">Needs callback</span>
                <p>“There’s a leak near my upstairs window. Can someone call me?”</p>
                <div className="control-bottom">
                  <span>
                    <Check size={14} /> Details captured
                  </span>
                  <span>
                    <Check size={14} /> Ready for your team
                  </span>
                </div>
              </div>
              <span className="floating-pill">
                <Users size={17} /> Your team is always in the loop
              </span>
            </div>
            <div>
              <span className="eyebrow">YOUR BUSINESS. YOUR VOICE.</span>
              <h2>
                A helpful assistant.
                <br />A human at the helm.
              </h2>
              <p>
                Give your assistant the facts: your services, service area, hours, and approved
                answers. It handles the first questions. You handle what comes next.
              </p>
              <ul className="feature-checks">
                <li>
                  <Check />
                  Take over any conversation with one click
                </li>
                <li>
                  <Check />
                  Know who needs a callback, and why
                </li>
                <li>
                  <Check />
                  Keep customer consent at the center
                </li>
              </ul>
              <Link className="text-link" href="/demo">
                Take a look around <ArrowRight size={17} />
              </Link>
            </div>
          </section>
        </>
      )}
      <section className={`pricing-section ${pricingOnly ? 'standalone' : ''}`}>
        <div className="public-width pricing-grid">
          <div className="pricing-copy">
            <span className="eyebrow">ONE PLAN. A CLEARER DAY.</span>
            <h1>
              Everything you need.
              <br />
              <span>Nothing to chase.</span>
            </h1>
            <p>
              One simple plan for roofing contractors.
              <br />
              Start with a 14-day trial and see the difference.
            </p>
            <div className="trial-note">
              <Clock3 size={23} />
              <div>
                <strong>Your trial starts when you’re ready.</strong>
                <span>14 days after phone setup, registration, and a successful test.</span>
              </div>
            </div>
            <h3>Good questions. Straight answers.</h3>
            <div className="faqs">
              {faqs.map(([q, a], i) => (
                <div className={`faq ${openFaq === i ? 'expanded' : ''}`} key={q}>
                  <button
                    aria-expanded={openFaq === i}
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    {q}
                    <ChevronDown size={17} />
                  </button>
                  {openFaq === i && (
                    <p>
                      {i === 0
                        ? a
                            .replace(
                              '500 outbound SMS segments',
                              `${plan.paidSmsLimit} outbound SMS segments`,
                            )
                            .replace('500 AI replies', `${plan.paidAiLimit} AI replies`)
                        : a}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="price-card">
            <div className="price-card-top">
              <Sparkles size={16} /> BUILT FOR ROOFING CONTRACTORS
            </div>
            <div className="price-card-body">
              <h3>One less thing on your mind.</h3>
              <div className="price">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: plan.monthlyPriceMinor % 100 === 0 ? 0 : 2,
                }).format(plan.monthlyPriceMinor / 100)}
                <span> / month</span>
              </div>
              <p>14-day trial after setup</p>
              <div className="price-divider" />
              <ul>
                {[
                  'Two-way SMS with eligible missed callers',
                  'AI qualification and clear lead summaries',
                  'A shared inbox for your whole team',
                  'Inspection requests and calendar connection',
                  `${plan.paidSmsLimit} outbound SMS segments / month`,
                  `${plan.paidAiLimit} AI replies / month`,
                ].map((x) => (
                  <li key={x}>
                    <span>
                      <Check size={15} />
                    </span>
                    {x}
                  </li>
                ))}
              </ul>
              <div className="usage-note">
                <ShieldCheck size={18} />
                <span>
                  No surprise overages. Automation pauses at your allowance unless you explicitly
                  approve a different policy.
                </span>
              </div>
              <Link className="button primary" href="/signup">
                Let’s get you set up <ArrowRight size={17} />
              </Link>
              <p className="microcopy">No credit card required to start setup.</p>
            </div>
          </div>
        </div>
      </section>
      <footer className="public-footer public-width">
        <div>
          <Brand />
          <p>A missed call shouldn’t be a missed opportunity.</p>
        </div>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/signin">Sign in</Link>
          <span>© {new Date().getFullYear()} LeadRescue</span>
        </div>
      </footer>
    </div>
  );
}
