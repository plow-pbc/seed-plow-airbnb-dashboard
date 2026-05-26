const express = require('express');
const reservations = require('../fixtures/reservations');

const router = express.Router();

class FilterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FilterError';
  }
}

function parseFilters(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FilterError('Invalid filters JSON');
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

function applyOperator(reservation, filter) {
  const { field, operator, value } = filter;
  const fieldValue = reservation[field];

  switch (operator) {
    case '$in':
      if (!Array.isArray(value)) throw new FilterError('$in requires an array value');
      return value.includes(fieldValue);
    case '$eq':
      return fieldValue === value;
    case '$ne':
    case '$not':
      // Docs describe $not as "field value not equal to query value" — identical wording to $ne.
      return fieldValue !== value;
    case '$gt':
      return fieldValue > value;
    case '$lt':
      return fieldValue < value;
    case '$contains':
      // Substring match on string fields (per operator name; docs definition is mis-pasted from $in).
      return fieldValue != null && String(fieldValue).includes(String(value));
    case '$notcontains':
      return fieldValue == null || !String(fieldValue).includes(String(value));
    case '$between': {
      const { from, to } = filter;
      if (from === undefined || to === undefined) {
        throw new FilterError('$between requires from and to');
      }
      return fieldValue >= from && fieldValue <= to;
    }
    default:
      throw new FilterError(`Unsupported filter operator: ${operator}`);
  }
}

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

  let filters;
  try {
    filters = parseFilters(req.query.filters);
  } catch (err) {
    if (err instanceof FilterError) {
      return res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message: err.message,
      });
    }
    throw err;
  }

  let filtered;
  try {
    filtered = reservations.filter((r) => filters.every((f) => applyOperator(r, f)));
  } catch (err) {
    if (err instanceof FilterError) {
      return res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message: err.message,
      });
    }
    throw err;
  }

  const results = filtered.slice(skip, skip + limit);
  return res.json({
    results,
    count: filtered.length,
    limit,
    skip,
  });
});

module.exports = router;
