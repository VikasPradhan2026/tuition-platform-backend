const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('teacher'));

function handleError(res, err) {
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid value or id format' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}

// View my profile
router.get('/profile', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone,
              p.subjects, p.grades, p.availability, p.payout_type, p.bio
       FROM users u
       LEFT JOIN teacher_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json({ profile: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// Update my profile (send only the fields you want to change).
// Pay rates are NOT here on purpose: the admin sets those.
router.put('/profile', async (req, res) => {
  try {
    const { subjects, grades, availability, payout_type, bio } = req.body;
    if (subjects !== undefined && !Array.isArray(subjects)) {
      return res.status(400).json({ error: 'subjects must be a list' });
    }
    if (grades !== undefined && !Array.isArray(grades)) {
      return res.status(400).json({ error: 'grades must be a list' });
    }
    if (payout_type !== undefined && !['hourly', 'monthly'].includes(payout_type)) {
      return res.status(400).json({ error: 'payout_type must be hourly or monthly' });
    }

    const result = await pool.query(
      `INSERT INTO teacher_profiles (user_id, subjects, grades, availability, payout_type, bio)
       VALUES ($1, $2::text[], $3::text[], $4::jsonb, $5::payout_type, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         subjects = COALESCE(EXCLUDED.subjects, teacher_profiles.subjects),
         grades = COALESCE(EXCLUDED.grades, teacher_profiles.grades),
         availability = COALESCE(EXCLUDED.availability, teacher_profiles.availability),
         payout_type = COALESCE(EXCLUDED.payout_type, teacher_profiles.payout_type),
         bio = COALESCE(EXCLUDED.bio, teacher_profiles.bio)
       RETURNING user_id, subjects, grades, availability, payout_type, bio`,
      [req.user.id, subjects ?? null, grades ?? null,
       availability ? JSON.stringify(availability) : null,
       payout_type ?? null, bio ?? null]
    );
    res.json({ profile: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// Courses assigned to me
router.get('/courses', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, subject, grade, mode, location, meeting_link, fee, schedule
       FROM courses WHERE teacher_id = $1 ORDER BY title`,
      [req.user.id]
    );
    res.json({ courses: result.rows });
  } catch (err) {
    handleError(res, err);
  }
});

// Schedule a class session for one of my courses
router.post('/sessions', async (req, res) => {
  try {
    const { course_id, scheduled_start, scheduled_end } = req.body;
    if (!course_id || !scheduled_start || !scheduled_end) {
      return res.status(400).json({ error: 'course_id, scheduled_start and scheduled_end are required' });
    }
    const start = Date.parse(scheduled_start);
    const end = Date.parse(scheduled_end);
    if (isNaN(start) || isNaN(end) || end <= start) {
      return res.status(400).json({ error: 'Invalid times: end must be after start' });
    }

    const course = await pool.query(
      'SELECT id FROM courses WHERE id = $1 AND teacher_id = $2',
      [course_id, req.user.id]
    );
    if (!course.rows[0]) return res.status(404).json({ error: 'Course not found or not yours' });

    const result = await pool.query(
      `INSERT INTO sessions (course_id, scheduled_start, scheduled_end)
       VALUES ($1, $2, $3) RETURNING *`,
      [course_id, scheduled_start, scheduled_end]
    );
    res.status(201).json({ session: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// My upcoming and past sessions
router.get('/sessions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.course_id, c.title, s.scheduled_start, s.scheduled_end,
              s.actual_start, s.actual_end, s.status
       FROM sessions s JOIN courses c ON c.id = s.course_id
       WHERE c.teacher_id = $1
       ORDER BY s.scheduled_start DESC`,
      [req.user.id]
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    handleError(res, err);
  }
});

// Start a class (only my own, only if scheduled)
router.post('/sessions/:id/start', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE sessions s SET status = 'live', actual_start = now()
       FROM courses c
       WHERE s.id = $1 AND s.course_id = c.id AND c.teacher_id = $2 AND s.status = 'scheduled'
       RETURNING s.id, s.status, s.actual_start`,
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Session not found, not yours, or already started' });
    }
    res.json({ session: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// End a class (only if live)
router.post('/sessions/:id/end', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE sessions s SET status = 'completed', actual_end = now()
       FROM courses c
       WHERE s.id = $1 AND s.course_id = c.id AND c.teacher_id = $2 AND s.status = 'live'
       RETURNING s.id, s.status, s.actual_start, s.actual_end`,
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Session not found, not yours, or not live' });
    }
    res.json({ session: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;