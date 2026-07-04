const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const connectDB = require('../_db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ username: username.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'wrong username or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'wrong username or password' });
    const token = jwt.sign({ id: user._id.toString(), username: user.username }, process.env.JWT_SECRET || 'jtmwtd_secret', { expiresIn: '30d' });
    res.json({ token, username: user.username });
  } catch {
    res.status(500).json({ error: 'something went wrong' });
  }
};
