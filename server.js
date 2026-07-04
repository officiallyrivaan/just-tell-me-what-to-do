require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const requests = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = requests.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) {
    requests.set(ip, { count: 1, start: now });
    return next();
  }
  if (entry.count >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
  }
  entry.count++;
  requests.set(ip, entry);
  next();
}

app.post('/api/decide', rateLimit, async (req, res) => {
  const { time, mood, dump, limits } = req.body;

  if (!time || !mood || !dump) {
    return res.status(400).json({ error: 'Missing required fields: time, mood, dump' });
  }

  if (dump.length > 2000) {
    return res.status(400).json({ error: 'Brain dump is too long. Keep it under 2000 characters.' });
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY || GROQ_KEY === 'your_groq_api_key_here') {
    return res.status(500).json({ error: 'API key not configured. Add GROQ_API_KEY to your .env file.' });
  }

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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 512
      })
    });

    if (!groqRes.ok) {
      const errData = await groqRes.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Groq API error: ${groqRes.status}`);
    }

    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!parsed.action || !parsed.why || !parsed.duration) {
      throw new Error('Unexpected response shape from AI.');
    }

    res.json(parsed);
  } catch (e) {
    console.error('[/api/decide error]', e.message);
    res.status(500).json({ error: e.message || 'Something went wrong. Try again.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅  Server running at http://localhost:${PORT}`);
});
