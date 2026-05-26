const express = require('express');

const { requireBearer } = require('./auth');
const oauthRouter = require('./routes/oauth');
const listingsRouter = require('./routes/listings');
const reservationsRouter = require('./routes/reservations');
const calendarRouter = require('./routes/calendar');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use('/oauth2/token', oauthRouter);
  app.use('/v1/listings', requireBearer, listingsRouter);
  app.use('/v1/reservations', requireBearer, reservationsRouter);
  app.use(
    '/v1/availability-pricing/api/calendar/listings/minified',
    requireBearer,
    calendarRouter,
  );

  app.use((req, res) => {
    res.status(404).json({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${req.method} ${req.originalUrl} not implemented by guesty-dtu`,
    });
  });

  return app;
}

module.exports = createApp;
