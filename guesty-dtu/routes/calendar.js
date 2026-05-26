const express = require('express');
const { buildCalendar } = require('../fixtures/calendar');
const listings = require('../fixtures/listings');

const router = express.Router();

router.get('/:listingId', (req, res) => {
  const { listingId } = req.params;
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      statusCode: 400,
      error: 'Bad Request',
      message: 'startDate and endDate query parameters are required (YYYY-MM-DD)',
    });
  }

  if (!listings.find((l) => l._id === listingId)) {
    return res.status(404).json({
      statusCode: 404,
      error: 'Not Found',
      message: `Listing ${listingId} not found`,
    });
  }

  return res.json({ data: { days: buildCalendar(listingId, startDate, endDate) } });
});

module.exports = router;
