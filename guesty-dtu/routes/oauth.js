const express = require('express');
const { issueToken } = require('../auth');

const router = express.Router();

function getCredentials() {
  return {
    clientId: process.env.DTU_CLIENT_ID || 'dtu-test-id',
    clientSecret: process.env.DTU_CLIENT_SECRET || 'dtu-test-secret',
  };
}

router.post('/', (req, res) => {
  const { grant_type, client_id, client_secret, scope } = req.body || {};
  const { clientId, clientSecret } = getCredentials();

  if (
    grant_type !== 'client_credentials' ||
    client_id !== clientId ||
    client_secret !== clientSecret
  ) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Client authentication failed',
    });
  }

  const token = issueToken();
  return res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: 86400,
    scope: scope || 'open-api',
  });
});

module.exports = router;
