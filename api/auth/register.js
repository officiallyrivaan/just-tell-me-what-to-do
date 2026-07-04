const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const connectDB = require('../_db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  try {
    const db = await connectDB();
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    const hash = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({
      username: username.toLowerCase().trim(),
      password: hash,
      createdAt: new Date(),
      streak: 0,
      lastDay: ''
    });
    const token = jwt.sign({ id: result.insertedId.toString(), username }, process.env.JWT_SECRET || 'jtmwtd_secret', { expiresIn: '30d' });
    res.json({ token, username });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'username already taken' });
    res.status(500).json({ error: 'something went wrong' });
  }
};
