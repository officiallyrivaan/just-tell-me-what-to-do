require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;

function makeRateLimiter(limit, windowMs) {
  const store = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const entry = store.get(ip) || { count: 0, start: now };
    if (now - entry.start > windowMs) {
      store.set(ip, { count: 1, start: now });
      return next();
    }
    if (entry.count >= limit) {
      return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
    }
    entry.count++;
    store.set(ip, entry);
    next();
  };
}

// /api/decide is the expensive, user-facing call — keep its original budget.
const rateLimit = makeRateLimiter(RATE_LIMIT, RATE_WINDOW);
// /api/recommend-mode is a small, cheap pre-check that can fire once per submit
// alongside /api/decide — give it its own, more generous budget so it doesn't
// eat into the main rate limit.
const recommendRateLimit = makeRateLimiter(20, RATE_WINDOW);

// AI modes — each is a persona + a slightly different job to do with the same
// brain dump. All of them still return { action, why, duration } so the
// front end doesn't need mode-specific parsing.
const MODES = {
  decide: {
    persona: `You are a brutally honest, caring best friend.`,
    job: `Give them ONE specific action based strictly on what they wrote above.`,
    rules: `- If their dump is vague or short, match that energy — give a simple action that fits their mood and time. Do not invent specifics.
- If they mention something specific, address that specific thing directly.
- If they're bored with nothing much on their mind, suggest something fun or stimulating that matches their available time. Do not reach for things they never mentioned.
- Mood guide: tired = effortless task; overwhelmed = one thing that unblocks everything; scattered = one grounding action; hyped = the hardest thing on their list; bored = something engaging right now.
- Talk like a friend texting them. Warm, direct, no fluff.`,
    schema: `{
  "action": "One concrete thing to do right now, based only on what they wrote. 1-2 sentences.",
  "why": "2-3 sentences referencing only what they actually said. No invented context.",
  "duration": "realistic time estimate like 'about 10 minutes' or 'under 5 minutes'"
}`
  },
  vent: {
    persona: `You are a warm, patient listener — think a therapist's calm bedside manner, not a life coach.`,
    job: `First quietly acknowledge what they're carrying, then give them ONE small, gentle action — something that helps them feel a little lighter, not a productivity task.`,
    rules: `- Do not tell them to "just do" their to-do list. This is not about output.
- Validate the feeling in your own words before anything else — no invented backstory, only what they wrote.
- The action should be soothing or grounding (breathing, writing a line down, stepping outside, texting someone, resting) sized to their time and mood.
- Never diagnose or use clinical labels. Never suggest this replaces real support — if what they wrote sounds heavy, gently note that talking to someone they trust could help, in the "why".
- Talk like someone who is genuinely listening. Soft, unhurried, no fluff.`,
    schema: `{
  "action": "One small, gentle thing to do right now that helps them feel a bit lighter. 1-2 sentences.",
  "why": "2-3 sentences of warm, validating reflection based only on what they wrote.",
  "duration": "realistic time estimate like 'about 10 minutes' or 'under 5 minutes'"
}`
  },
  roast: {
    persona: `You are a savage, funny best friend who calls people out with love — think tough-love roast, not cruelty.`,
    job: `Read their excuses in the brain dump and roast the excuse, then give them ONE blunt, no-nonsense action to actually do.`,
    rules: `- Be funny and sharp, not mean-spirited or degrading. Roast the procrastination, not the person's worth.
- Only reference things explicitly mentioned. Never invent flaws or bring up anything they didn't write.
- Still respect their stated time and mood — "roast" mode means blunt delivery, not ignoring their limits.
- The action must still be genuinely useful and doable, just delivered with zero coddling.`,
    schema: `{
  "action": "One blunt, no-excuses thing to do right now. 1-2 sentences.",
  "why": "2-3 sentences of witty, tough-love callout based only on what they wrote. Funny, not cruel.",
  "duration": "realistic time estimate like 'about 10 minutes' or 'under 5 minutes'"
}`
  },
  hype: {
    persona: `You are a high-energy hype-man / coach hyping someone up before they lock in.`,
    job: `Pump them up about ONE specific action pulled from what they wrote, framed as the thing that gets the momentum going.`,
    rules: `- Match their time and mood — hype does not mean ignoring that they're tired; it means finding the win-sized action for right now and making it sound exciting.
- Only reference things explicitly mentioned in their dump.
- Use energy, short punchy sentences, exclamation where it fits — but don't be cringe or over the top with fake enthusiasm about nothing.`,
    schema: `{
  "action": "One specific, energizing thing to do right now. 1-2 sentences, hype tone.",
  "why": "2-3 sentences of motivating context based only on what they wrote.",
  "duration": "realistic time estimate like 'about 10 minutes' or 'under 5 minutes'"
}`
  },
  reflect: {
    persona: `You are a calm, thoughtful coach who helps people think clearly instead of just reacting.`,
    job: `Point out the one thing in their brain dump that actually matters most right now, then give ONE grounded next action that follows from that clarity.`,
    rules: `- Only reference things explicitly mentioned in their dump.
- The "why" should help them see their own situation more clearly — connect the dots between what they wrote, not add new ones.
- Keep the tone calm and steady, like someone thinking alongside them, not directing them.
- Size the action to their time and mood.`,
    schema: `{
  "action": "One grounded next step that follows from the clearest priority in their dump. 1-2 sentences.",
  "why": "2-3 sentences helping them see their own situation more clearly, based only on what they wrote.",
  "duration": "realistic time estimate like 'about 10 minutes' or 'under 5 minutes'"
}`
  },
  plan: {
    persona: `You are a pragmatic project manager who turns mental chaos into one clear next step.`,
    job: `Treat their brain dump like an unsorted task list. Identify the single highest-leverage next step and hand it back as one concrete action.`,
    rules: `- Only reference tasks/items explicitly mentioned in their dump. Never invent tasks.
- Pick the one item that unblocks the most other things, or is most urgent given their time and mood — not necessarily the biggest one.
- Be structured and clear, like a good PM giving a status update, not a hype speech and not therapy.
- Size the action to their stated time.`,
    schema: `{
  "action": "One concrete, highest-leverage next step pulled from their dump. 1-2 sentences.",
  "why": "2-3 sentences explaining why this is the right next step given everything else they listed.",
  "duration": "realistic time estimate like 'about 10 minutes' or 'under 5 minutes'"
}`
  }
};

