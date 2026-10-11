const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const USER_STATUSES = ['pending', 'active', 'suspended'];
const COURSE_MODES = ['online', 'offline'];

function handleError(res, err) {
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid value or id format' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}

// List users, optional filters: ?role=teacher&status=pending
router.get('/users', async (req, res) => {
  try {
    const { role, status } = req.query;
    const result = await pool.query(
      `SELECT id, role, full_name, email, phone, status, created_at
       FROM users
       WHERE ($1::user_role IS NULL OR role = $1::user_role)
         AND ($2::user_status IS NULL OR status = $2::user_status)
       ORDER BY created_at DESC`,
      [role || null, status || null]
    );
    res.json({ users: result.rows });
  } catch (err) {
    handleError(res, err);
  }
});

// Approve / suspend a user
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!USER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'status must be pending, active or suspended' });
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You can't change your own status" });
    }
    const result = await pool.query(
      `UPDATE users SET status = $1
       WHERE id = $2 AND role <> 'admin'
       RETURNING id, role, full_name, email, status`,
      [status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// Create a course
router.post('/courses', async (req, res) => {
  try {
    const { title, subject, grade, teacher_id, mode, location, meeting_link, fee, schedule } = req.body;

    if (!title || !teacher_id || !COURSE_MODES.includes(mode)) {
      return res.status(400).json({ error: 'title, teacher_id and mode (online/offline) are required' });
    }
    if (mode === 'offline' && !location) {
      return res.status(400).json({ error: 'location is required for offline courses' });
    }
    if (mode === 'online' && !meeting_link) {
      return res.status(400).json({ error: 'meeting_link is required for online courses' });
    }
    if (fee !== undefined && (isNaN(fee) || Number(fee) < 0)) {
      return res.status(400).json({ error: 'fee must be a positive number' });
    }

    const teacher = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND role = 'teacher' AND status = 'active'`,
      [teacher_id]
    );
    if (!teacher.rows[0]) {
      return res.status(400).json({ error: 'teacher_id must belong to an active teacher' });
    }

    const result = await pool.query(
      `INSERT INTO courses (title, subject, grade, teacher_id, mode, location, meeting_link, fee, schedule)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [title, subject || null, grade || null, teacher_id, mode,
       location || null, meeting_link || null, fee ?? null,
       schedule ? JSON.stringify(schedule) : null]
    );
    res.status(201).json({ course: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;