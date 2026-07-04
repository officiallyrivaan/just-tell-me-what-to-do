module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { time, mood, dump, limits } = req.body;
  if (!time || !mood || !dump) return res.status(400).json({ error: 'Missing required fields: time, mood, dump' });
  if (dump.length > 2000) return res.status(400).json({ error: 'Brain dump too long.' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'API key not configured.' });

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
- If they're bored with nothing much on their mind, suggest something fun or stimulating that matches their available time.
- Mood guide: tired = effortless task; overwhelmed = one thing that unblocks everything; scattered = one grounding action; hyped = the hardest thing on their list; bored = something engaging right now.
- Talk like a friend texting them. Warm, direct, no fluff.
- The why must only reference what they actually wrote.

Reply ONLY with raw JSON (no markdown, no backticks):
{
  "action": "One concrete thing to do right now. 1-2 sentences.",
  "why": "2-3 sentences referencing only what they actually said.",
  "duration": "realistic time estimate like 'about 10 minutes'"
}`;

  try {
    const fetch = require('node-fetch');
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 512 })
    });
    if (!groqRes.ok) { const d = await groqRes.json().catch(() => ({})); throw new Error(d.error?.message || `Groq error ${groqRes.status}`); }
    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!parsed.action || !parsed.why || !parsed.duration) throw new Error('Bad AI response.');
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
};
