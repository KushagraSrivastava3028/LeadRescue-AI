import Link from 'next/link';
import { Phone, Sparkles } from 'lucide-react';
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand ${compact ? 'compact' : ''}`} href="/" aria-label="LeadRescue home">
      <span className="brand-symbol">
        <Phone size={29} strokeWidth={3} fill="currentColor" />
        <Sparkles className="brand-spark" size={19} strokeWidth={2.5} />
      </span>
      <span>
        LeadRescue<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
