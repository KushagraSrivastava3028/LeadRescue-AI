'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MfaEnrollment } from './mfa-enrollment';
import { PhoneSetup } from './phone-setup';
import { resolveBusinessSlot } from '@/lib/domain/scheduling';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Hand,
  House,
  Info,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Phone,
  PhoneMissed,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { Brand } from './brand';
import { Booking, defaultSettings, demoLeads, Lead, LeadStatus } from '@/lib/demo';

type Modal =
  'new-lead' | 'booking' | 'plan' | 'notifications' | 'invite' | 'help' | 'callback' | null;
type JsonRecord = Record<string, unknown>;
type LiveData = {
  business?: JsonRecord;
  role?: string;
  user?: JsonRecord;
  profile?: JsonRecord;
  metrics?: Record<string, number>;
  leads?: JsonRecord[];
  conversations?: JsonRecord[];
  messages?: JsonRecord[];
  appointments?: JsonRecord[];
  subscription?: JsonRecord;
  entitlements?: JsonRecord;
  usage?: JsonRecord[];
  notifications?: JsonRecord[];
  plan?: { monthlyPriceMinor: number; paidSmsLimit: number; paidAiLimit: number };
};
const navItems = [
  { key: 'overview', label: 'Overview', icon: House },
  { key: 'inbox', label: 'Inbox', icon: MessageSquare },
  { key: 'leads', label: 'Leads', icon: Users },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'assistant', label: 'AI assistant', icon: Sparkles },
];
const statusClass: Record<LeadStatus, string> = {
  'Needs callback': 'amber',
  Booked: 'green',
  'AI replying': 'blue',
  'New enquiry': 'gray',
  Qualified: 'purple',
  Won: 'green',
  Closed: 'gray',
};
function Status({ status }: { status: LeadStatus }) {
  return (
    <span className={`badge ${statusClass[status] || 'gray'}`}>
      <i />
      {status}
    </span>
  );
}
function Avatar({ lead }: { lead: Pick<Lead, 'initials' | 'color'> }) {
  return <span className={`avatar ${lead.color}`}>{lead.initials}</span>;
}
function normalizeLive(data: LiveData): Lead[] {
  return (data.leads || []).map((l, i) => {
    const contact = (l.contacts || {}) as JsonRecord;
    const conversation = data.conversations?.find((c) => c.lead_id === l.id);
    const name = String(contact.name || l.name || 'Unknown caller');
    const raw = String(l.status || 'new');
    const statuses: Record<string, LeadStatus> = {
      new: 'New enquiry',
      new_enquiry: 'New enquiry',
      needs_callback: 'Needs callback',
      callback: 'Needs callback',
      qualified: 'Qualified',
      booked: 'Booked',
      won: 'Won',
      closed: 'Closed',
      ai_replying: 'AI replying',
    };
    return {
      id: String(l.id),
      name,
      initials: name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase(),
      color: ['blue', 'green', 'purple', 'gray'][i % 4],
      phone: String(contact.phone || ''),
      service: String(l.service || 'Roofing enquiry'),
      status: statuses[raw] || 'New enquiry',
      received: l.created_at
        ? new Date(String(l.created_at)).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : 'Recently',
      city: String(contact.city || ''),
      zip: String(contact.zip_code || ''),
      mode: conversation?.mode === 'human' ? 'human' : 'ai',
      notes: String(l.summary || l.notes || ''),
      consent: false,
      messages: (data.messages || [])
        .filter((m) => m.conversation_id === conversation?.id)
        .map((m) => ({
          id: String(m.id),
          text: String(m.body || m.content || ''),
          direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
          time: new Date(String(m.created_at)).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          }),
          status: String(m.status || ''),
        })),
    };
  });
}

