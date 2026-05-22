import type { HostexHome } from '../types';
import { HostexTimeline } from '../components/HostexTimeline';

// The Hostex availability view: one reservation timeline per home. A thin
// wrapper so every dashboard view has a uniform entry in views/.

export function ReservationsView({ homes }: { homes: HostexHome[] }) {
  return <HostexTimeline homes={homes} />;
}
