require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const { requireAuth } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', database: 'connected', time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/api/auth', authRoutes);
const adminRoutes = require('./routes/admin');
const courseRoutes = require('./routes/courses');
const enrollmentRoutes = require('./routes/enrollments');
const teacherRoutes = require('./routes/teacher');
const attendanceRoutes = require('./routes/attendance');
app.use('/api/attendance', attendanceRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/courses', courseRoutes);

// Quick test route: returns who you are if your token is valid
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, (err) => {
  if (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
  console.log(`Server running on port ${PORT}`);
});