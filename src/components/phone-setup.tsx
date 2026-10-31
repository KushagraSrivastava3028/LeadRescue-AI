'use client';
import { useEffect, useState } from 'react';
import { Check, Loader2, Phone, ShieldCheck } from 'lucide-react';
type PhoneData = {
  phone: string;
  forward_to: string | null;
  destination_verified_at: string | null;
  registration_status: string;
  routing_enabled: boolean;
};
export function PhoneSetup({
  businessId,
  onChanged,
}: {
  businessId: string;
  onChanged: () => void;
}) {
  const [phone, setPhone] = useState<PhoneData | null>(null);
  const [areaCode, setAreaCode] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [validationCode, setValidationCode] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/phone?businessId=${encodeURIComponent(businessId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (r.ok) setPhone(data.phone);
        else setNotice(data.error || 'Phone setup is unavailable.');
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotice('Phone setup is unavailable.');
      });
    return () => controller.abort();
  }, [businessId]);
  async function request(action: 'provision' | 'verify-destination', event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    setValidationCode('');
    try {
      const r = await fetch('/api/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          action,
          ...(action === 'provision' ? { areaCode } : { phone: destination }),
        }),
      });
      const data = await r.json();
      setNotice(data.message || data.error || 'Request could not be completed.');
      if (r.ok) {
        if (data.validationCode) setValidationCode(String(data.validationCode));
        if (data.phone)
          setPhone({
            phone: data.phone,
            forward_to: null,
            destination_verified_at: null,
            registration_status: 'pending',
            routing_enabled: false,
          });
        onChanged();
      }
    } catch {
      setNotice('Phone setup is unavailable. Please check the request status before retrying.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel integration-card phone-setup">
      <div className="panel-heading">
        <span className="metric-icon green">
          <Phone size={22} />
        </span>
        <div>
          <h2>Your business phone</h2>
          <p>Verified routing. A clearer path to your next customer.</p>
        </div>
        <span className={`badge ${phone?.routing_enabled ? 'green' : 'gray'}`}>
          {phone?.routing_enabled ? 'Routing enabled' : 'Setup required'}
        </span>
      </div>
      <div className="integration-detail">
        <span>LeadRescue number</span>
        <strong>{phone?.phone || 'Not assigned'}</strong>
      </div>
      <div className="integration-detail">
        <span>Forwarding destination</span>
        <strong>{phone?.forward_to || 'Not verified'}</strong>
      </div>
      <div className="integration-detail">
        <span>Messaging registration</span>
        <strong>{phone?.registration_status || 'Approval required'}</strong>
      </div>
      <div className="phone-setup-forms">
        {!phone && (
          <form onSubmit={(e) => request('provision', e)}>
            <label>
              Preferred U.S. area code
              <input
                required
                pattern="[2-9][0-9]{2}"
                inputMode="numeric"
                maxLength={3}
                placeholder="214"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" required />
              <span>
                I authorize number provisioning through the approved business account. Provider
                charges may apply.
              </span>
            </label>
            <button className="button secondary small" disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <Phone size={15} />}Request a number
            </button>
          </form>
        )}
        <form onSubmit={(e) => request('verify-destination', e)}>
          <label>
            Authorized forwarding destination
            <input
              type="tel"
              required
              pattern="\+1[2-9][0-9]{9}"
              maxLength={12}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="+12145550199"
            />
          </label>
          <p>
            The operator must approve this U.S. number first. Verification places a provider call to
            this destination.
          </p>
          <button className="button secondary small" disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}Verify
            destination
          </button>
        </form>
      </div>
      {validationCode && (
        <div className="notice">
          <Check size={17} />
          <span>
            Enter this code on the verification call: <strong>{validationCode}</strong>. The
            operator still verifies the provider result before enabling routing.
          </span>
        </div>
      )}
      {notice && (
        <p className="form-message" role="status">
          {notice}
        </p>
      )}
      <div className="notice">
        <ShieldCheck size={17} />
        <span>
          Approved messaging registration, documented consent, business verification, and a
          successful live test are required before trial activation.
        </span>
      </div>
    </section>
  );
}
