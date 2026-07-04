const { ObjectId } = require('mongodb');
const connectDB = require('../../_db');
const verifyToken = require('../../_auth');

module.exports = async (req, res) => {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method not allowed' });
  try {
    const user = verifyToken(req);
    const db = await connectDB();
    const { id } = req.query;

    await db.collection('history').updateOne(
      { _id: new ObjectId(id), userId: user.id },
      { $set: { completed: true, completedAt: new Date() } }
    );

    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const u = await db.collection('users').findOne({ _id: new ObjectId(user.id) });
    let streak = u.streak || 0;
    if (u.lastDay !== today) {
      streak = (u.lastDay === yesterday) ? streak + 1 : 1;
      await db.collection('users').updateOne(
        { _id: new ObjectId(user.id) },
        { $set: { streak, lastDay: today } }
      );
    }

    res.json({ ok: true, streak });
  } catch (e) {
    res.status(401).json({ error: e.message || 'unauthorised' });
  }
};