export function Workspace({ demo, section }: { demo: boolean; section: string }) {
  const router = useRouter();
  const base = demo ? '/demo' : '/app';
  const [leads, setLeads] = useState<Lead[]>(demo ? structuredClone(demoLeads) : []);
  const [selected, setSelected] = useState(demo ? 'demo-jessica' : '');
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [timeframe, setTimeframe] = useState('Last 7 days');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [sidebar, setSidebar] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [account, setAccount] = useState(false);
  const [draft, setDraft] = useState('');
  const [settings, setSettings] = useState(
    demo
      ? defaultSettings
      : {
          ...defaultSettings,
          name: '',
          owner: '',
          email: '',
          phone: '',
          destination: '',
          zipCodes: '',
          services: '',
          hours: '',
          faqs: '',
          restrictions: '',
          assistant: false,
        },
  );
  const [bookings, setBookings] = useState<Booking[]>(
    demo
      ? [
          {
            id: 'demo-booking',
            leadId: 'demo-daniel',
            name: 'Daniel Brooks',
            service: 'Roof inspection',
            date: '2026-10-30',
            time: '09:00',
            status: 'Confirmed',
          },
        ]
      : [],
  );
  const [settingsTab, setSettingsTab] = useState('Business profile');
  const [calendarDate, setCalendarDate] = useState(demo ? new Date(2026, 9, 1) : new Date());
  const [calendarView, setCalendarView] = useState('Month');
  const [live, setLive] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const [privateLink, setPrivateLink] = useState('');
  const [openingHours, setOpeningHours] = useState<
    Record<string, { open: string; close: string; enabled?: boolean }>
  >(
    Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d, i) => [
        d,
        { open: '08:00', close: '18:00', enabled: i < 5 },
      ]),
    ),
  );
  const paidPlan = live?.plan || { monthlyPriceMinor: 29900, paidSmsLimit: 500, paidAiLimit: 500 };
  const planPrice = demo
    ? '$299'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
        paidPlan.monthlyPriceMinor / 100,
      );
  const active = leads.find((l) => l.id === selected) || leads[0];
  const role = demo ? 'owner' : live?.role || 'viewer';
  const businessName = demo ? settings.name : String(live?.business?.name || 'Your workspace');
  const userName = demo ? 'Alex Morgan' : String(live?.user?.name || 'Your account');
  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = localStorage.getItem('leadrescue-demo-v1');
        if (saved) {
          const state = JSON.parse(saved);
          if (Array.isArray(state.leads)) setLeads(state.leads);
          if (state.settings) setSettings({ ...defaultSettings, ...state.settings });
          if (Array.isArray(state.bookings)) setBookings(state.bookings);
          if (state.openingHours) setOpeningHours(state.openingHours);
        }
      } catch {
        /* Synthetic sandbox resets when local storage is unavailable. */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [demo]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  async function loadWorkspace() {
    setLoading(true);
    setLoadError('');
    try {
      const r = await fetch(`/api/workspace?days=${timeframe === 'Last 30 days' ? 30 : 7}`, {
        cache: 'no-store',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Unable to load your workspace.');
      setLive(data);
      setBookings(
        (data.appointments || []).map((a: JsonRecord) => {
          const dt = new Date(String(a.start_at));
          return {
            id: String(a.id),
            leadId: String(a.lead_id),
            name: String(
              data.leads?.find((l: JsonRecord) => l.id === a.lead_id)?.contacts?.name || 'Customer',
            ),
            service: 'Roof inspection',
            date: dt.toLocaleDateString('en-CA', {
              timeZone: String(data.business?.timezone || 'America/Chicago'),
            }),
            time: dt.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: String(data.business?.timezone || 'America/Chicago'),
            }),
            status: a.status === 'confirmed' ? 'Confirmed' : 'Request',
          };
        }),
      );
      const normalized = normalizeLive(data);
      setLeads(normalized);
      setSelected((s) => s || normalized[0]?.id || '');
      if (data.profile) {
        const p = data.profile;
        if (p.opening_hours) setOpeningHours(p.opening_hours);
        setSettings((prev) => ({
          ...prev,
          name: String(data.business?.name || prev.name),
          timezone: String(data.business?.timezone || prev.timezone),
          services: Array.isArray(p.services) ? p.services.join(', ') : prev.services,
          zipCodes: Array.isArray(p.zip_codes) ? p.zip_codes.join(', ') : prev.zipCodes,
          faqs: Array.isArray(p.faqs)
            ? p.faqs
                .map((f: { question: string; answer: string }) => `${f.question} | ${f.answer}`)
                .join('\n')
            : '',
          restrictions: Array.isArray(p.assistant_restrictions)
            ? p.assistant_restrictions.join('\n')
            : '',
          phone: '',
          destination: '',
          assistant: Boolean(data.entitlements?.automation_enabled),
        }));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Unable to load your workspace.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadWorkspace();
    });
    return () => {
      cancelled = true;
    }; // The request synchronizes this verified workspace and range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, timeframe]);
  function persist(nextLeads = leads, nextSettings = settings, nextBookings = bookings) {
    if (demo) {
      try {
        localStorage.setItem(
          'leadrescue-demo-v1',
          JSON.stringify({
            leads: nextLeads,
            settings: nextSettings,
            bookings: nextBookings,
            openingHours,
          }),
        );
      } catch {
        setToast('Browser storage is unavailable. Changes last for this visit.');
      }
    }
  }
  async function mutate(action: string, payload: JsonRecord = {}) {
    setBusy(true);
    try {
      const r = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, businessId: live?.business?.id, ...payload }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'That change could not be saved.');
      if (d.url) {
        window.location.assign(d.url);
        return true;
      }
      if (d.customerConfirmationUrl) setPrivateLink(d.customerConfirmationUrl);
      if (d.invitationUrl) setPrivateLink(d.invitationUrl);
      await loadWorkspace();
      setToast(d.message || 'Changes saved.');
      return true;
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Service unavailable.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  function openLead(id: string) {
    setSelected(id);
    setDetailOpen(true);
  }
  async function changeMode() {
    if (!active) return;
    if (!demo) {
      const conv = live?.conversations?.find((c) => c.lead_id === active.id);
      await mutate(active.mode === 'ai' ? 'takeover' : 'resume', { conversationId: conv?.id });
      return;
    }
    const next = leads.map((l) =>
      l.id === active.id
        ? { ...l, mode: active.mode === 'ai' ? ('human' as const) : ('ai' as const) }
        : l,
    );
    setLeads(next);
    persist(next);
    setToast(
      active.mode === 'ai'
        ? 'You’re in control. The demo assistant is paused.'
        : 'Demo assistant resumed.',
    );
  }
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !draft.trim()) return;
    if (active.mode !== 'human') {
      setToast('Take over the conversation before replying.');
      return;
    }
    if (!demo) {
      const conv = live?.conversations?.find((c) => c.lead_id === active.id);
      if (await mutate('send', { conversationId: conv?.id, body: draft.trim() })) setDraft('');
      return;
    }
    if (!active.consent) {
      setToast('SMS consent is not recorded. Make a manual callback instead.');
      return;
    }
    const next = leads.map((l) =>
      l.id === active.id
        ? {
            ...l,
            messages: [
              ...l.messages,
              {
                id: crypto.randomUUID(),
                text: draft.trim(),
                direction: 'outbound' as const,
                time: new Date().toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                }),
                author: 'You',
                status: 'Demo only',
              },
            ],
          }
        : l,
    );
    setLeads(next);
    persist(next);
    setDraft('');
    setToast('Demo reply saved. No SMS was sent.');
  }
  async function changeStatus(status: LeadStatus) {
    if (!active) return;
    if (!demo && ['Booked', 'AI replying'].includes(status)) {
      setToast('This status is set by verified booking or messaging events.');
      return;
    }
    if (!demo) {
      const values: Record<LeadStatus, string> = {
        'Needs callback': 'needs_callback',
        Booked: 'booked',
        'AI replying': 'ai_replying',
        'New enquiry': 'new',
        Qualified: 'qualified',
        Won: 'won',
        Closed: 'lost',
      };
      await mutate('update-lead', { leadId: active.id, status: values[status] });
      return;
    }
    const next = leads.map((l) => (l.id === active.id ? { ...l, status } : l));
    setLeads(next);
    persist(next);
    setToast(`Lead marked ${status.toLowerCase()} in the demo.`);
  }
  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          (filter === 'All' ||
            (filter === 'Needs attention' &&
              ['Needs callback', 'New enquiry'].includes(l.status)) ||
            (filter === 'Booked' && l.status === 'Booked') ||
            filter === l.status) &&
          `${l.name} ${l.phone} ${l.service}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [leads, filter, query],
  );
  const metrics = demo
    ? {
        missedCalls: timeframe === 'Last 30 days' ? 164 : 42,
        customerReplies: timeframe === 'Last 30 days' ? 112 : 31,
        qualifiedLeads: timeframe === 'Last 30 days' ? 76 : 19,
        inspectionsBooked: timeframe === 'Last 30 days' ? 29 : 8,
      }
    : live?.metrics || {
        missedCalls: 0,
        customerReplies: 0,
        qualifiedLeads: 0,
        inspectionsBooked: 0,
      };
  async function exportLeads() {
    if (!demo) {
      setBusy(true);
      try {
        const r = await fetch('/api/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessId: live?.business?.id }),
        });
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error || 'Export unavailable.');
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'leadrescue-export.json';
        a.click();
        URL.revokeObjectURL(url);
        setToast('Export downloaded.');
      } catch (e) {
        setToast(e instanceof Error ? e.message : 'Export unavailable.');
      } finally {
        setBusy(false);
      }
      return;
    }
    const columns = ['Customer', 'Phone', 'Service', 'Status', 'ZIP'];
    const csv = [columns, ...filtered.map((l) => [l.name, l.phone, l.service, l.status, l.zip])]
      .map((row) =>
        row
          .map(
            (v) =>
              `"${String(v)
                .replace(/"/g, '""')
                .replace(/^[=+@\-]/, "'")}"`,
          )
          .join(','),
      )
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = demo ? 'leadrescue-demo-leads.csv' : 'leadrescue-leads.csv';
    a.click();
    URL.revokeObjectURL(url);
    setToast('Export downloaded. Handle customer information with care.');
  }
  function Conversation({ expanded = false }: { expanded?: boolean }) {
    if (!active)
      return (
        <div className="empty-state">
          <MessageSquare />
          <h3>Conversations start here.</h3>
          <p>Select an enquiry to see the details.</p>
        </div>
      );
    return (
      <div className={`conversation-card panel ${expanded ? 'expanded-conversation' : ''}`}>
        <div className="conversation-header">
          {detailOpen && (
            <button
              className="icon-button mobile-back"
              aria-label="Back to enquiries"
              onClick={() => setDetailOpen(false)}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <Avatar lead={active} />
          <div className="conversation-person">
            <h3>{active.name}</h3>
            <p>
              {active.service} <span>·</span> {active.city || active.phone}
            </p>
          </div>
          <Status status={active.status} />
        </div>
        <div className="conversation-body">
          <div className="conversation-label">
            <strong>Conversation</strong>
            <span>
              <span className={`live-dot ${active.mode === 'human' ? 'muted' : ''}`} />
              {active.mode === 'human' ? 'You’re replying' : 'AI assistant'}
            </span>
          </div>
          <div className="message-list">
            {active.messages.length === 0 && (
              <div className="empty-state">
                <MessageSquare />
                <p>No messages yet. Check eligibility before sending a reply.</p>
              </div>
            )}
            {active.messages.map((m) => (
              <div className={`chat-row ${m.direction === 'outbound' ? 'out' : 'in'}`} key={m.id}>
                <div className="chat-bubble">
                  {m.text}
                  <div className="chat-meta">
                    {m.author === 'You' && <span>You · </span>}
                    {m.time}
                    {m.direction === 'outbound' && <CheckCheck size={13} />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="conversation-footer">
          <div className="conversation-details">
            <span>
              <Wrench size={16} /> {active.service === 'Roof leak' ? 'Roof repair' : active.service}
            </span>
            <span>
              <MapPin size={17} /> {active.zip || 'ZIP unknown'}
            </span>
          </div>
          <button
            className={`button small ${active.mode === 'ai' ? 'primary' : 'secondary'}`}
            onClick={changeMode}
            disabled={busy || role === 'viewer'}
          >
            {active.mode === 'ai' ? <Hand size={16} /> : <Sparkles size={16} />}{' '}
            {active.mode === 'ai' ? 'Take over conversation' : 'Resume AI assistant'}
          </button>
          <form className="reply-form" onSubmit={sendMessage}>
            <input
              aria-label="Reply message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={480}
              placeholder={active.mode === 'ai' ? 'Take over to reply…' : 'Write your reply…'}
              disabled={active.mode !== 'human' || busy || role === 'viewer'}
            />
            <button
              className="send-button"
              type="submit"
              aria-label="Send reply"
              disabled={!draft.trim() || active.mode !== 'human' || busy}
            >
              <Send size={20} />
            </button>
          </form>
          {demo && (
            <span className="demo-send-note">Sandbox conversation · no real messages are sent</span>
          )}
        </div>
        {expanded && (
          <div className="lead-detail-extra">
            <div>
              <h4>Lead notes</h4>
              <p>{active.notes || 'No notes yet.'}</p>
            </div>
            <div className="lead-detail-actions">
              <label>
                Lead status
                <select
                  value={active.status}
                  disabled={role === 'viewer'}
                  onChange={(e) => changeStatus(e.target.value as LeadStatus)}
                >
                  {Object.keys(statusClass)
                    .filter(
                      (s) => demo || !['Booked', 'AI replying'].includes(s) || s === active.status,
                    )
                    .map((s) => (
                      <option key={s} disabled={!demo && ['Booked', 'AI replying'].includes(s)}>
                        {s}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button secondary small"
                onClick={() => setModal('callback')}
                disabled={role === 'viewer'}
              >
                <Phone size={15} />
                Callback
              </button>
              <button
                className="button secondary small"
                onClick={() => setModal('booking')}
                disabled={role === 'viewer'}
              >
                <CalendarDays size={16} />
                Request inspection
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  function EnquiryTable({ full = false }: { full?: boolean }) {
    return (
      <div className="enquiry-table">
        <div className="table-head">
          <span>Customer</span>
          <span>Service</span>
          <span>Status</span>
          <span>Received</span>
        </div>
        {filtered.slice(0, full ? 100 : 4).map((l) => (
          <button
            key={l.id}
            onClick={() => openLead(l.id)}
            className={`enquiry-row ${active?.id === l.id ? 'selected' : ''}`}
          >
            <span className="customer-cell">
              <Avatar lead={l} />
              <span>
                <strong>{l.name}</strong>
                {full && <small>{l.phone}</small>}
              </span>
            </span>
            <span>{l.service}</span>
            <span>
              <Status status={l.status} />
            </span>
            <span>{l.received}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">
            <Search />
            <h3>No enquiries found</h3>
            <p>Try a different name, service, or filter.</p>
            <button
              className="text-link"
              onClick={() => {
                setFilter('All');
                setQuery('');
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    );
  }
  function FilterTabs() {
    return (
      <div className="filter-tabs">
        {['All', 'Needs attention', 'Booked'].map((f) => (
          <button className={filter === f ? 'selected' : ''} key={f} onClick={() => setFilter(f)}>
            {f}
            {f === 'Needs attention' && section === 'inbox' && (
              <span>
                {leads.filter((l) => ['Needs callback', 'New enquiry'].includes(l.status)).length}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }
  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (demo) {
      persist();
      setToast('Demo settings saved in this browser.');
      return;
    }
    const faqs = settings.faqs
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [question, ...answer] = line.split('|');
        return { question: question.trim(), answer: answer.join('|').trim() };
      });
    if (faqs.some((f) => !f.question || !f.answer)) {
      setToast('Enter each FAQ as Question | Answer on a separate line.');
      return;
    }
    await mutate('settings', {
      name: settings.name,
      services: settings.services
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      zipCodes: settings.zipCodes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      timezone: settings.timezone,
      escalationPhone: null,
      faqs,
      assistantRestrictions: settings.restrictions
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      openingHours,
    });
  }
  async function submitModal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (modal === 'new-lead') {
      if (!demo) {
        setToast('Live enquiries are captured through your connected phone.');
        return;
      }
      const name = String(form.get('name'));
      const lead: Lead = {
        id: crypto.randomUUID(),
        name,
        initials: name
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join(''),
        color: 'blue',
        phone: String(form.get('phone')),
        service: String(form.get('service')),
        status: 'New enquiry',
        received: 'Just now',
        city: String(form.get('city') || 'Dallas, TX'),
        zip: String(form.get('zip') || ''),
        mode: 'human',
        messages: [],
        notes: String(form.get('notes') || ''),
        consent: false,
      };
      const next = [lead, ...leads];
      setLeads(next);
      setSelected(lead.id);
      persist(next);
      setToast('Demo enquiry created. SMS remains off until consent is recorded.');
      setModal(null);
    } else if (modal === 'booking' && active) {
      if (!demo) {
        let startAt: string;
        try {
          startAt = resolveBusinessSlot(
            String(form.get('date')),
            String(form.get('time')),
            settings.timezone,
          );
        } catch {
          setToast('Choose a valid date and time outside a daylight-saving change.');
          return;
        }
        await mutate('request-appointment', {
          leadId: active.id,
          startAt,
          note: 'Inspection requested by the team; awaiting customer confirmation.',
        });
        setModal(null);
        return;
      }
      const booking: Booking = {
        id: crypto.randomUUID(),
        leadId: active.id,
        name: active.name,
        service: active.service,
        date: String(form.get('date')),
        time: String(form.get('time')),
        status: 'Request',
      };
      const next = [...bookings, booking];
      setBookings(next);
      persist(leads, settings, next);
      setModal(null);
      setToast('Inspection request saved in the demo. No calendar event was created.');
    } else if (modal === 'callback' && active) {
      if (demo) {
        const next = leads.map((l) =>
          l.id === active.id
            ? { ...l, status: 'Needs callback' as const, notes: String(form.get('note')) }
            : l,
        );
        setLeads(next);
        persist(next);
        setToast('Demo callback request saved.');
        setModal(null);
      } else if (await mutate('callback', { leadId: active.id, note: form.get('note') }))
        setModal(null);
    } else if (modal === 'invite') {
      if (demo) {
        setToast('Invite preview saved. No email was sent.');
        setModal(null);
      } else if (await mutate('invite', { email: form.get('email'), role: form.get('role') }))
        setModal(null);
    }
  }

  return (
    <div className="workspace">
      <a className="skip-link" href="#workspace-content">
        Skip to main content
      </a>
      {sidebar && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Brand compact />
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button
          className="workspace-switcher"
          onClick={() =>
            setToast(
              demo
                ? 'You’re exploring the Summit Roofing demo.'
                : 'Your active business is ' + businessName,
            )
          }
        >
          <span className="workspace-icon">
            <House size={19} />
          </span>
          <span>{businessName}</span>
          <ChevronDown size={15} />
        </button>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.key}
              className={section === item.key ? 'active' : ''}
              href={item.key === 'overview' ? base : `${base}/${item.key}`}
              onClick={() => {
                setSidebar(false);
                setFilter('All');
              }}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
              {item.key === 'inbox' && leads.some((l) => l.status === 'Needs callback') && (
                <span className="nav-count">
                  {
                    leads.filter((l) =>
                      ['Needs callback', 'New enquiry', 'AI replying'].includes(l.status),
                    ).length
                  }
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <Sparkles size={17} />
            </span>
            <strong>A little peace of mind.</strong>
            <p>Your next opportunity is already in good hands.</p>
            <button onClick={() => setModal('help')}>
              Meet your assistant <ArrowUpRight size={14} />
            </button>
          </div>
          <nav className="sidebar-nav bottom-nav">
            <Link href={`${base}/settings`} className={section === 'settings' ? 'active' : ''}>
              <Settings size={21} />
              <span>Settings</span>
            </Link>
            <Link href={`${base}/billing`} className={section === 'billing' ? 'active' : ''}>
              <CreditCard size={21} />
              <span>Billing</span>
            </Link>
          </nav>
          <div className="account-wrap">
            <button
              className="sidebar-account"
              onClick={() => setAccount(!account)}
              aria-expanded={account}
            >
              <span className="avatar gray">
                {userName
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <span>
                <strong>{userName}</strong>
                <small>
                  {role === 'owner' ? 'Owner' : role === 'staff' ? 'Team member' : 'Viewer'}
                </small>
              </span>
              <ChevronDown size={15} />
            </button>
            {account && (
              <div className="account-popover">
                <Link href={`${base}/settings`}>
                  <Settings size={16} />
                  Account settings
                </Link>
                <button
                  onClick={async () => {
                    if (demo) {
                      router.push('/');
                      return;
                    }
                    await fetch('/api/auth', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'signout' }),
                    });
                    router.push('/signin');
                  }}
                >
                  <LogOut size={16} />
                  {demo ? 'Leave demo' : 'Sign out'}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <div className="workspace-main" id="workspace-content">
        <header className="workspace-topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebar(true)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            <span>{businessName}</span>
            <ChevronRight size={13} />
            <strong>
              {section === 'assistant'
                ? 'AI assistant'
                : section.charAt(0).toUpperCase() + section.slice(1)}
            </strong>
          </div>
          <div className="topbar-actions">
            {demo && (
              <span className="demo-label">
                <span />
                Demo workspace
              </span>
            )}
            <button
              className="icon-button help-button"
              aria-label="Help"
              onClick={() => setModal('help')}
            >
              <CircleHelp size={19} />
            </button>
            <div className="notification-wrap">
              <button
                className="icon-button notification-button"
                aria-label="Notifications"
                aria-expanded={notifications}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={20} />
                {demo && <i />}
              </button>
              {notifications && (
                <div className="notification-popover">
                  <div>
                    <strong>You’re in the loop.</strong>
                    <span>{demo ? 'Demo notifications' : 'Your notifications'}</span>
                  </div>
                  {demo ? (
                    <>
                      {[
                        {
                          name: 'Jessica requested a callback',
                          time: '12 minutes ago',
                          id: 'demo-jessica',
                        },
                        {
                          name: 'Daniel’s inspection is on the calendar',
                          time: '35 minutes ago',
                          id: 'demo-daniel',
                        },
                        {
                          name: 'A new storm damage enquiry arrived',
                          time: '1 hour ago',
                          id: 'demo-emily',
                        },
                      ].map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            setSelected(n.id);
                            setDetailOpen(true);
                            setNotifications(false);
                            setToast(n.name);
                          }}
                        >
                          <span className="notification-dot" />
                          <span>
                            {n.name}
                            <small>{n.time}</small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </>
                  ) : live?.notifications?.length ? (
                    live.notifications.map((n) => (
                      <button
                        key={String(n.id)}
                        onClick={() => {
                          if (n.lead_id) openLead(String(n.lead_id));
                          setNotifications(false);
                          setToast(String(n.message || 'Workspace update'));
                        }}
                      >
                        <span className="notification-dot" />
                        <span>
                          {String(n.message || 'Workspace update')}
                          <small>{new Date(String(n.created_at)).toLocaleDateString()}</small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))
                  ) : (
                    <p>No new notifications.</p>
                  )}
                </div>
              )}
            </div>
            <span className="topbar-divider" />
            <button
              className="avatar gray topbar-avatar"
              aria-label="Open account settings"
              onClick={() => {
                router.push(`${base}/settings`);
              }}
            >
              {userName
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </button>
          </div>
        </header>
        <main
          className={`workspace-content section-${section} ${detailOpen ? 'detail-is-open' : ''}`}
        >
          <div className="page-heading">
            <div>
              <div className="page-overline">
                {section === 'overview'
                  ? 'A GOOD DAY TO MAKE CONNECTIONS'
                  : section === 'inbox'
                    ? 'EVERY CONVERSATION, IN ONE PLACE'
                    : section === 'leads'
                      ? 'YOUR NEXT OPPORTUNITY STARTS HERE'
                      : section === 'calendar'
                        ? 'MAKE ROOM FOR WHAT’S NEXT'
                        : section === 'assistant'
                          ? 'A LITTLE BACKUP FOR YOUR BUSINESS'
                          : section === 'billing'
                            ? 'SIMPLE. CLEAR. ALL IN ONE PLACE.'
                            : 'MAKE YOURSELF AT HOME'}
              </div>
              <h1>
                {section === 'overview' ? (
                  <>
                    Your missed calls. <span>Recovered.</span>
                  </>
                ) : section === 'inbox' ? (
                  'Let’s keep things moving.'
                ) : section === 'leads' ? (
                  'Good leads. Clear next steps.'
                ) : section === 'calendar' ? (
                  'A little more organized.'
                ) : section === 'assistant' ? (
                  'Meet your extra pair of hands.'
                ) : section === 'billing' ? (
                  'A plan that works for you.'
                ) : (
                  'Your business, your way.'
                )}
              </h1>
              <p>
                {section === 'overview'
                  ? 'See who needs help and keep every enquiry moving.'
                  : section === 'inbox'
                    ? 'Pick up the conversation. Make the next connection.'
                    : section === 'leads'
                      ? 'Every enquiry, every detail, and the next thing to do.'
                      : section === 'calendar'
                        ? 'Your inspections and requests, with a little room to breathe.'
                        : section === 'assistant'
                          ? 'Helpful by design. Guided by you.'
                          : section === 'billing'
                            ? 'Know where you stand. No surprises.'
                            : 'The details that help your assistant get it right.'}
              </p>
            </div>
            {section === 'overview' ? (
              <label className="date-select">
                <CalendarDays size={17} />
                <select
                  aria-label="Date range"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                >
                  <option>Last 7 days</option>
                  <option>Last 30 days</option>
                </select>
                <ChevronDown size={15} />
              </label>
            ) : section === 'leads' ? (
              <div className="heading-buttons">
                <button className="button secondary small" onClick={exportLeads}>
                  <Download size={16} />
                  Export
                </button>
                <button
                  className="button primary small"
                  onClick={() => setModal('new-lead')}
                  disabled={!demo}
                >
                  <Plus size={17} />
                  New enquiry
                </button>
              </div>
            ) : section === 'calendar' ? (
              <button
                className="button primary small"
                onClick={() => setModal('booking')}
                disabled={!active}
              >
                <Plus size={17} />
                Request inspection
              </button>
            ) : null}
          </div>
          {loading ? (
            <div className="loading-state">
              <Loader2 className="spin" />
              <p>Getting your workspace ready…</p>
            </div>
          ) : loadError ? (
            <div className="empty-state panel">
              <ShieldCheck />
              <h2>Let’s reconnect.</h2>
              <p>{loadError}</p>
              <button className="button primary small" onClick={loadWorkspace}>
                Try again
              </button>
              <Link href="/signin" className="text-link">
                Back to sign in
              </Link>
            </div>
          ) : !demo && !live?.business ? (
            <div className="onboarding-panel panel">
              <span className="large-icon">
                <House />
              </span>
              <span className="eyebrow">LET’S MAKE THIS YOURS</span>
              <h2>First, a home for your business.</h2>
              <p>
                Create your workspace. Then we’ll walk through your phone, messaging, and test call
                before starting your trial.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void mutate('create-business', {
                    name: form.get('name'),
                    timezone: form.get('timezone'),
                    zipCodes: String(form.get('zipCodes'))
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                }}
              >
                <label>
                  Business name
                  <input name="name" required maxLength={100} placeholder="Summit Roofing" />
                </label>
                <label>
                  Service ZIP codes
                  <input name="zipCodes" required placeholder="75201, 75204" maxLength={600} />
                </label>
                <label>
                  Business timezone
                  <select name="timezone">
                    <option>America/Chicago</option>
                    <option>America/New_York</option>
                    <option>America/Denver</option>
                    <option>America/Los_Angeles</option>
                    <option>America/Phoenix</option>
                  </select>
                </label>
                <button className="button primary" disabled={busy}>
                  Create workspace <ArrowRight size={17} />
                </button>
              </form>
            </div>
          ) : (
            <>
              {section === 'overview' && (
                <>
                  <div className="trial-banner">
                    <div>
                      <span className="trial-clock">
                        <Clock3 size={20} />
                      </span>
                      <strong>
                        {demo
                          ? '10 days left in your trial'
                          : live?.business?.state === 'trial_active'
                            ? 'Your trial is active'
                            : live?.business?.state === 'paid_active'
                              ? 'Your plan is active'
                              : live?.business?.state === 'automation_paused'
                                ? 'Automation is paused'
                                : 'Let’s get your business connected'}
                      </strong>
                      <span className="trial-banner-divider" />
                      <span className="trial-banner-description">
                        {demo
                          ? 'A little time to see what’s possible.'
                          : live?.entitlements?.automation_enabled
                            ? 'Your team is ready for the next enquiry.'
                            : 'Complete activation or review your automation status.'}
                      </span>
                    </div>
                    <div>
                      <Link href={`${base}/billing`} className="button secondary small">
                        View plan <ArrowUpRight size={14} />
                      </Link>
                      <span className="trial-banner-divider" />
                      <span className="phone-connected">
                        <span className={`live-dot ${!demo ? 'muted' : ''}`} />
                        <Phone size={16} />
                        {demo
                          ? 'Phone connected'
                          : settings.assistant
                            ? 'Automation ready'
                            : 'Setup required'}
                      </span>
                    </div>
                  </div>
                  <div className="metrics-grid">
                    {[
                      {
                        key: 'missedCalls',
                        label: demo ? 'Missed calls' : 'Eligible missed calls',
                        icon: PhoneMissed,
                        color: 'red',
                        trend: '+8',
                        note: 'Every call is an opportunity',
                      },
                      {
                        key: 'customerReplies',
                        label: 'Customer replies',
                        icon: MessageSquare,
                        color: 'green',
                        trend: '+6',
                        note: 'Conversations worth having',
                      },
                      {
                        key: 'qualifiedLeads',
                        label: 'Qualified leads',
                        icon: Users,
                        color: 'green',
                        trend: '+4',
                        note: 'Ready for your next step',
                      },
                      {
                        key: 'inspectionsBooked',
                        label: 'Inspections booked',
                        icon: CalendarDays,
                        color: 'blue',
                        trend: '+2',
                        note: 'Good things on the calendar',
                      },
                    ].map((m) => (
                      <div className="metric-card panel" key={m.key}>
                        <div className="metric-top">
                          <span className={`metric-icon ${m.color}`}>
                            <m.icon size={21} />
                          </span>
                          <span>{m.label}</span>
                          <MoreHorizontal size={17} />
                        </div>
                        <div className="metric-number">
                          {metrics[m.key] ?? 0}
                          <span
                            className={`mini-chart ${demo ? '' : 'invisible'}`}
                            aria-hidden="true"
                          >
                            {[22, 35, 27, 49, 37, 55, 72, 61, 83, 75, 96].map((h, i) => (
                              <i key={i} style={{ height: `${h}%` }} />
                            ))}
                          </span>
                        </div>
                        <div className="metric-bottom">
                          <span>{timeframe}</span>
                          {demo && (
                            <span className="metric-change">
                              <ArrowUpRight size={12} />
                              {m.trend} <span>vs. prior period</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="dashboard-grid">
                    <section className="recent-enquiries panel">
                      <div className="panel-heading">
                        <h2>
                          Recent enquiries{' '}
                          <span className="count-pill">{demo ? 42 : leads.length}</span>
                        </h2>
                        <Link href={`${base}/leads`} className="text-link">
                          View all leads <ArrowRight size={16} />
                        </Link>
                      </div>
                      {FilterTabs()}
                      {EnquiryTable({})}
                      {active && (
                        <div className="callback-notice">
                          <span className="callback-bell">
                            <Bell size={18} />
                          </span>
                          <span>
                            <strong>{active.name.split(' ')[0]}</strong>{' '}
                            {active.status === 'Needs callback'
                              ? 'requested a callback about a ' + active.service.toLowerCase() + '.'
                              : 'has a ' + active.service.toLowerCase() + ' enquiry ready for you.'}
                          </span>
                          <button
                            className="button secondary small"
                            onClick={() => {
                              setDetailOpen(true);
                              setToast('Lead details opened below.');
                            }}
                          >
                            Open lead <ArrowRight size={15} />
                          </button>
                        </div>
                      )}
                      <div className="enquiries-footer">
                        <span>
                          <span className="live-dot" />{' '}
                          {demo
                            ? 'All caught up. We’ll keep an eye on the next call.'
                            : 'Your enquiries are saved in this workspace.'}
                        </span>
                        <span>Workspace loaded</span>
                      </div>
                    </section>
                    {Conversation({ expanded: detailOpen })}
                  </div>
                  {!demo && (
                    <div className="analytics-strip panel">
                      {[
                        ['Total calls', metrics.totalCalls],
                        ['Recovery attempts', metrics.recoveryAttempts],
                        ['Delivered SMS', metrics.deliveredMessages],
                        ['Owner-confirmed wins', metrics.ownerConfirmedWins],
                      ].map(([label, value]) => (
                        <div key={String(label)}>
                          <span>{label}</span>
                          <strong>{value ?? 0}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="dashboard-bottom">
                    <span>
                      <ShieldCheck size={14} /> Every enquiry has a place. Every customer has a next
                      step.
                    </span>
                    <span>
                      {demo
                        ? 'All figures are illustrative demo data.'
                        : 'Metrics reflect recorded events, not attributed revenue.'}
                    </span>
                  </div>
                </>
              )}
              {section === 'inbox' && (
                <div className="inbox-layout panel">
                  <section className="inbox-list">
                    <div className="inbox-list-heading">
                      <h2>
                        Conversations <span className="count-pill">{leads.length}</span>
                      </h2>
                      <button
                        className="icon-button"
                        aria-label="Filter attention-needed conversations"
                        onClick={() => setFilter(filter === 'All' ? 'Needs attention' : 'All')}
                      >
                        <SlidersHorizontal size={17} />
                      </button>
                    </div>
                    <div className="search-input">
                      <Search size={16} />
                      <input
                        aria-label="Search conversations"
                        placeholder="Find a conversation…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    {FilterTabs()}
                    {filtered.map((l) => (
                      <button
                        className={`inbox-item ${active?.id === l.id ? 'selected' : ''}`}
                        key={l.id}
                        onClick={() => openLead(l.id)}
                      >
                        <Avatar lead={l} />
                        <div>
                          <div>
                            <strong>{l.name}</strong>
                            <small>{l.received}</small>
                          </div>
                          <p>{l.messages.at(-1)?.text || l.service}</p>
                          <Status status={l.status} />
                        </div>
                      </button>
                    ))}
                    {!filtered.length && (
                      <div className="empty-state">
                        <Search />
                        <p>No conversations match.</p>
                      </div>
                    )}
                  </section>
                  {Conversation({ expanded: true })}
                </div>
              )}
              {section === 'leads' && (
                <>
                  <div className="leads-summary">
                    {[
                      ['All enquiries', leads.length],
                      [
                        'Need a callback',
                        leads.filter((l) => l.status === 'Needs callback').length,
                      ],
                      [
                        'Qualified',
                        leads.filter((l) => ['Qualified', 'Booked'].includes(l.status)).length,
                      ],
                      ['Owner-confirmed wins', leads.filter((l) => l.status === 'Won').length],
                    ].map(([label, value]) => (
                      <div className="panel" key={String(label)}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <section className="panel leads-panel">
                    <div className="leads-toolbar">
                      {FilterTabs()}
                      <div className="search-input">
                        <Search size={16} />
                        <input
                          aria-label="Search leads"
                          placeholder="Search names, services, phone…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                    </div>
                    {EnquiryTable({ full: true })}
                    <div className="table-footer">
                      <span>
                        {filtered.length} {filtered.length === 1 ? 'enquiry' : 'enquiries'}
                      </span>
                      <span>Job wins are recorded by your team.</span>
                    </div>
                  </section>
                  {detailOpen && (
                    <div className="lead-drawer-backdrop" onClick={() => setDetailOpen(false)}>
                      <aside className="lead-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="drawer-heading">
                          <span>ENQUIRY DETAILS</span>
                          <button
                            className="icon-button"
                            aria-label="Close lead details"
                            onClick={() => setDetailOpen(false)}
                          >
                            <X size={20} />
                          </button>
                        </div>
                        {Conversation({ expanded: true })}
                      </aside>
                    </div>
                  )}
                </>
              )}
              {section === 'calendar' && (
                <>
                  <div className="calendar-notice">
                    <Info size={17} />
                    <span>
                      {demo
                        ? 'You’re viewing a sample calendar. New inspections are saved as demo requests.'
                        : 'Requests remain unconfirmed until customer confirmation and successful provider creation.'}
                    </span>
                    <button
                      className="text-link"
                      onClick={() => {
                        setSettingsTab('Phone & messaging');
                        router.push(`${base}/settings`);
                      }}
                    >
                      Manage connection <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="calendar-panel panel">
                    <div className="calendar-toolbar">
                      <div>
                        <h2>
                          {calendarDate.toLocaleDateString('en-US', {
                            month: 'long',
                            year: 'numeric',
                          })}
                        </h2>
                        <button
                          className="icon-button"
                          aria-label="Previous month"
                          onClick={() =>
                            setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                          }
                        >
                          <ChevronLeft size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Next month"
                          onClick={() =>
                            setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                          }
                        >
                          <ChevronRight size={17} />
                        </button>
                        <button
                          className="button secondary small"
                          onClick={() => setCalendarDate(new Date())}
                        >
                          Today
                        </button>
                      </div>
                      <div className="segmented">
                        {['Month', 'Agenda'].map((v) => (
                          <button
                            className={calendarView === v ? 'selected' : ''}
                            key={v}
                            onClick={() => setCalendarView(v)}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    {calendarView === 'Month' ? (
                      <>
                        <div className="calendar-weekdays">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                            <span key={day}>{day}</span>
                          ))}
                        </div>
                        <div className="calendar-grid">
                          {Array.from({ length: 35 }, (_, i) => {
                            const day =
                              i -
                              new Date(
                                calendarDate.getFullYear(),
                                calendarDate.getMonth(),
                                1,
                              ).getDay() +
                              1;
                            const date = new Date(
                              calendarDate.getFullYear(),
                              calendarDate.getMonth(),
                              day,
                            );
                            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                            return (
                              <div
                                className={`calendar-cell ${date.getMonth() !== calendarDate.getMonth() ? 'outside' : ''} ${key === '2026-10-30' ? 'today' : ''}`}
                                key={i}
                              >
                                <span>{date.getDate()}</span>
                                {bookings
                                  .filter((b) => b.date === key)
                                  .map((b) => (
                                    <button
                                      key={b.id}
                                      className={`calendar-event ${b.status === 'Request' ? 'request' : ''}`}
                                      onClick={() => {
                                        openLead(b.leadId);
                                        setToast(`${b.status}: ${b.name} · ${b.time}`);
                                      }}
                                    >
                                      <strong>
                                        {b.time} · {b.name.split(' ')[0]}
                                      </strong>
                                      <span>{b.service}</span>
                                    </button>
                                  ))}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="agenda-list">
                        {bookings.length ? (
                          bookings
                            .sort((a, b) => a.date.localeCompare(b.date))
                            .map((b) => (
                              <div key={b.id}>
                                <span className="agenda-date">
                                  {new Date(`${b.date}T12:00:00`).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </span>
                                <div>
                                  <strong>{b.name}</strong>
                                  <span>
                                    {b.service} · {b.time}
                                  </span>
                                </div>
                                <span
                                  className={`badge ${b.status === 'Confirmed' ? 'green' : 'amber'}`}
                                >
                                  {demo ? 'Demo ' : ''}
                                  {b.status}
                                </span>
                              </div>
                            ))
                        ) : (
                          <div className="empty-state">
                            <CalendarDays />
                            <h3>A little room for opportunity.</h3>
                            <p>Your inspection requests will appear here.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="calendar-legend">
                    <span>
                      <i />
                      Inspection
                    </span>
                    <span>
                      <i className="request" />
                      Awaiting confirmation
                    </span>
                    <span>{settings.timezone} · 60-minute inspections · 15-minute buffer</span>
                  </div>
                </>
              )}
              {section === 'assistant' && (
                <div className="assistant-grid">
                  <div className="panel assistant-overview">
                    <div className="assistant-orb">
                      <Sparkles size={35} />
                      <span />
                    </div>
                    <span className="eyebrow">MEET YOUR FIRST HELLO</span>
                    <h2>
                      Always thoughtful.
                      <br />
                      Always on your team.
                    </h2>
                    <p>
                      Your assistant starts the conversation, collects the details, and knows when
                      to bring you in.
                    </p>
                    <div className="assistant-state">
                      <span className={`live-dot ${!settings.assistant ? 'muted' : ''}`} />
                      <strong>
                        {settings.assistant ? 'Ready to lend a hand' : 'Automation paused'}
                      </strong>
                      <button
                        className={`toggle ${settings.assistant ? 'on' : ''}`}
                        role="switch"
                        aria-checked={settings.assistant}
                        aria-label="Assistant automation"
                        onClick={() => {
                          if (!demo) {
                            setToast(
                              'Live automation follows verified activation and entitlement state.',
                            );
                            return;
                          }
                          const next = { ...settings, assistant: !settings.assistant };
                          setSettings(next);
                          persist(leads, next);
                          setToast(
                            next.assistant ? 'Demo assistant enabled.' : 'Demo assistant paused.',
                          );
                        }}
                      >
                        <span />
                      </button>
                    </div>
                    <div className="assistant-safety">
                      <ShieldCheck size={18} />
                      <p>Consent, quiet hours, and your team’s takeover always come first.</p>
                    </div>
                  </div>
                  <div className="assistant-right">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Your playbook</h2>
                        <Link className="text-link" href={`${base}/settings`}>
                          Edit details <ArrowUpRight size={15} />
                        </Link>
                      </div>
                      <div className="playbook-row">
                        <span className="metric-icon green">
                          <Wrench size={19} />
                        </span>
                        <div>
                          <h4>Your services</h4>
                          <p>{settings.services}</p>
                        </div>
                        <Check size={17} />
                      </div>
                      <div className="playbook-row">
                        <span className="metric-icon blue">
                          <MapPin size={19} />
                        </span>
                        <div>
                          <h4>Your service area</h4>
                          <p>{settings.zipCodes}</p>
                        </div>
                        <Check size={17} />
                      </div>
                      <div className="playbook-row">
                        <span className="metric-icon purple">
                          <FileText size={19} />
                        </span>
                        <div>
                          <h4>Your boundaries</h4>
                          <p>{settings.restrictions}</p>
                        </div>
                        <ShieldCheck size={18} />
                      </div>
                    </section>
                    <section className="panel assistant-preview">
                      <div className="panel-heading">
                        <h2>Try a conversation</h2>
                        <span className="badge gray">
                          {demo ? 'Demo preview' : 'Preview unavailable'}
                        </span>
                      </div>
                      <p>See how your approved facts guide a first reply.</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!demo) {
                            setToast('Live AI actions require a verified eligible conversation.');
                            return;
                          }
                          const text = assistantInput.toLowerCase();
                          setAssistantReply(
                            /secret|ignore|system|prompt|password|api key/.test(text)
                              ? 'I can help with your roofing enquiry. What kind of work do you need help with?'
                              : /price|cost|insurance|warranty/.test(text)
                                ? 'Our team can discuss that after learning more about your roof. Would you like to request a callback?'
                                : /fire|collapse|danger|electri/.test(text)
                                  ? 'Please move to a safe location and contact local emergency services if there is immediate danger. I’ll flag this for the team.'
                                  : 'Thanks for getting in touch with Summit Roofing! Could you tell me your ZIP code and a little more about the roofing help you need?',
                          );
                        }}
                      >
                        <div className="search-input">
                          <MessageSquare size={17} />
                          <input
                            placeholder="e.g. Can you help with a roof leak?"
                            aria-label="Try a demo message"
                            value={assistantInput}
                            onChange={(e) => setAssistantInput(e.target.value)}
                            maxLength={300}
                            required
                          />
                          <button
                            className="icon-button"
                            type="submit"
                            aria-label="Preview assistant reply"
                          >
                            <ArrowRight size={18} />
                          </button>
                        </div>
                      </form>
                      {assistantReply && (
                        <div className="assistant-preview-reply">
                          <Sparkles size={16} />
                          <p>
                            {assistantReply}
                            <small>Scripted demo · no AI API request was made</small>
                          </p>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              )}
              {section === 'settings' && (
                <div className="settings-layout">
                  <nav className="settings-nav">
                    {['Business profile', 'Phone & messaging', 'Team', 'Notifications'].map(
                      (tab) => (
                        <button
                          key={tab}
                          className={settingsTab === tab ? 'active' : ''}
                          onClick={() => setSettingsTab(tab)}
                        >
                          {tab}
                          <ChevronRight size={15} />
                        </button>
                      ),
                    )}
                  </nav>
                  <div className="settings-content">
                    {!demo && <MfaEnrollment />}
                    {settingsTab === 'Business profile' ? (
                      <form className="panel settings-form" onSubmit={saveSettings}>
                        <div className="panel-heading">
                          <div>
                            <h2>The details that make you, you.</h2>
                            <p>Your assistant uses these approved facts.</p>
                          </div>
                          <span className="workspace-icon">
                            <House size={23} />
                          </span>
                        </div>
                        <div className="form-grid">
                          <label>
                            Business name
                            <input
                              value={settings.name}
                              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                              required
                              maxLength={100}
                            />
                          </label>
                          <label>
                            Timezone
                            <select
                              value={settings.timezone}
                              onChange={(e) =>
                                setSettings({ ...settings, timezone: e.target.value })
                              }
                            >
                              {[
                                'America/Chicago',
                                'America/New_York',
                                'America/Denver',
                                'America/Los_Angeles',
                                'America/Phoenix',
                              ].map((t) => (
                                <option key={t}>{t}</option>
                              ))}
                            </select>
                          </label>
                          <label className="full-field">
                            Services offered
                            <input
                              value={settings.services}
                              onChange={(e) =>
                                setSettings({ ...settings, services: e.target.value })
                              }
                              required
                              maxLength={800}
                            />
                            <small>Separate your services with a comma.</small>
                          </label>
                          <label className="full-field">
                            Service area ZIP codes
                            <input
                              value={settings.zipCodes}
                              onChange={(e) =>
                                setSettings({ ...settings, zipCodes: e.target.value })
                              }
                              pattern="[0-9, ]*"
                              maxLength={1000}
                            />
                          </label>
                          <fieldset className="full-field hours-fieldset">
                            <legend>Business hours · {settings.timezone}</legend>
                            {Object.entries(openingHours).map(([day, value]) => (
                              <div className="hours-row" key={day}>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={value.enabled !== false}
                                    onChange={(e) =>
                                      setOpeningHours({
                                        ...openingHours,
                                        [day]: { ...value, enabled: e.target.checked },
                                      })
                                    }
                                  />
                                  {day.toUpperCase()}
                                </label>
                                <input
                                  aria-label={`${day} opening time`}
                                  type="time"
                                  value={value.open}
                                  disabled={value.enabled === false}
                                  onChange={(e) =>
                                    setOpeningHours({
                                      ...openingHours,
                                      [day]: { ...value, open: e.target.value },
                                    })
                                  }
                                />
                                <span>to</span>
                                <input
                                  aria-label={`${day} closing time`}
                                  type="time"
                                  value={value.close}
                                  disabled={value.enabled === false}
                                  onChange={(e) =>
                                    setOpeningHours({
                                      ...openingHours,
                                      [day]: { ...value, close: e.target.value },
                                    })
                                  }
                                />
                              </div>
                            ))}
                          </fieldset>
                          <label className="full-field">
                            Approved FAQs · one Question | Answer per line
                            <textarea
                              value={settings.faqs}
                              onChange={(e) => setSettings({ ...settings, faqs: e.target.value })}
                              rows={3}
                              maxLength={5000}
                            />
                          </label>
                          <label className="full-field">
                            Assistant restrictions
                            <textarea
                              value={settings.restrictions}
                              onChange={(e) =>
                                setSettings({ ...settings, restrictions: e.target.value })
                              }
                              rows={3}
                              maxLength={3000}
                            />
                          </label>
                        </div>
                        <div className="settings-form-footer">
                          <span>
                            <ShieldCheck size={15} /> Only owners can change business details.
                          </span>
                          <button
                            className="button primary small"
                            disabled={busy || role !== 'owner'}
                          >
                            {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                            Save changes
                          </button>
                        </div>
                      </form>
                    ) : settingsTab === 'Phone & messaging' ? (
                      <div className="settings-stack">
                        {!demo && role === 'owner' && (
                          <PhoneSetup
                            businessId={String(live?.business?.id)}
                            onChanged={() => void loadWorkspace()}
                          />
                        )}{' '}
                        {demo && (
                          <section className="panel integration-card">
                            <div className="panel-heading">
                              <span className="metric-icon green">
                                <Phone size={22} />
                              </span>
                              <div>
                                <h2>Your business phone</h2>
                                <p>Keep the phone ringing. Keep the enquiries moving.</p>
                              </div>
                              <span className={`badge ${demo ? 'green' : 'gray'}`}>
                                {demo ? 'Demo connected' : 'Setup required'}
                              </span>
                            </div>
                            <div className="integration-detail">
                              <span>LeadRescue number</span>
                              <strong>{demo ? settings.phone : 'Not assigned'}</strong>
                            </div>
                            <div className="integration-detail">
                              <span>Verified forwarding destination</span>
                              <strong>
                                {demo ? settings.destination : 'Verification required'}
                              </strong>
                            </div>
                            <div className="notice">
                              <Info size={17} />
                              <span>
                                Forwarding destinations must be verified before activation. Your
                                number cannot forward to itself.
                              </span>
                            </div>
                            <button
                              className="button secondary small"
                              onClick={() =>
                                setToast(
                                  demo
                                    ? 'Demo phone connection. No real phone number is provisioned.'
                                    : 'Use the verified phone setup form above. Routing changes require operator verification.',
                                )
                              }
                            >
                              <Settings size={16} />
                              Manage phone setup
                            </button>
                          </section>
                        )}
                        <section className="panel integration-card">
                          <div className="panel-heading">
                            <span className="metric-icon blue">
                              <MessageSquare size={22} />
                            </span>
                            <div>
                              <h2>Messaging & consent</h2>
                              <p>Good conversations start with permission.</p>
                            </div>
                          </div>
                          <div className="integration-detail">
                            <span>Messaging registration</span>
                            <strong>
                              {demo ? 'Approved · demo only' : 'See verified phone setup status'}
                            </strong>
                          </div>
                          <div className="integration-detail">
                            <span>Quiet hours</span>
                            <strong>8 PM – 8 AM · business local time</strong>
                          </div>
                          <p className="subtle">
                            Missed calls never grant consent automatically. STOP suppresses queued
                            messages. Ineligible enquiries stay available for a manual callback.
                          </p>
                        </section>
                        <section className="panel integration-card">
                          <div className="panel-heading">
                            <span className="metric-icon purple">
                              <CalendarDays size={22} />
                            </span>
                            <div>
                              <h2>Google Calendar</h2>
                              <p>Make the next step a little easier.</p>
                            </div>
                          </div>
                          <button
                            className="button secondary small"
                            onClick={() =>
                              demo
                                ? setToast(
                                    'Demo connection preview. No Google account was accessed.',
                                  )
                                : void mutate('calendar-connect')
                            }
                          >
                            <ExternalLink size={16} />
                            Connect calendar
                          </button>
                        </section>
                      </div>
                    ) : settingsTab === 'Team' ? (
                      <section className="panel team-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>Good work takes a team.</h2>
                            <p>Give everyone the access they need.</p>
                          </div>
                          <button
                            className="button primary small"
                            onClick={() => setModal('invite')}
                            disabled={role !== 'owner'}
                          >
                            <Plus size={16} />
                            Invite member
                          </button>
                        </div>
                        <div className="team-row">
                          <span className="avatar gray">
                            {userName
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')}
                          </span>
                          <div>
                            <strong>{userName}</strong>
                            <span>
                              {demo ? 'alex@example.com' : String(live?.user?.email || '')}
                            </span>
                          </div>
                          <span className="badge green">{role}</span>
                        </div>
                        <div className="notice">
                          <ShieldCheck size={18} />
                          <span>
                            Owners manage billing and integrations. Staff handle enquiries. Viewers
                            have read access. Invitations expire after 48 hours.
                          </span>
                        </div>
                      </section>
                    ) : (
                      <section className="panel notification-settings">
                        <div className="panel-heading">
                          <div>
                            <h2>The right nudge, at the right time.</h2>
                            <p>Keep important updates within reach.</p>
                          </div>
                          <Bell size={23} />
                        </div>
                        {[
                          ['New enquiries', 'Know when a new opportunity comes in.'],
                          ['Callback requests', 'A customer needs a human. We’ll let you know.'],
                          ['Inspection requests', 'Keep the next appointment on your radar.'],
                          [
                            'Trial & billing updates',
                            'Essential account notifications stay enabled.',
                          ],
                        ].map(([title, description], i) => (
                          <div className="notification-setting" key={title}>
                            <div>
                              <h4>{title}</h4>
                              <p>{description}</p>
                            </div>
                            <button
                              className={`toggle ${settings.notifications || i === 3 ? 'on' : ''}`}
                              role="switch"
                              aria-label={title}
                              aria-checked={settings.notifications || i === 3}
                              disabled={i === 3}
                              onClick={() => {
                                if (!demo) {
                                  setToast(
                                    'Notification preferences require a configured delivery provider.',
                                  );
                                  return;
                                }
                                const next = {
                                  ...settings,
                                  notifications: !settings.notifications,
                                };
                                setSettings(next);
                                persist(leads, next);
                              }}
                            >
                              <span />
                            </button>
                          </div>
                        ))}
                      </section>
                    )}
                  </div>
                </div>
              )}
              {section === 'billing' && (
                <div className="billing-grid">
                  <div className="billing-main">
                    <section className="panel current-plan">
                      {!demo && !live?.business?.trial_started_at && (
                        <div className="notice activation-notice">
                          <Clock3 size={18} />
                          <span>
                            Your trial begins after verified business, phone, messaging, and
                            live-test prerequisites.
                          </span>
                          <button
                            className="text-link"
                            onClick={() => void mutate('activate-trial')}
                            disabled={busy || role !== 'owner'}
                          >
                            Check & activate trial
                          </button>
                        </div>
                      )}
                      <div className="panel-heading">
                        <span className="eyebrow">YOUR CURRENT PLAN</span>
                        <span className={`badge ${demo ? 'green' : 'gray'}`}>
                          {demo
                            ? '14-day trial'
                            : String(live?.subscription?.status || 'Not activated')}
                        </span>
                      </div>
                      <h2>LeadRescue</h2>
                      <div className="price">
                        {planPrice}
                        <span> / month after trial</span>
                      </div>
                      <p>A little backup for every part of your day.</p>
                      <ul className="feature-checks">
                        {[
                          'A shared inbox and unlimited team members',
                          'Two-way SMS and AI lead qualification',
                          'Inspection requests and calendar integration',
                          `${paidPlan.paidSmsLimit} outbound SMS segments + ${paidPlan.paidAiLimit} AI replies / month`,
                        ].map((x) => (
                          <li key={x}>
                            <Check size={16} />
                            {x}
                          </li>
                        ))}
                      </ul>
                      <div className="plan-buttons">
                        <button
                          className="button primary small"
                          onClick={() => setModal('plan')}
                          disabled={role !== 'owner'}
                        >
                          Choose your plan <ArrowRight size={16} />
                        </button>
                        <button
                          className="button secondary small"
                          onClick={() =>
                            demo
                              ? setToast(
                                  'Billing portal is unavailable in the demo. No payment account is connected.',
                                )
                              : void mutate('billing-portal')
                          }
                          disabled={role !== 'owner'}
                        >
                          Manage billing <ExternalLink size={15} />
                        </button>
                      </div>
                    </section>
                    <section className="panel usage-panel">
                      <div className="panel-heading">
                        <h2>A clear view of your usage</h2>
                        <span>{demo ? 'Trial allowance' : 'Current period'}</span>
                      </div>
                      {[
                        {
                          label: 'Outbound SMS segments',
                          used: demo ? 42 : Number(live?.entitlements?.sms_used || 0),
                          total: demo ? 100 : Number(live?.entitlements?.sms_limit || 0),
                        },
                        {
                          label: 'AI replies',
                          used: demo ? 31 : Number(live?.entitlements?.ai_used || 0),
                          total: demo ? 100 : Number(live?.entitlements?.ai_limit || 0),
                        },
                      ].map((u) => (
                        <div className="usage-row" key={u.label}>
                          <div>
                            <strong>{u.label}</strong>
                            <span>
                              {u.used} <span>/ {u.total}</span>
                            </span>
                          </div>
                          <div className="progress-track">
                            <span
                              style={{
                                width: `${u.total ? Math.min((u.used / u.total) * 100, 100) : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                      <div className="notice">
                        <ShieldCheck size={17} />
                        <span>
                          Automatic overages are off. Automation pauses at your allowance. Call
                          routing and manual callbacks remain available.
                        </span>
                      </div>
                    </section>
                    <section className="panel invoice-panel">
                      <div className="panel-heading">
                        <h2>Billing history</h2>
                        <FileText size={20} />
                      </div>
                      <div className="empty-state">
                        <CreditCard size={27} />
                        <h3>A fresh start.</h3>
                        <p>
                          {demo
                            ? 'There are no invoices in this demo. No payment has been collected.'
                            : 'Invoices appear after your billing provider confirms them.'}
                        </p>
                      </div>
                    </section>
                  </div>
                  <aside className="billing-side">
                    <div className="trial-side-card">
                      <span className="large-icon">
                        <Clock3 size={27} />
                      </span>
                      <h3>
                        {demo ? '10 days to see the difference.' : 'Your trial waits for you.'}
                      </h3>
                      <p>
                        {demo
                          ? 'Your sample trial is underway. Explore your inbox, meet your assistant, and make yourself at home.'
                          : 'Your 14 days begin after phone, messaging, and a successful live test are ready.'}
                      </p>
                      <Link className="text-link" href={base}>
                        Back to your workspace <ArrowRight size={16} />
                      </Link>
                    </div>
                    <div className="billing-cancel">
                      <h4>Need to make a change?</h4>
                      <p>You’re in control of your subscription.</p>
                      <button
                        className="text-link"
                        disabled={role !== 'owner'}
                        onClick={() =>
                          demo
                            ? setToast('Demo only. There is no active subscription to cancel.')
                            : void mutate('cancel-subscription')
                        }
                      >
                        Cancel subscription <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </aside>
                </div>
              )}
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>Made for the work ahead.</span>
          <div>
            <span className="live-dot" />
            {demo ? 'Demo systems running' : 'Workspace connected'}
            <span>·</span>
            <button onClick={() => setModal('help')}>Need a hand?</button>
          </div>
        </footer>
      </div>
      {privateLink && (
        <div className="private-link-banner" role="status">
          <ShieldCheck size={19} />
          <div>
            <strong>Private recipient link ready.</strong>
            <p>Share this only with the intended recipient. It is not sent automatically.</p>
            <input aria-label="Private recipient link" type="text" readOnly value={privateLink} />
          </div>
          <button
            className="button secondary small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(privateLink);
                setToast('Private link copied.');
              } catch {
                setToast('Select the link and copy it securely.');
              }
            }}
          >
            Copy link
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss private link"
            onClick={() => setPrivateLink('')}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={21} />
            </button>
            <span className="large-icon">
              {modal === 'booking' ? (
                <CalendarDays />
              ) : modal === 'new-lead' || modal === 'invite' ? (
                <Users />
              ) : modal === 'plan' ? (
                <CreditCard />
              ) : (
                <Sparkles />
              )}
            </span>
            <h2 id="modal-title">
              {modal === 'new-lead'
                ? 'Every opportunity starts somewhere.'
                : modal === 'booking'
                  ? 'Make room for the next step.'
                  : modal === 'callback'
                    ? 'A human touch goes a long way.'
                    : modal === 'invite'
                      ? 'A little more teamwork.'
                      : modal === 'plan'
                        ? 'Your next chapter, covered.'
                        : 'A little help is always here.'}
            </h2>
            <p>
              {modal === 'new-lead'
                ? 'Add an enquiry to your demo workspace.'
                : modal === 'booking'
                  ? `Save an inspection request for ${active?.name || 'your customer'}. Requests are not confirmed appointments.`
                  : modal === 'callback'
                    ? `Save a callback task for ${active?.name || 'this customer'}.`
                    : modal === 'invite'
                      ? 'Invite someone to your workspace with the right level of access.'
                      : modal === 'plan'
                        ? `LeadRescue · ${planPrice}/month · ${paidPlan.paidSmsLimit} SMS segments and ${paidPlan.paidAiLimit} AI replies. No automatic overages.`
                        : 'LeadRescue keeps eligible missed-call conversations moving. You’re always in control.'}
            </p>
            {['new-lead', 'booking', 'invite', 'callback'].includes(modal) && (
              <form onSubmit={submitModal}>
                {modal === 'new-lead' ? (
                  <>
                    <label>
                      Customer name
                      <input name="name" required maxLength={80} placeholder="Alex Johnson" />
                    </label>
                    <label>
                      Phone number
                      <input
                        name="phone"
                        type="tel"
                        required
                        maxLength={25}
                        placeholder="(214) 555-0100"
                      />
                    </label>
                    <label>
                      Service
                      <select name="service">
                        {[
                          'Roof leak',
                          'Roof inspection',
                          'Roof replacement',
                          'Storm damage',
                          'Gutter repair',
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        City
                        <input name="city" placeholder="Dallas, TX" maxLength={80} />
                      </label>
                      <label>
                        ZIP code
                        <input name="zip" pattern="[0-9]{5}" maxLength={5} placeholder="75201" />
                      </label>
                    </div>
                    <label>
                      Notes
                      <textarea
                        name="notes"
                        rows={2}
                        maxLength={1000}
                        placeholder="What should your team know?"
                      />
                    </label>
                    <div className="notice">
                      <Info size={16} />
                      <span>Creating an enquiry does not grant SMS consent.</span>
                    </div>
                  </>
                ) : modal === 'booking' ? (
                  <>
                    <label>
                      Customer
                      <select value={active?.id} onChange={(e) => setSelected(e.target.value)}>
                        {leads.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          name="date"
                          required
                          defaultValue={demo ? '2026-11-02' : undefined}
                        />
                      </label>
                      <label>
                        Time
                        <input type="time" name="time" required defaultValue="09:00" />
                      </label>
                    </div>
                    <p className="microcopy">
                      {settings.timezone} · Request only until provider confirmation.
                    </p>
                    <div className="notice">
                      <Info size={15} />
                      <span>
                        {demo
                          ? 'This saves a demo request. No real calendar event is created.'
                          : 'You’ll receive a private link to share with the customer for their explicit confirmation.'}
                      </span>
                    </div>
                  </>
                ) : modal === 'callback' ? (
                  <label>
                    Callback note
                    <textarea
                      name="note"
                      required
                      rows={3}
                      maxLength={1000}
                      placeholder="What should the team know before calling?"
                      defaultValue={active?.notes || ''}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      Work email
                      <input
                        name="email"
                        type="email"
                        required
                        maxLength={254}
                        placeholder="teammate@yourcompany.com"
                      />
                    </label>
                    <label>
                      Role
                      <select name="role">
                        <option value="staff">Staff · handle leads and conversations</option>
                        <option value="viewer">Viewer · read-only access</option>
                      </select>
                    </label>
                  </>
                )}
                <button className="button primary full" disabled={busy}>
                  {busy ? <Loader2 size={17} className="spin" /> : <ArrowRight size={17} />}{' '}
                  {modal === 'new-lead'
                    ? 'Add demo enquiry'
                    : modal === 'booking'
                      ? 'Save inspection request'
                      : modal === 'callback'
                        ? 'Save callback request'
                        : demo
                          ? 'Preview invitation'
                          : 'Send invitation'}
                </button>
              </form>
            )}
            {modal === 'plan' &&
              (demo ? (
                <>
                  <div className="notice">
                    <Info size={18} />
                    <span>
                      You’re in the demo. Checkout is disabled and no card will be charged. Create
                      an account to start setup.
                    </span>
                  </div>
                  <Link href="/signup" className="button primary full">
                    Create your account <ArrowRight size={16} />
                  </Link>
                  <button className="text-link centered" onClick={() => setModal(null)}>
                    Keep exploring the demo
                  </button>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate('billing-checkout', { acceptRecurringTerms: true });
                  }}
                >
                  <p className="microcopy">
                    First charge:{' '}
                    {live?.business?.trial_ends_at
                      ? new Date(String(live.business.trial_ends_at)).toLocaleDateString()
                      : 'after activation and trial expiry'}
                    . Review exact amounts and dates in hosted checkout.
                  </p>
                  <label className="checkbox-label">
                    <input type="checkbox" required />
                    <span>
                      I accept {planPrice}/month recurring billing after my trial, included usage,
                      automation pausing at caps, and cancellation through Billing.{' '}
                      <Link href="/terms">Review terms</Link>.
                    </span>
                  </label>
                  <button className="button primary full" disabled={busy}>
                    Continue to secure checkout <ArrowRight size={16} />
                  </button>
                </form>
              ))}
            {modal === 'help' && (
              <>
                <div className="help-steps">
                  <div>
                    <span>1</span>
                    <p>
                      <strong>Start in your inbox.</strong> See what each customer needs.
                    </p>
                  </div>
                  <div>
                    <span>2</span>
                    <p>
                      <strong>Make it personal.</strong> Take over any conversation to reply.
                    </p>
                  </div>
                  <div>
                    <span>3</span>
                    <p>
                      <strong>Keep it moving.</strong> Request an inspection or mark a job won.
                    </p>
                  </div>
                </div>
                {demo && (
                  <div className="notice">
                    <Info size={17} />
                    <span>
                      All contacts, conversations, and metrics in this workspace are synthetic. Your
                      changes stay in your browser.
                    </span>
                  </div>
                )}
                <Link href={demo ? '/signup' : `${base}/settings`} className="button primary full">
                  {demo ? 'Make it yours' : 'Review business settings'} <ArrowRight size={16} />
                </Link>
                {demo && (
                  <button
                    className="text-link centered"
                    onClick={() => {
                      localStorage.removeItem('leadrescue-demo-v1');
                      setLeads(structuredClone(demoLeads));
                      setSettings(defaultSettings);
                      setBookings([]);
                      setSelected('demo-jessica');
                      setModal(null);
                      setToast('Demo reset. A fresh start.');
                    }}
                  >
                    Reset demo workspace
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
