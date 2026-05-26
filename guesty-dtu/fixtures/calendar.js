const reservations = require('./reservations');

function* eachDate(startStr, endStr) {
  const cur = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endStr}T00:00:00.000Z`);
  while (cur <= end) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function emptyBlocks() {
  return { r: false, b: false, m: false, o: false, bd: false, ic: false };
}

function reservationDatesFor(listingId) {
  const set = new Set();
  for (const r of reservations) {
    if (r.listingId !== listingId) continue;
    if (r.status !== 'confirmed' && r.status !== 'reserved') continue;
    for (const date of eachDate(r.checkInDateLocalized, r.checkOutDateLocalized)) {
      // checkOut is exclusive — skip it
      if (date === r.checkOutDateLocalized) continue;
      set.add(date);
    }
  }
  return set;
}

function buildCalendar(listingId, startDate, endDate) {
  const reservedDates = reservationDatesFor(listingId);
  const days = [];
  for (const date of eachDate(startDate, endDate)) {
    const blocks = emptyBlocks();
    if (reservedDates.has(date)) {
      blocks.r = true;
    } else {
      const h = hash(`${listingId}|${date}`);
      // Sparse, deterministic non-reservation blocks
      if (h % 53 === 0) blocks.m = true;
      else if (h % 71 === 0) blocks.o = true;
      else if (h % 89 === 0) blocks.bd = true;
    }
    const anyBlocked = Object.values(blocks).some(Boolean);
    days.push({
      date,
      status: anyBlocked ? 'booked' : 'available',
      blocks,
    });
  }
  return days;
}

module.exports = { buildCalendar };
