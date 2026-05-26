const express = require('express');
const listings = require('../fixtures/listings');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
  const results = listings.slice(skip, skip + limit);
  res.json({
    results,
    count: listings.length,
    limit,
    skip,
  });
});

module.exports = router;
