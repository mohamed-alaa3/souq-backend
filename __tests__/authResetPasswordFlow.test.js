process.env.JWT_SECRET = 'test_secret_key';
process.env.NODE_ENV = 'test';

jest.mock('../models/User');
jest.mock('../utils/emailService');

const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const User = require('../models/User');
const { sendPasswordResetEmail } = require('../utils/emailService');

const authRoutes = require('../routes/authRoutes');
const notFound = require('../middlewares/notFound');
const errorHandler = require('../middlewares/errorHandler');

// Build the app the same way server.js does for this router, so the full
// real pipeline (routing, validation, error handling) runs exactly as it
// would in production.
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

const buildUser = (overrides = {}) => ({
  _id: 'user1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  role: 'customer',
  passwordResetOtpHash: undefined,
  passwordResetOtpExpires: undefined,
  passwordResetAttempts: 0,
  passwordResetLastSentAt: undefined,
  passwordResetTokenHash: undefined,
  passwordResetTokenExpires: undefined,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  sendPasswordResetEmail.mockResolvedValue(undefined);
});

describe('POST /api/auth/forgot-password', () => {
  test('returns the same generic message for an unknown email (no enumeration)', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toMatch(/if an account exists/i);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test('known email: generates + saves an OTP hash and emails the code', async () => {
    const user = buildUser();
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'JANE@example.com' }); // case-insensitive

    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/if an account exists/i);
    expect(user.save).toHaveBeenCalled();
    expect(user.passwordResetOtpHash).toBeTruthy();
    expect(user.passwordResetOtpExpires).toBeInstanceOf(Date);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: user.email }),
    );
  });

  test('respects the resend cooldown by not sending a new code (same response)', async () => {
    const user = buildUser({ passwordResetLastSentAt: new Date() });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: user.email });

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test('missing email -> 400', async () => {
    const res = await request(buildApp()).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/auth/verify-reset-otp', () => {
  test('correct OTP issues a reset token and burns the OTP', async () => {
    const otp = '123456';
    const otpHash = await bcrypt.hash(otp, 10);
    const user = buildUser({
      passwordResetOtpHash: otpHash,
      passwordResetOtpExpires: new Date(Date.now() + 60000),
      passwordResetAttempts: 0,
    });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp())
      .post('/api/auth/verify-reset-otp')
      .send({ email: user.email, otp });

    expect(res.status).toBe(200);
    expect(res.body.data.resetToken).toEqual(expect.any(String));
    expect(user.passwordResetOtpHash).toBeUndefined();
    expect(user.passwordResetTokenHash).toBeTruthy();
  });

  test('wrong OTP increments attempts and returns a generic 400', async () => {
    const otpHash = await bcrypt.hash('654321', 10);
    const user = buildUser({
      passwordResetOtpHash: otpHash,
      passwordResetOtpExpires: new Date(Date.now() + 60000),
      passwordResetAttempts: 0,
    });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp())
      .post('/api/auth/verify-reset-otp')
      .send({ email: user.email, otp: '000000' });

    expect(res.status).toBe(400);
    expect(user.passwordResetAttempts).toBe(1);
  });

  test('expired OTP -> 400 without leaking whether the account exists', async () => {
    const user = buildUser({
      passwordResetOtpHash: 'somehash',
      passwordResetOtpExpires: new Date(Date.now() - 1000),
    });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp())
      .post('/api/auth/verify-reset-otp')
      .send({ email: user.email, otp: '123456' });

    expect(res.status).toBe(400);
  });

  test('too many attempts -> 429 and clears the OTP', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const user = buildUser({
      passwordResetOtpHash: otpHash,
      passwordResetOtpExpires: new Date(Date.now() + 60000),
      passwordResetAttempts: 5,
    });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp())
      .post('/api/auth/verify-reset-otp')
      .send({ email: user.email, otp: '123456' });

    expect(res.status).toBe(429);
    expect(user.passwordResetOtpHash).toBeUndefined();
  });
});

