const { MongoClient } = require('mongodb');

let client;
let db;

async function connectDB() {
  if (db) return db;
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI not set');
  if (!client) {
    client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  }
  db = client.db('jtmwtd');
  return db;
}

module.exports = connectDB;
