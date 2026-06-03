const GoogleStrategy = require('passport-google-oauth20').Strategy;

module.exports = function (passport, pool) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const googleId = profile.id;
      const name = profile.displayName;
      const picture = profile.photos[0]?.value || '';

      // Check if user exists
      let result = await pool.query('SELECT * FROM users WHERE google_id=$1', [googleId]);
      let user = result.rows[0];

      const inviteToken = req.session?.pendingInviteToken;

      if (!user) {
        if (inviteToken) {
          // Accepting an invitation → create as staff
          const inv = await pool.query(
            `SELECT * FROM invitations WHERE token=$1 AND used=FALSE AND expires_at > NOW()`,
            [inviteToken]
          );
          if (!inv.rows.length) return done(null, false, { message: 'Invite expired' });

          const invite = inv.rows[0];
          const ins = await pool.query(
            `INSERT INTO users (google_id, email, name, picture, role, owner_id)
             VALUES ($1,$2,$3,$4,'staff',$5) RETURNING *`,
            [googleId, email, name, picture, invite.owner_id]
          );
          user = ins.rows[0];

          // Grant access to invited companies
          for (const companyId of invite.company_ids) {
            await pool.query(
              `INSERT INTO staff_access (staff_user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
              [user.id, companyId]
            );
          }
          // Mark invite used
          await pool.query(`UPDATE invitations SET used=TRUE WHERE token=$1`, [inviteToken]);
          delete req.session.pendingInviteToken;
        } else {
          // New owner registration
          const ins = await pool.query(
            `INSERT INTO users (google_id, email, name, picture, role)
             VALUES ($1,$2,$3,$4,'owner') RETURNING *`,
            [googleId, email, name, picture]
          );
          user = ins.rows[0];
        }
      } else {
        // Existing user — update profile
        await pool.query(
          `UPDATE users SET name=$1, picture=$2 WHERE id=$3`,
          [name, picture, user.id]
        );
        user.name = name;
        user.picture = picture;

        // If existing user is accepting an invite, update access without changing role
        if (inviteToken) {
          const inv = await pool.query(
            `SELECT * FROM invitations WHERE token=$1 AND used=FALSE AND expires_at > NOW()`,
            [inviteToken]
          );
          if (inv.rows.length) {
            const invite = inv.rows[0];
            for (const companyId of invite.company_ids) {
              await pool.query(
                `INSERT INTO staff_access (staff_user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                [user.id, companyId]
              );
            }
            await pool.query(`UPDATE invitations SET used=TRUE WHERE token=$1`, [inviteToken]);
          }
          delete req.session.pendingInviteToken;
        }
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const r = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
      done(null, r.rows[0] || false);
    } catch (e) {
      done(e);
    }
  });
};
