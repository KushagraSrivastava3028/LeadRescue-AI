import { InspectionConfirmation } from '@/components/inspection-confirmation';
export const metadata = {
  title: 'Confirm your appointment request',
  robots: { index: false, follow: false },
};
export default function ConfirmInspectionPage() {
  return <InspectionConfirmation />;
}
