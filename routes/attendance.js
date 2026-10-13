// JavaScript source code
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// QR codes use their own signing key, so they can never work as login tokens
const QR_SECRET = process.env.JWT_SECRET + ':attendance-qr';

function handleError(res, err) {
  if (err.code === '23505') return res.status(409).json({ error: 'Attendance already marked' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid id format' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}

async function markAttendance(res, studentId, sessionId, mode, method) {
  const found = await pool.query(
    `SELECT s.status, c.mode, c.id AS course_id
     FROM sessions s JOIN courses c ON c.id = s.course_id
     WHERE s.id = $1`,
    [sessionId]
  );
  const row = found.rows[0];
  if (!row) return res.status(404).json({ error: 'Session not found' });
  if (row.status !== 'live') return res.status(400).json({ error: 'Class is not live right now' });
  if (row.mode !== mode) {
    return res.status(400).json({
      error: mode === 'online'
        ? 'This is an offline class: scan the QR code instead'
        : 'This is an online class: use check-in instead'
    });
  }

  const enrolled = await pool.query(
    `SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2 AND status = 'active'`,
    [row.course_id, studentId]
  );
  if (!enrolled.rows[0]) return res.status(403).json({ error: 'You are not enrolled in this course' });

  const result = await pool.query(
    `INSERT INTO attendance (session_id, student_id, method)
     VALUES ($1, $2, $3)
     RETURNING id, session_id, marked_at, method, present`,
    [sessionId, studentId, method]
  );
  return res.status(201).json({ attendance: result.rows[0] });
}

// Student: check in to a live ONLINE class
router.post('/checkin', requireRole('student'), async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    await markAttendance(res, req.user.id, session_id, 'online', 'click_in');
  } catch (err) {
    handleError(res, err);
  }
});

// Student: scan the teacher's QR for an OFFLINE class
router.post('/scan', requireRole('student'), async (req, res) => {
  try {
    const { qr_token } = req.body;
    if (!qr_token) return res.status(400).json({ error: 'qr_token is required' });

    let payload;
    try {
      payload = jwt.verify(qr_token, QR_SECRET);
    } catch {
      return res.status(400).json({ error: 'QR code is invalid or expired' });
    }
    if (!payload.sid) return res.status(400).json({ error: 'QR code is invalid' });

    await markAttendance(res, req.user.id, payload.sid, 'offline', 'qr');
  } catch (err) {
    handleError(res, err);
  }
});

// Teacher: get a fresh QR token for my live OFFLINE class (valid 2 minutes)
router.post('/sessions/:id/qr', requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id FROM sessions s JOIN courses c ON c.id = s.course_id
       WHERE s.id = $1 AND c.teacher_id = $2 AND s.status = 'live' AND c.mode = 'offline'`,
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'No live offline session of yours with this id' });
    }
    const qr_token = jwt.sign({ sid: req.params.id }, QR_SECRET, { expiresIn: '2m' });
    res.json({ qr_token, expires_in_seconds: 120 });
  } catch (err) {
    handleError(res, err);
  }
});

// Teacher: who attended my session
router.get('/sessions/:id', requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id AS student_id, u.full_name, a.marked_at, a.method
       FROM attendance a
       JOIN users u ON u.id = a.student_id
       JOIN sessions s ON s.id = a.session_id
       JOIN courses c ON c.id = s.course_id
       WHERE a.session_id = $1 AND c.teacher_id = $2
       ORDER BY a.marked_at`,
      [req.params.id, req.user.id]
    );
    res.json({ attendance: result.rows });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;