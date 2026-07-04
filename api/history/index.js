const connectDB = require('../_db');
const verifyToken = require('../_auth');

module.exports = async (req, res) => {
  try {
    const user = verifyToken(req);
    const db = await connectDB();

    if (req.method === 'GET') {
      const history = await db.collection('history')
        .find({ userId: user.id })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      return res.json(history);
    }

    if (req.method === 'POST') {
      const { action, why, duration, mood, time } = req.body;
      if (!action) return res.status(400).json({ error: 'action required' });
      await db.collection('history').insertOne({
        userId: user.id, action, why, duration, mood, time,
        completed: false, createdAt: new Date()
      });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(401).json({ error: e.message || 'unauthorised' });
  }
};
