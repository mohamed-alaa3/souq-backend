const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ---- Tunables for the forgot-password OTP flow ----
// Kept in one place so the frontend copy (resend cooldown, expiry, etc.)
// and the backend logic can be reasoned about together.
const OTP_LENGTH = 6;
const OTP_EXPIRES_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const RESET_TOKEN_EXPIRES_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Generates a cryptographically random numeric OTP of OTP_LENGTH digits.
 * Uses crypto.randomInt instead of Math.random for unpredictability.
 */
const generateOtp = () => {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH - 1;
  return crypto.randomInt(min, max + 1).toString();
};

const hashOtp = async (otp) => bcrypt.hash(otp, 10);

const compareOtp = async (otp, hash) => bcrypt.compare(otp, hash);

/**
 * Generates an opaque, high-entropy reset token (returned to the client
 * after a successful OTP check) and its hash (what we persist). Only the
 * hash is ever stored, mirroring how passwords/OTPs are handled.
 */
const generateResetToken = () => crypto.randomBytes(32).toString('hex');

const hashResetToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

/**
 * Constant-time comparison for the reset token hash to avoid leaking
 * information through timing differences.
 */
const safeCompareHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
};

module.exports = {
  OTP_LENGTH,
  OTP_EXPIRES_MINUTES,
  OTP_MAX_ATTEMPTS,
  RESET_TOKEN_EXPIRES_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  generateOtp,
  hashOtp,
  compareOtp,
  generateResetToken,
  hashResetToken,
  safeCompareHex,
};
