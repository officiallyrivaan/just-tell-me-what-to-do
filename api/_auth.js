const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new Error('not logged in');
  return jwt.verify(token, process.env.JWT_SECRET || 'jtmwtd_secret');
}

module.exports = verifyToken;
