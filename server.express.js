require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jtmwtd_secret_change_this';
const MONGO_URI = process.env.MONGO_URI || '';

let db;

async function connectDB() {
  if (!MONGO_URI) { console.warn('⚠️  No MONGO_URI set — DB features disabled'); return; }
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('jtmwtd');
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    console.log('✅  MongoDB connected');
  } catch (e) {
    console.error('MongoDB connection failed:', e.message);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const requests = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = requests.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { requests.set(ip, { count: 1, start: now }); return next(); }
  if (entry.count >= RATE_LIMIT) return res.status(429).json({ error: 'Too many requests. Wait a moment.' });
  entry.count++;
  requests.set(ip, entry);
  next();
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'not logged in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'session expired, please log in again' });
  }
}

app.post('/api/auth/register', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'database not connected' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({
      username: username.toLowerCase().trim(),
      password: hash,
      createdAt: new Date(),
      streak: 0,
      lastDay: ''
    });
    const token = jwt.sign({ id: result.insertedId.toString(), username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'username already taken' });
    res.status(500).json({ error: 'something went wrong' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'database not connected' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const user = await db.collection('users').findOne({ username: username.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'wrong username or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'wrong username or password' });
    const token = jwt.sign({ id: user._id.toString(), username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username });
  } catch {
    res.status(500).json({ error: 'something went wrong' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'database not connected' });
  try {
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) }, { projection: { password: 0 } });
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(user);
  } catch {
    res.status(500).json({ error: 'something went wrong' });
  }
});

app.post('/api/history', authMiddleware, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'database not connected' });
  const { action, why, duration, mood, time } = req.body;
  if (!action) return res.status(400).json({ error: 'action required' });
  try {
    await db.collection('history').insertOne({
      userId: req.user.id,
      action, why, duration, mood, time,
      completed: false,
      createdAt: new Date()
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'could not save history' });
  }
});

app.get('/api/history', authMiddleware, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'database not connected' });
  try {
    const history = await db.collection('history')
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    res.json(history);
  } catch {
    res.status(500).json({ error: 'could not load history' });
  }
});

app.patch('/api/history/:id/done', authMiddleware, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'database not connected' });
  try {
    await db.collection('history').updateOne(
      { _id: new ObjectId(req.params.id), userId: req.user.id },
      { $set: { completed: true, completedAt: new Date() } }
    );

    const today = new Date().toDateString();
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    let streak = user.streak || 0;
    if (user.lastDay !== today) {
      streak = (user.lastDay === yesterday) ? streak + 1 : 1;
      await db.collection('users').updateOne(
        { _id: new ObjectId(req.user.id) },
        { $set: { streak, lastDay: today } }
      );
    }

    res.json({ ok: true, streak });
  } catch {
    res.status(500).json({ error: 'could not update' });
  }
});

app.post('/api/decide', rateLimit, async (req, res) => {
  const { time, mood, dump, limits } = req.body;
  if (!time || !mood || !dump) return res.status(400).json({ error: 'Missing required fields: time, mood, dump' });
  if (dump.length > 2000) return res.status(400).json({ error: 'Brain dump too long. Keep it under 2000 characters.' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY || GROQ_KEY === 'your_groq_api_key_here') return res.status(500).json({ error: 'API key not configured.' });

  const prompt = `You are a brutally honest, caring best friend. Read ONLY what the person has written below and respond to exactly that — nothing else, nothing assumed, nothing invented.

Here's what they told you:
- Time available: ${time}
- How they're feeling: ${mood}
- What's on their mind: ${dump}
- Constraints: ${limits || 'none'}

Give them ONE specific action based strictly on what they wrote above.

Rules:
- ONLY reference things explicitly mentioned in their brain dump. Never bring up topics, subjects, people, or decisions they did not write about.
- If their dump is vague or short, match that energy — give a simple action that fits their mood and time. Do not invent specifics.
- If they mention something specific, address that specific thing directly.
- If they're bored with nothing much on their mind, suggest something fun or stimulating that matches their available time. Do not reach for things they never mentioned.
- Mood guide: tired = effortless task; overwhelmed = one thing that unblocks everything; scattered = one grounding action; hyped = the hardest thing on their list; bored = something engaging right now.
- Talk like a friend texting them. Warm, direct, no fluff.
- The why must only reference what they actually wrote. Never pad with assumptions or invented context.

Reply ONLY with raw JSON (no markdown, no backticks, no explanation outside the JSON):
{
  "action": "One concrete thing to do right now, based only on what they wrote. 1-2 sentences.",
  "why": "2-3 sentences referencing only what they actually said. No invented context.",
  "duration": "realistic time estimate like 'about 10 minutes' or 'under 5 minutes'"
}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 512 })
    });
    if (!groqRes.ok) { const d = await groqRes.json().catch(() => ({})); throw new Error(d.error?.message || `Groq error ${groqRes.status}`); }
    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!parsed.action || !parsed.why || !parsed.duration) throw new Error('Bad AI response shape.');
    res.json(parsed);
  } catch (e) {
    console.error('[/api/decide]', e.message);
    res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

connectDB().then(() => {
  app.listen(PORT, () => console.log(`✅  Server running at http://localhost:${PORT}`));
});
