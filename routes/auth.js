const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();
const SELF_SIGNUP_ROLES = ['student', 'teacher']; // admin can never self-register

router.post('/register', async (req, res) => {
  try {
    const { role, full_name, email, phone, password } = req.body;

    if (!SELF_SIGNUP_ROLES.includes(role)) {
      return res.status(400).json({ error: 'role must be student or teacher' });
    }
    if (!full_name || !password || (!email && !phone)) {
      return res.status(400).json({ error: 'full_name, password and email or phone are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const hash = await bcrypt.hash(password, 10);
    const status = role === 'student' ? 'active' : 'pending'; // teachers need admin approval

    const result = await pool.query(
      `INSERT INTO users (role, full_name, email, phone, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, role, full_name, email, phone, status`,
      [role, full_name, email || null, phone || null, hash, status]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email or phone already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    if (!password || (!email && !phone)) {
      return res.status(400).json({ error: 'Email or phone, and password are required' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR phone = $2',
      [email || null, phone || null]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Account awaiting admin approval' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: { id: user.id, role: user.role, full_name: user.full_name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;