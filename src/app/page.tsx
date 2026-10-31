import { Marketing } from '@/components/marketing';
import { planSettings } from '@/lib/server/providers/plan';
export default function Home() {
  return <Marketing plan={planSettings()} />;
}
