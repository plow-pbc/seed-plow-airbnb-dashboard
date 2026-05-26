import type { GuestyHome } from '../types';
import { GuestyTimeline } from '../components/GuestyTimeline';

// Thin wrapper so every dashboard view has a uniform entry in views/. The
// actual timeline lives in components/GuestyTimeline.tsx.
export function GuestyReservationsView({ homes }: { homes: GuestyHome[] }) {
  return <GuestyTimeline homes={homes} />;
}
