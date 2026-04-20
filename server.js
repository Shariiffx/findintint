require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// FIX: Increase limits - base64 of 10MB file = ~13.5MB JSON, so 25mb is safe
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── CONFIG ───────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI ||
  'mongodb+srv://mdsharifmolla354_db_user:Sharifinreallife@findintint.4b8unxo.mongodb.net/?appName=findintint';
const DB_NAME = process.env.DB_NAME || 'findintint';
const PORT    = process.env.PORT    || 3000;

console.log('=== FindInTint Server Starting ===');
console.log('DB_NAME    :', DB_NAME);
console.log('PORT       :', PORT);
console.log('MONGO_URI  :', MONGO_URI ? 'SET ✅' : 'MISSING ❌');

// ─── MONGODB CLIENT ───────────────────────────────────────────────────────
const client = new MongoClient(MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  tls: true,
  connectTimeoutMS: 10000,
  socketTimeoutMS:  45000,
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: 10,
  retryWrites: true,
  retryReads:  true,
});

let db = null;

// ─── CONNECT ──────────────────────────────────────────────────────────────
async function connectDB() {
  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    db = client.db(DB_NAME);
    console.log('✅ Connected to MongoDB:', DB_NAME);
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

// ─── DB GUARD ─────────────────────────────────────────────────────────────
function requireDB(req, res, next) {
  if (!db) return res.status(503).json({ error: 'Database not connected yet. Please retry.' });
  next();
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ status: 'error', message: 'DB not connected' });
    await client.db('admin').command({ ping: 1 });
    res.json({ status: 'ok', db: DB_NAME, time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── FIND ─────────────────────────────────────────────────────────────────
app.post('/api/find', requireDB, async (req, res) => {
  try {
    const { collection, filter = {}, sort = {}, limit = 200 } = req.body;
    if (!collection) return res.status(400).json({ error: 'collection is required' });

    // FIX: sanitize sort - ensure values are numbers not strings
    const sanitizedSort = {};
    Object.keys(sort).forEach(k => { sanitizedSort[k] = Number(sort[k]) || -1; });

    const docs = await db.collection(collection)
      .find(filter)
      .sort(Object.keys(sanitizedSort).length ? sanitizedSort : { createdAt: -1 })
      .limit(Number(limit))
      .toArray();

    // FIX: convert ObjectId _id to string so frontend can use it
    const cleaned = docs.map(d => ({ ...d, _id: d._id ? d._id.toString() : undefined }));
    res.json({ documents: cleaned });
  } catch (err) {
    console.error('find error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── INSERT ONE ───────────────────────────────────────────────────────────
app.post('/api/insertOne', requireDB, async (req, res) => {
  try {
    const { collection, document } = req.body;
    if (!collection || !document) {
      return res.status(400).json({ error: 'collection and document are required' });
    }

    // Remove client _id, let MongoDB generate it
    const { _id, ...doc } = document;
    doc.createdAt = doc.createdAt || new Date().toISOString();

    // FIX: Check document size before inserting (MongoDB hard limit is 16MB)
    const docSize = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    if (docSize > 15 * 1024 * 1024) {
      return res.status(413).json({ error: 'Document too large. Max file size is ~10MB.' });
    }

    const result = await db.collection(collection).insertOne(doc);
    res.json({ insertedId: result.insertedId.toString() });
  } catch (err) {
    console.error('insertOne error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE ONE ───────────────────────────────────────────────────────────
app.post('/api/updateOne', requireDB, async (req, res) => {
  try {
    const { collection, filter, update, upsert = false } = req.body;
    if (!collection || !filter || !update) {
      return res.status(400).json({ error: 'collection, filter and update are required' });
    }

    const result = await db.collection(collection).updateOne(filter, update, { upsert });
    res.json({
      matchedCount:  result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedId:    result.upsertedId ? result.upsertedId.toString() : null,
    });
  } catch (err) {
    console.error('updateOne error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ONE ───────────────────────────────────────────────────────────
app.post('/api/deleteOne', requireDB, async (req, res) => {
  try {
    const { collection, filter } = req.body;
    if (!collection || !filter) {
      return res.status(400).json({ error: 'collection and filter are required' });
    }

    const result = await db.collection(collection).deleteOne(filter);
    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    console.error('deleteOne error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  });
});