describe('Full flow: forgot -> verify -> reset (single user document across all 3 calls)', () => {
  test('a user can request a code, verify it, and set a new password end-to-end', async () => {
    // One shared, stateful mock "document" - mutated by each call exactly
    // like a real Mongoose document would be, so this exercises the same
    // state handoff (OTP hash -> reset token -> new password) that a real
    // MongoDB record goes through across the three requests.
    const user = buildUser();
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const app = buildApp();

    // Step 1: request a code.
    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: user.email });
    expect(forgotRes.status).toBe(200);
    expect(user.passwordResetOtpHash).toBeTruthy();

    // Recover the plaintext OTP the "email" would have contained.
    const sentOtp = sendPasswordResetEmail.mock.calls[0][0].otp;
    expect(sentOtp).toMatch(/^\d{6}$/);

    // Step 2: verify it.
    const verifyRes = await request(app)
      .post('/api/auth/verify-reset-otp')
      .send({ email: user.email, otp: sentOtp });
    expect(verifyRes.status).toBe(200);
    const { resetToken } = verifyRes.body.data;
    expect(resetToken).toEqual(expect.any(String));
    // OTP must be burned after a successful verification.
    expect(user.passwordResetOtpHash).toBeUndefined();

    // Step 3: set the new password using the token from step 2.
    const resetRes = await request(app).post('/api/auth/reset-password').send({
      email: user.email,
      resetToken,
      newPassword: 'brandNewPass1!',
      confirmPassword: 'brandNewPass1!',
    });
    expect(resetRes.status).toBe(200);
    expect(user.password).toBe('brandNewPass1!');
    expect(user.passwordResetTokenHash).toBeUndefined();

    // The reset token is single-use - replaying step 3 must now fail.
    const replayRes = await request(app).post('/api/auth/reset-password').send({
      email: user.email,
      resetToken,
      newPassword: 'anotherPass1!',
      confirmPassword: 'anotherPass1!',
    });
    expect(replayRes.status).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {
  test('valid reset token sets a new password', async () => {
    const resetToken = 'a'.repeat(64);
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const user = buildUser({
      passwordResetTokenHash: tokenHash,
      passwordResetTokenExpires: new Date(Date.now() + 60000),
    });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp()).post('/api/auth/reset-password').send({
      email: user.email,
      resetToken,
      newPassword: 'newSecret123!',
      confirmPassword: 'newSecret123!',
    });

    expect(res.status).toBe(200);
    expect(user.password).toBe('newSecret123!');
    expect(user.passwordResetTokenHash).toBeUndefined();
    expect(user.save).toHaveBeenCalled();
  });

  test('mismatched passwords -> 400, never reaches the DB lookup', async () => {
    const res = await request(buildApp()).post('/api/auth/reset-password').send({
      email: 'jane@example.com',
      resetToken: 'x'.repeat(64),
      newPassword: 'abcdefg',
      confirmPassword: 'different',
    });

    expect(res.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('invalid/mismatched reset token -> 400', async () => {
    const tokenHash = crypto.createHash('sha256').update('correct-token').digest('hex');
    const user = buildUser({
      passwordResetTokenHash: tokenHash,
      passwordResetTokenExpires: new Date(Date.now() + 60000),
    });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp()).post('/api/auth/reset-password').send({
      email: user.email,
      resetToken: 'wrong-token'.padEnd(64, '0'),
      newPassword: 'newSecret123!',
      confirmPassword: 'newSecret123!',
    });

    expect(res.status).toBe(400);
  });

  test('expired reset token -> 400', async () => {
    const resetToken = 'a'.repeat(64);
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const user = buildUser({
      passwordResetTokenHash: tokenHash,
      passwordResetTokenExpires: new Date(Date.now() - 1000),
    });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const res = await request(buildApp()).post('/api/auth/reset-password').send({
      email: user.email,
      resetToken,
      newPassword: 'newSecret123!',
      confirmPassword: 'newSecret123!',
    });

    expect(res.status).toBe(400);
  });
});
