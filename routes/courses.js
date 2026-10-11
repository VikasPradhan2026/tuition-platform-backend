const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Browse: ?subject=Maths&grade=10&mode=online
router.get('/', async (req, res) => {
  try {
    const { subject, grade, mode } = req.query;
    const result = await pool.query(
      `SELECT c.id, c.title, c.subject, c.grade, c.mode, c.fee, c.schedule,
              u.full_name AS teacher_name
       FROM courses c
       JOIN users u ON u.id = c.teacher_id
       WHERE ($1::text IS NULL OR c.subject ILIKE $1)
         AND ($2::text IS NULL OR c.grade = $2)
         AND ($3::class_mode IS NULL OR c.mode = $3::class_mode)
       ORDER BY c.title`,
      [subject || null, grade || null, mode || null]
    );
    res.json({ courses: result.rows });
  } catch (err) {
    if (err.code === '22P02') return res.status(400).json({ error: 'Invalid filter value' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// One course. Location/link only for admin, its teacher, or enrolled students.
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.full_name AS teacher_name
       FROM courses c JOIN users u ON u.id = c.teacher_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    const course = result.rows[0];
    if (!course) return res.status(404).json({ error: 'Course not found' });

    let canSeeAccess =
      req.user.role === 'admin' ||
      (req.user.role === 'teacher' && course.teacher_id === req.user.id);

    if (!canSeeAccess && req.user.role === 'student') {
      const enrolled = await pool.query(
        `SELECT 1 FROM enrollments
         WHERE course_id = $1 AND student_id = $2 AND status = 'active'`,
        [course.id, req.user.id]
      );
      canSeeAccess = !!enrolled.rows[0];
    }
    if (!canSeeAccess) {
      delete course.location;
      delete course.meeting_link;
    }
    res.json({ course });
  } catch (err) {
    if (err.code === '22P02') return res.status(400).json({ error: 'Invalid course id' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;