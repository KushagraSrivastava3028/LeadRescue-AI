import { Marketing } from '@/components/marketing';
import { planSettings } from '@/lib/server/providers/plan';
export const metadata = { title: 'Simple pricing' };
export default function PricingPage() {
  return <Marketing pricingOnly plan={planSettings()} />;
}
