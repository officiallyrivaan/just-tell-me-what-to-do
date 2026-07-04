const { ObjectId } = require('mongodb');
const connectDB = require('../_db');
const verifyToken = require('../_auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try {
    const user_data = verifyToken(req);
    const db = await connectDB();
    const user = await db.collection('users').findOne({ _id: new ObjectId(user_data.id) }, { projection: { password: 0 } });
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(user);
  } catch (e) {
    res.status(401).json({ error: e.message || 'unauthorised' });
  }
};
