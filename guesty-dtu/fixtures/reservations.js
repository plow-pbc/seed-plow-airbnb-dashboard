const listings = require('./listings');

const PLATFORMS = ['airbnb2', 'vrbo', 'bookingCom', 'manual'];

function offsetDate(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(d) {
  return d.toISOString();
}

// [listingIdx, platformIdx, status, checkInOffsetDays, nights]
const SPECS = [
  [0, 0, 'confirmed', -5, 3],
  [0, 1, 'confirmed', 2, 4],
  [0, 3, 'reserved', 14, 2],
  [1, 0, 'confirmed', -10, 7],
  [1, 2, 'confirmed', -1, 5],
  [1, 0, 'reserved', 20, 3],
  [2, 1, 'confirmed', 0, 4],
  [2, 0, 'confirmed', 10, 3],
  [2, 3, 'confirmed', -20, 2],
  [2, 2, 'reserved', 25, 5],
];

const reservations = SPECS.map((spec, i) => {
  const [listingIdx, platformIdx, status, offset, nights] = spec;
  const checkIn = offsetDate(offset);
  const checkOut = offsetDate(offset + nights);
  const idSuffix = (0x680000000000n + BigInt(i + 1)).toString(16).padStart(24, '0');
  return {
    _id: idSuffix,
    listingId: listings[listingIdx]._id,
    guest: { fullName: `Guest ${String.fromCharCode(65 + i)}` },
    integration: { platform: PLATFORMS[platformIdx] },
    checkIn: fmtDateTime(checkIn),
    checkOut: fmtDateTime(checkOut),
    checkInDateLocalized: fmtDate(checkIn),
    checkOutDateLocalized: fmtDate(checkOut),
    nightsCount: nights,
    status,
  };
});

module.exports = reservations;
