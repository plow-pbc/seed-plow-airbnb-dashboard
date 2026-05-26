const crypto = require('node:crypto');

const validTokens = new Set();

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.add(token);
  return token;
}

function isValidToken(token) {
  return validTokens.has(token);
}

function resetTokens() {
  validTokens.clear();
}

function requireBearer(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header',
    });
  }
  if (!isValidToken(match[1])) {
    return res.status(403).json({
      message: "You don't have permission to access, please contact Guesty support.",
    });
  }
  return next();
}

module.exports = { issueToken, isValidToken, resetTokens, requireBearer };
