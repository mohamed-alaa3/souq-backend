const rateLimit = require('express-rate-limit');

// Shared JSON error shape so a rate-limited response looks like every other
// API error instead of express-rate-limit's default plain text.
const jsonHandler = (req, res) => {
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
  });
};

// Jest sets NODE_ENV=test automatically for every test run. The existing
// test suite builds real Express apps around the real routers (supertest)
// and fires many requests at the same auth/coupon/review endpoints within
// a single process, so limiters must not engage there - only real
// dev/production traffic should ever be throttled.
const skipInTest = () => process.env.NODE_ENV === 'test';

// Strict: brute-force-able authentication endpoints (login, register,
// forgot-password, OTP verify/resend, reset-password).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: jsonHandler,
});

// Moderate: authenticated but sensitive/abusable write actions
// (creating a review, validating a coupon).
const moderateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: jsonHandler,
});

// Normal: general public browsing/API traffic. Generous so it never gets in
// the way of legitimate usage, just blunts abusive scripted traffic.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: jsonHandler,
});

module.exports = { authLimiter, moderateLimiter, generalLimiter };
