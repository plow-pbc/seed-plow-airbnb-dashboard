export type Event = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  location: string | null;
};

// Hostex reservation-timeline source.
export type Reservation = {
  guest: string;
  channel: string; // 'airbnb' | 'vrbo' | 'booking_site' | ...
  check_in: string; // YYYY-MM-DD
  check_out: string; // YYYY-MM-DD
  nights: number;
};

export type HostexHome = {
  id: number;
  name: string;
  cover: string | null; // thumbnail URL, or null
  reservations: Reservation[];
  blocked: string[]; // YYYY-MM-DD dates the home is unavailable but unreserved
};

// Guesty reservation-timeline source. Shape mirrors Hostex's; the extra
// `status` field lets the client paint channel-pending holds ('reserved')
// distinctly from accepted bookings ('confirmed').
export interface GuestyReservation extends Reservation {
  status: 'confirmed' | 'reserved';
}

export interface GuestyHome {
  id: string; // Guesty Mongo-style _id
  name: string;
  cover: string | null;
  reservations: GuestyReservation[];
  blocked: string[];
}
