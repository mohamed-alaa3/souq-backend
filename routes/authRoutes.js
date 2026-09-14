
const express = require('express');

const {
  register,
  verifyEmail,
  resendVerification,
  login,
  getMe,
  updateMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
} = require('../controllers/authController');

const protect = require('../middlewares/protect');

const router = express.Router();

// =========================================================
// AUTH
// =========================================================

router.post('/register', register);

router.post('/verify-email', verifyEmail);

router.post('/resend-verification', resendVerification);

router.post('/login', login);

// =========================================================
// CURRENT USER
// =========================================================

router.get('/me', protect, getMe);

router.patch('/me', protect, updateMe);

// =========================================================
// PASSWORD RESET
// =========================================================

router.post('/forgot-password', forgotPassword);

router.post('/verify-reset-otp', verifyResetOtp);

router.post('/reset-password', resetPassword);

module.exports = router;

