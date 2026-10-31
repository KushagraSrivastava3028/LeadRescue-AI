export type LeadStatus =
  'Needs callback' | 'Booked' | 'AI replying' | 'New enquiry' | 'Qualified' | 'Won' | 'Closed';
export type ChatMessage = {
  id: string;
  text: string;
  direction: 'inbound' | 'outbound';
  time: string;
  author?: string;
  status?: string;
};
export type Lead = {
  id: string;
  name: string;
  initials: string;
  color: string;
  phone: string;
  service: string;
  status: LeadStatus;
  received: string;
  city: string;
  zip: string;
  mode: 'ai' | 'human';
  messages: ChatMessage[];
  notes: string;
  consent: boolean;
};
export type Booking = {
  id: string;
  leadId: string;
  name: string;
  service: string;
  date: string;
  time: string;
  status: 'Request' | 'Confirmed';
};
export const demoLeads: Lead[] = [
  {
    id: 'demo-jessica',
    name: 'Jessica Wilson',
    initials: 'JW',
    color: 'blue',
    phone: '(214) 555-0101',
    service: 'Roof leak',
    status: 'Needs callback',
    received: '12 min ago',
    city: 'Dallas, TX',
    zip: '75201',
    mode: 'ai',
    consent: true,
    notes: 'Leak near the upstairs window. Would like a call before arranging an inspection.',
    messages: [
      {
        id: 'j1',
        direction: 'outbound',
        text: 'Hi Jessica, this is Summit Roofing’s virtual assistant. How can we help?',
        time: '10:14 AM',
        author: 'AI assistant',
        status: 'Delivered',
      },
      {
        id: 'j2',
        direction: 'inbound',
        text: 'There’s a leak near my upstairs window. Can someone call me?',
        time: '10:16 AM',
      },
      {
        id: 'j3',
        direction: 'outbound',
        text: 'I’ve shared your request with the team. What’s the best time to call?',
        time: '10:17 AM',
        author: 'AI assistant',
        status: 'Delivered',
      },
    ],
  },
  {
    id: 'demo-daniel',
    name: 'Daniel Brooks',
    initials: 'DB',
    color: 'green',
    phone: '(214) 555-0102',
    service: 'Roof inspection',
    status: 'Booked',
    received: '35 min ago',
    city: 'Plano, TX',
    zip: '75074',
    mode: 'ai',
    consent: true,
    notes: 'Synthetic inspection example. No real appointment has been created.',
    messages: [
      {
        id: 'd1',
        direction: 'outbound',
        text: 'Hi Daniel! Looking to arrange a roof inspection?',
        time: '9:42 AM',
        status: 'Delivered',
      },
      {
        id: 'd2',
        direction: 'inbound',
        text: 'Yes please, Friday morning would be great.',
        time: '9:44 AM',
      },
      {
        id: 'd3',
        direction: 'outbound',
        text: 'Your demo inspection is on the calendar for Friday at 9:00 AM. We look forward to helping.',
        time: '9:45 AM',
        status: 'Delivered',
      },
    ],
  },
  {
    id: 'demo-emily',
    name: 'Emily Carter',
    initials: 'EC',
    color: 'purple',
    phone: '(214) 555-0103',
    service: 'Storm damage',
    status: 'AI replying',
    received: '1 hr ago',
    city: 'Dallas, TX',
    zip: '75204',
    mode: 'ai',
    consent: true,
    notes: 'Shingles came loose after a storm. Asked about an assessment.',
    messages: [
      {
        id: 'e1',
        direction: 'inbound',
        text: 'We had some shingles come loose in the storm. Do you work in 75204?',
        time: '9:18 AM',
      },
      {
        id: 'e2',
        direction: 'outbound',
        text: 'Yes, that’s in our service area. Is there any active leaking inside your home?',
        time: '9:19 AM',
        status: 'Delivered',
      },
    ],
  },
  {
    id: 'demo-michael',
    name: 'Michael Reed',
    initials: 'MR',
    color: 'gray',
    phone: '(214) 555-0104',
    service: 'Roof replacement',
    status: 'New enquiry',
    received: '2 hrs ago',
    city: 'Richardson, TX',
    zip: '75080',
    mode: 'human',
    consent: false,
    notes: 'SMS consent is not recorded. Call the customer manually.',
    messages: [
      {
        id: 'm1',
        direction: 'inbound',
        text: 'Missed call received. Texting is paused because SMS consent has not been recorded. Please call this customer.',
        time: '8:24 AM',
        author: 'System',
      },
    ],
  },
  {
    id: 'demo-sarah',
    name: 'Sarah Thompson',
    initials: 'ST',
    color: 'pink',
    phone: '(214) 555-0105',
    service: 'Gutter repair',
    status: 'Qualified',
    received: '3 hrs ago',
    city: 'Irving, TX',
    zip: '75039',
    mode: 'ai',
    consent: true,
    notes: 'Gutter pulling away from the roof. Ready to arrange an inspection.',
    messages: [
      {
        id: 's1',
        direction: 'inbound',
        text: 'The gutter on the back of our house is coming away. Can you take a look this week?',
        time: '7:48 AM',
      },
    ],
  },
  {
    id: 'demo-james',
    name: 'James Miller',
    initials: 'JM',
    color: 'amber',
    phone: '(214) 555-0106',
    service: 'Roof repair',
    status: 'Won',
    received: 'Yesterday',
    city: 'Dallas, TX',
    zip: '75206',
    mode: 'human',
    consent: true,
    notes: 'Job marked won by the business owner in this demo.',
    messages: [
      {
        id: 'a1',
        direction: 'inbound',
        text: 'Thanks for coming by. We’d like to go ahead with the repair.',
        time: 'Yesterday',
      },
    ],
  },
];
export const defaultSettings = {
  name: 'Summit Roofing',
  owner: 'Alex Morgan',
  email: 'alex@example.com',
  phone: '(214) 555-0100',
  destination: '(214) 555-0199',
  timezone: 'America/Chicago',
  zipCodes: '75201, 75204, 75206, 75074, 75080',
  services: 'Roof repair, Roof inspection, Roof replacement, Storm damage, Gutter repair',
  hours: 'Monday–Friday, 8:00 AM–6:00 PM',
  faqs: 'We offer on-site roofing inspections in the Dallas area. The team confirms all pricing after an assessment.',
  restrictions:
    'Do not quote prices, promise emergency response, or discuss insurance coverage. Escalate active leaks to the team.',
  notifications: true,
  assistant: true,
};
