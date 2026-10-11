// JavaScript source code
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

// Join a course
router.post('/', async (req, res) => {
  try {
    const { course_id } = req.body;
    if (!course_id) return res.status(400).json({ error: 'course_id is required' });

    const course = await pool.query('SELECT id FROM courses WHERE id = $1', [course_id]);
    if (!course.rows[0]) return res.status(404).json({ error: 'Course not found' });

    const result = await pool.query(
      `INSERT INTO enrollments (student_id, course_id)
       VALUES ($1, $2)
       RETURNING id, course_id, status, enrolled_at`,
      [req.user.id, course_id]
    );
    res.status(201).json({ enrollment: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Already enrolled in this course' });
    if (err.code === '22P02') return res.status(400).json({ error: 'Invalid course_id' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// My enrolled courses (includes meeting link / location)
router.get('/me', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id AS enrollment_id, e.enrolled_at,
              c.id AS course_id, c.title, c.subject, c.grade, c.mode,
              c.location, c.meeting_link, c.schedule,
              u.full_name AS teacher_name
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN users u ON u.id = c.teacher_id
       WHERE e.student_id = $1 AND e.status = 'active'
       ORDER BY e.enrolled_at DESC`,
      [req.user.id]
    );
    res.json({ enrollments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;