import { describe, expect, it } from 'vitest';
import { industries, getIndustry } from '@/lib/industries';
import { industryDemo } from '@/lib/demo';
import { nextQuestion, recoveryText } from '@/lib/domain/recovery';
import { workspaceMutationSchema } from '@/lib/validation';

describe('multi-industry service workflows', () => {
  it.each(industries)(
    'offers consistent services, questions and sample data for $label',
    (industry) => {
      const demo = industryDemo(industry.id);
      expect(demo.settings.industry).toBe(industry.id);
      expect(demo.settings.appointmentLabel).toBe(industry.appointmentLabel);
      expect(demo.settings.intakeQuestions.split('\n')).toEqual(industry.intakeQuestions);
      if (industry.id !== 'roofing') {
        for (const lead of demo.leads) {
          expect(industry.services).toContain(lead.service);
          expect(JSON.stringify(lead)).not.toMatch(/roof|shingle|gutter/i);
        }
      }
      expect(demo.bookings[0].service).toBe(industry.appointmentLabel);
    },
  );
  it('asks only the configured services and unanswered intake questions', () => {
    const p = getIndustry('plumbing');
    const profile = {
      services: p.services,
      intakeQuestions: p.intakeQuestions,
      appointmentLabel: p.appointmentLabel,
    };
    expect(nextQuestion({ service: null, zip: null, urgent: false }, 'Acme', profile)).toContain(
      'Drain cleaning',
    );
    expect(
      nextQuestion({ service: 'Drain cleaning', zip: '75201', urgent: false }, 'Acme', profile),
    ).toBe(p.intakeQuestions[0]);
    expect(
      nextQuestion(
        {
          service: 'Drain cleaning',
          zip: '75201',
          urgent: false,
          intakeAnswers: [{ question: p.intakeQuestions[0], answer: 'Kitchen' }],
        },
        'Acme',
        profile,
      ),
    ).toBe(p.intakeQuestions[1]);
    expect(
      nextQuestion(
        {
          service: 'Drain cleaning',
          zip: '75201',
          urgent: false,
          intakeAnswers: p.intakeQuestions.map((question) => ({
            question,
            answer: 'Customer detail',
          })),
        },
        'Acme',
        profile,
      ),
    ).toContain('Plumbing assessment');
  });
  it('prioritizes hazards before qualification and keeps opt-out in every recovery', () => {
    for (const p of industries) {
      const urgent = nextQuestion({ service: null, zip: null, urgent: true }, 'Acme', {
        services: p.services,
      });
      expect(urgent).toContain('contact emergency services');
      expect(urgent).not.toMatch(/roof|promise|guarantee/i);
      expect(recoveryText(`Acme ${p.label}`)).toContain('Reply STOP to opt out.');
    }
  });
  it('validates industry IDs and bounds owner-defined intake and appointments', () => {
    const base = {
      action: 'create-business',
      name: 'Acme',
      timezone: 'America/Chicago',
      zipCodes: ['75201'],
    };
    expect(workspaceMutationSchema.parse(base)).toMatchObject({ industry: 'custom' });
    expect(() => workspaceMutationSchema.parse({ ...base, industry: 'unknown' })).toThrow();
    expect(getIndustry('unknown').id).toBe('custom');
  });
  it('creates independent demo snapshots without mutating the roofing fixture', () => {
    const a = industryDemo('cleaning');
    a.leads[0].messages[0].text = 'Changed in one browser';
    expect(industryDemo('cleaning').leads[0].messages[0].text).not.toContain('Changed');
    expect(industryDemo('roofing').leads[0].service).toBe('Roof leak');
  });
});