app.post('/api/decide', rateLimit, async (req, res) => {
  const { time, mood, dump, limits, mode } = req.body;

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

  const m = MODES[mode] || MODES.decide;

  const prompt = `${m.persona} Read ONLY what the person has written below and respond to exactly that — nothing else, nothing assumed, nothing invented.

Here's what they told you:
- Time available: ${time}
- How they're feeling: ${mood}
- What's on their mind: ${dump}
- Constraints: ${limits || 'none'}

${m.job}

Rules:
- ONLY reference things explicitly mentioned in their brain dump. Never bring up topics, subjects, people, or decisions they did not write about.
${m.rules}
- The why must only reference what they actually wrote. Never pad with assumptions or invented context.

Reply ONLY with raw JSON (no markdown, no backticks, no explanation outside the JSON):
${m.schema}`;

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

// Reads the brain dump against the mode the person currently has selected and
// says whether a different mode would clearly suit it better. Deliberately
// conservative: if the current mode is a reasonable fit, or the call fails for
// any reason, it recommends nothing rather than interrupt the person's flow —
// a bad/uncertain suggestion is worse than no suggestion.
//
// llama-3.1-8b-instant is small and fast, which is great for latency here, but
// a soft "be conservative" instruction alone isn't enough to keep a small model
// from over-triggering — it tends to want to always produce *some* verdict. Two
// things pin it down instead of just asking nicely:
//   1. Few-shot examples covering BOTH outcomes (good fit -> null, bad fit ->
//      a mode), so it has a concrete bar to match rather than an abstract one.
//   2. A separate "fits_current_mode" boolean the model must set, which the
//      server then uses as a hard gate — "recommended" is only ever honored
//      when the model also explicitly said the current mode does NOT fit.
//      That's a deterministic safety net independent of whether the model
//      stays internally consistent on any single call.
const FEW_SHOT_EXAMPLES = `Examples of correct judgments:

1) current mode: roast me | dump: "everything just feels like too much right now, I don't even know what's wrong, I just feel kind of sad and stuck"
   -> {"fits_current_mode": false, "recommended": "vent", "reason": "this reads as genuinely heavy, not a stalling excuse to call out."}

2) current mode: vent | dump: "need to email the landlord, finish the report, call the bank, and grab groceries before 6"
   -> {"fits_current_mode": false, "recommended": "plan", "reason": "this is a stacked task list, not something to sit with."}

3) current mode: decide | dump: "kind of bored, nothing urgent, just want something to do for the next 30 min"
   -> {"fits_current_mode": true, "recommended": null, "reason": ""}

4) current mode: roast me | dump: "I've been avoiding calling the dentist for three weeks for no real reason"
   -> {"fits_current_mode": true, "recommended": null, "reason": ""}

5) current mode: hype me up | dump: "big presentation tomorrow, feeling nervous, need to start prepping tonight"
   -> {"fits_current_mode": true, "recommended": null, "reason": ""}`;

const MIN_DUMP_LENGTH_FOR_RECOMMENDATION = 20;

app.post('/api/recommend-mode', recommendRateLimit, async (req, res) => {
  const { time, mood, dump, limits, currentMode } = req.body;

  if (!dump || typeof dump !== 'string' || dump.trim().length < MIN_DUMP_LENGTH_FOR_RECOMMENDATION) {
    // Too short to judge reliably — guessing here does more harm than good.
    return res.json({ recommended: null, reason: '' });
  }
  if (dump.length > 2000) {
    return res.status(400).json({ error: 'Brain dump is too long. Keep it under 2000 characters.' });
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY || GROQ_KEY === 'your_groq_api_key_here') {
    // Fail open — no key configured shouldn't block the main "just tell me" flow.
    return res.json({ recommended: null, reason: '' });
  }

  const current = MODES[currentMode] ? currentMode : 'decide';
  const modeList = Object.entries(MODES)
    .map(([id, m]) => `- ${id}: ${m.persona} ${m.job}`)
    .join('\n');

  const prompt = `A person picked the "${current}" mode on a decision-fatigue app, then wrote the brain dump below. Judge ONLY whether "${current}" is a reasonable fit for what they wrote — not whether some other mode might theoretically also work.

Modes available:
${modeList}

${FEW_SHOT_EXAMPLES}

Now judge this one:
current mode: ${current}
- Time available: ${time || 'not specified'}
- How they're feeling: ${mood || 'not specified'}
- Brain dump: ${dump}
- Constraints: ${limits || 'none'}

Default assumption: the mode they picked is fine. Only set "fits_current_mode" to false if the mismatch is as obvious as examples 1 and 2 above — genuinely heavy content in a joke/tough-love mode, or a plain task list in an emotional-processing mode, or the reverse. Vague, short, or ambiguous dumps are NOT grounds to say it doesn't fit — default to true whenever you're unsure.

Reply ONLY with raw JSON (no markdown, no backticks, no explanation outside the JSON), matching the example format exactly:
{
  "fits_current_mode": true or false,
  "recommended": "mode id that fits clearly better, or null if fits_current_mode is true",
  "reason": "one short, casual sentence (under 18 words) — empty string if fits_current_mode is true"
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
        temperature: 0,
        max_tokens: 200
      })
    });

    if (!groqRes.ok) {
      // Fail open — a classifier hiccup shouldn't block the person from getting their answer.
      return res.json({ recommended: null, reason: '' });
    }

    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Hard gate: the model must have explicitly said the current mode does NOT
    // fit. If it left that unset, said true, or was inconsistent (fits=false
    // but no valid mode), we still fall back to "no recommendation" — the
    // recommendation is only ever honored when both signals agree.
    const isValidSuggestion =
      parsed.fits_current_mode === false &&
      parsed.recommended &&
      typeof parsed.recommended === 'string' &&
      MODES[parsed.recommended] &&
      parsed.recommended !== current;

    res.json({
      recommended: isValidSuggestion ? parsed.recommended : null,
      reason: isValidSuggestion ? String(parsed.reason || '').slice(0, 200) : ''
    });
  } catch (e) {
    console.error('[/api/recommend-mode error]', e.message);
    res.json({ recommended: null, reason: '' }); // fail open
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅  Server running at http://localhost:${PORT}`);
});
