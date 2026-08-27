require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Pool } = require('pg');
const connectPgSimple = require('connect-pg-simple');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway proxy (required for secure cookies)
app.set('trust proxy', 1);

// PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway ต้องใช้ SSL แต่ Postgres ใน Docker network บน NAS ไม่ได้เปิด SSL
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Session store
const PgSession = connectPgSimple(session);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'tax-invoice-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days — stay logged in
    // 'lax' เพราะเว็บกับ API อยู่โดเมนเดียวกัน (Safari/iOS ทิ้งคุกกี้ SameSite=None)
    sameSite: 'lax',
  },
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Init DB tables
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      tax_id TEXT NOT NULL,
      address TEXT NOT NULL,
      branch TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      payer_name TEXT,
      payer_tax TEXT,
      payee_name TEXT,
      payee_tax TEXT,
      wht_type TEXT,
      income_type TEXT,
      income_amount NUMERIC(15,2),
      wht_rate NUMERIC(5,2),
      wht_amount NUMERIC(15,2),
      wht_date TEXT,
      capture_date TIMESTAMPTZ DEFAULT NOW(),
      image_data TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // ---- ระบบผู้ใช้หลายคน (อีเมล + รหัสผ่าน, บทบาท, บันทึกผู้สแกน) ----
  await pool.query(`
    ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id);
    ALTER TABLE wht_records ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id);
  `);

  // ผู้ใช้คนแรกคือผู้ดูแลระบบ และเอกสารเดิมทั้งหมดถือว่าผู้ดูแลเป็นคนสแกน
  await pool.query(`
    UPDATE users SET role = 'admin'
    WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
  `);
  await pool.query(`
    UPDATE invoices SET uploaded_by = user_id WHERE uploaded_by IS NULL AND user_id IS NOT NULL;
    UPDATE wht_records SET uploaded_by = user_id WHERE uploaded_by IS NULL AND user_id IS NOT NULL;
  `);

  console.log('✅ Database tables ready');
}

// Passport config
require('./routes/auth')(passport, pool);

// Routes
app.use('/auth', require('./routes/authRoutes')(passport, pool));
app.use('/api', require('./routes/users')(pool));
app.use('/api', require('./routes/api')(pool));

// Serve app (protected)
app.get('/', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}).catch(err => {
  console.error('DB init error:', err);
  process.exit(1);
});
