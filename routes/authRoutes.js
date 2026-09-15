
const express = require('express');

const {
  register,
  verifyEmail,
  resendVerification,
  login,
  googleLogin,
  getMe,
  updateMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
} = require('../controllers/authController');

const protect = require('../middlewares/protect');
const { authLimiter } = require('../middlewares/rateLimiters');

const router = express.Router();

// =========================================================
// AUTH
// =========================================================
// Registration, login, and OTP/reset endpoints are all brute-force /
// enumeration targets, so they share a strict rate limiter.

router.post('/register', authLimiter, register);

router.post('/verify-email', authLimiter, verifyEmail);

router.post('/resend-verification', authLimiter, resendVerification);

router.post('/login', authLimiter, login);

router.post('/google', authLimiter, googleLogin);

// =========================================================
// CURRENT USER
// =========================================================

router.get('/me', protect, getMe);

router.patch('/me', protect, updateMe);

// =========================================================
// PASSWORD RESET
// =========================================================

router.post('/forgot-password', authLimiter, forgotPassword);

router.post('/verify-reset-otp', authLimiter, verifyResetOtp);

router.post('/reset-password', authLimiter, resetPassword);

module.exports = router;
