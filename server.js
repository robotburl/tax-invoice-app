require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Pool } = require('pg');
const connectPgSimple = require('connect-pg-simple');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const PgSession = connectPgSimple(session);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'tax-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

app.use(passport.initialize());
app.use(passport.session());

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'owner',
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      tax_id TEXT NOT NULL,
      address TEXT NOT NULL,
      branch TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS staff_access (
      id SERIAL PRIMARY KEY,
      staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      UNIQUE(staff_user_id, company_id)
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      company_ids INTEGER[] NOT NULL DEFAULT '{}',
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      seller_name TEXT,
      seller_tax TEXT,
      buyer_name TEXT,
      buyer_tax TEXT,
      buyer_address TEXT,
      buyer_branch TEXT,
      items TEXT,
      price NUMERIC(15,2),
      vat NUMERIC(15,2),
      total NUMERIC(15,2),
      invoice_date TEXT,
      capture_date TIMESTAMPTZ DEFAULT NOW(),
      image_data TEXT,
      address_mismatch BOOLEAN DEFAULT FALSE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wht_records (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      payer_name TEXT,
      payer_tax TEXT,
      payee_name TEXT,
      payee_tax TEXT,
      wht_type TEXT,
      income_type TEXT,
      income_amount NUMERIC(15,2),
      wht_amount NUMERIC(15,2),
      wht_date TEXT,
      image_data TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_usage (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      month TEXT NOT NULL,
      input_tokens BIGINT DEFAULT 0,
      output_tokens BIGINT DEFAULT 0,
      cost_usd NUMERIC(10,6) DEFAULT 0,
      scan_count INTEGER DEFAULT 0,
      UNIQUE(owner_id, month)
    );
  `);

  // Migrate existing data: add missing columns if upgrading from old schema
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id);
    ALTER TABLE wht_records ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);
    ALTER TABLE wht_records ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id);
  `);

  // Backfill owner_id for existing rows (user_id → owner_id)
  await pool.query(`
    UPDATE invoices SET owner_id = user_id WHERE owner_id IS NULL AND user_id IS NOT NULL;
    UPDATE wht_records SET owner_id = user_id WHERE owner_id IS NULL AND user_id IS NOT NULL;
  `).catch(() => {});

  console.log('✅ Database tables ready');
}

require('./routes/auth')(passport, pool);
app.use('/auth', require('./routes/authRoutes')(passport));
app.use('/api', require('./routes/api')(pool));

// Invitation accept route
app.get('/invite/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const inv = await pool.query(
      `SELECT * FROM invitations WHERE token=$1 AND used=FALSE AND expires_at > NOW()`,
      [token]
    );
    if (!inv.rows.length) return res.send('<h2>ลิงก์เชิญหมดอายุหรือถูกใช้ไปแล้ว</h2>');
    req.session.pendingInviteToken = token;
    res.redirect('/auth/google');
  } catch (e) {
    res.status(500).send('Server error');
  }
});

app.get('/', (req, res) => {
  if (!req.isAuthenticated()) return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
