const express = require('express');

module.exports = function (passport) {
  const router = express.Router();

  router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email'],
  }));

  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html' }),
    (req, res) => res.redirect('/')
  );

  router.get('/logout', (req, res, next) => {
    req.logout(err => {
      if (err) return next(err);
      res.redirect('/login.html');
    });
  });

  router.get('/me', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
    const { id, email, name, picture, role, owner_id } = req.user;
    res.json({ id, email, name, picture, role, owner_id });
  });

  return router;
};
