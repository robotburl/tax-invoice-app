const GoogleStrategy = require('passport-google-oauth20').Strategy;

module.exports = (passport, pool) => {
  if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const picture = profile.photos[0]?.value || '';

      // Check whitelist if set
      const whitelist = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
      if (whitelist.length > 0 && !whitelist.includes(email)) {
        return done(null, false, { message: 'Email not authorized' });
      }

      // Upsert user
      const result = await pool.query(`
        INSERT INTO users (google_id, email, name, picture)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (google_id) DO UPDATE
          SET name = EXCLUDED.name,
              picture = EXCLUDED.picture
        RETURNING *
      `, [profile.id, email, profile.displayName, picture]);

      return done(null, result.rows[0]);
    } catch (err) {
      return done(err);
    }
  }));
  }

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id, done) => {
    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      done(null, result.rows[0] || false);
    } catch (err) {
      done(err);
    }
  });
};
