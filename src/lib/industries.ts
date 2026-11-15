/** Shared presets are suggestions, not provider approval or permission to send. */
export const industryIds = [
  'roofing',
  'plumbing',
  'hvac',
  'electrical',
  'landscaping',
  'cleaning',
  'pest_control',
  'custom',
] as const;
export type IndustryId = (typeof industryIds)[number];
export type IndustryPreset = {
  id: IndustryId;
  label: string;
  services: string[];
  intakeQuestions: string[];
  appointmentLabel: string;
};
export const industries: IndustryPreset[] = [
  {
    id: 'roofing',
    label: 'Roofing',
    services: [
      'Roof repair',
      'Roof inspection',
      'Roof replacement',
      'Storm damage',
      'Gutter repair',
    ],
    intakeQuestions: ['Where have you noticed the problem?', 'When did you first notice it?'],
    appointmentLabel: 'Roof inspection',
  },
  {
    id: 'plumbing',
    label: 'Plumbing',
    services: ['Leak repair', 'Drain cleaning', 'Water heater service', 'Fixture installation'],
    intakeQuestions: ['Which fixture or area is affected?', 'When did the problem start?'],
    appointmentLabel: 'Plumbing assessment',
  },
  {
    id: 'hvac',
    label: 'HVAC',
    services: ['AC repair', 'Heating repair', 'System maintenance', 'System installation'],
    intakeQuestions: ['Is this a heating or cooling issue?', 'What symptoms have you noticed?'],
    appointmentLabel: 'HVAC assessment',
  },
  {
    id: 'electrical',
    label: 'Electrical',
    services: [
      'Electrical repair',
      'Panel assessment',
      'Lighting installation',
      'Outlet installation',
    ],
    intakeQuestions: [
      'Which area or equipment is affected?',
      'When did you first notice the issue?',
    ],
    appointmentLabel: 'Electrical assessment',
  },
  {
    id: 'landscaping',
    label: 'Landscaping',
    services: ['Lawn care', 'Garden maintenance', 'Landscape design', 'Irrigation service'],
    intakeQuestions: [
      'Which outdoor areas need attention?',
      'Are you looking for one-time or recurring service?',
    ],
    appointmentLabel: 'Site visit',
  },
  {
    id: 'cleaning',
    label: 'Cleaning',
    services: ['Home cleaning', 'Office cleaning', 'Deep cleaning', 'Move-out cleaning'],
    intakeQuestions: [
      'How many rooms or areas need cleaning?',
      'Are you looking for one-time or recurring service?',
    ],
    appointmentLabel: 'Cleaning consultation',
  },
  {
    id: 'pest_control',
    label: 'Pest control',
    services: ['Pest assessment', 'Rodent control', 'Insect control', 'Preventive service'],
    intakeQuestions: [
      'What have you noticed and where?',
      'When did you first notice the activity?',
    ],
    appointmentLabel: 'Pest assessment',
  },
  {
    id: 'custom',
    label: 'Other / custom services',
    services: ['Service consultation'],
    intakeQuestions: ['Could you describe the work you need?', 'What is your preferred timeframe?'],
    appointmentLabel: 'Service appointment',
  },
];
export function getIndustry(id: unknown): IndustryPreset {
  return industries.find((industry) => industry.id === id) ?? industries[industries.length - 1];
}
export function parseServices(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function parseQuestions(value: string): string[] {
  return [
    ...new Set(
      value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
