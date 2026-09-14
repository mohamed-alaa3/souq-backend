
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const {
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} = require('../utils/emailService');

const {
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
} = require('../utils/otp');

// =========================================================
// STRONG PASSWORD VALIDATION
// =========================================================

const isStrongPassword = (password) => {
  if (typeof password !== 'string') {
    return false;
  }

  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
};

const strongPasswordError = () =>
  new ApiError(
    400,
    'Password must be at least 8 characters and include uppercase, lowercase, number and special character',
  );

// =========================================================
// REGISTER
// =========================================================

const register = asyncHandler(async (req, res) => {
  const { name, email, password, address, phone } = req.body;

  if (!name || !email || !password) {
    throw new ApiError(400, 'Name, email and password are required');
  }

  if (!isStrongPassword(password)) {
    throw strongPasswordError();
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    if (existing.isEmailVerified === false) {
      throw new ApiError(
        400,
        'An account with this email already exists. Please verify your email.',
      );
    }

    throw new ApiError(
      400,
      'A user with this email already exists',
    );
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);

  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    role: 'customer',
    address,
    phone,

    isEmailVerified: false,

    emailVerificationOtpHash: otpHash,
    emailVerificationOtpExpires: new Date(
      Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000,
    ),
    emailVerificationAttempts: 0,
    emailVerificationLastSentAt: new Date(),
  });

  try {
    await sendEmailVerificationEmail({
      to: user.email,
      name: user.name,
      otp,
      expiresMinutes: OTP_EXPIRES_MINUTES,
    });
  } catch (err) {
    console.error(
      'Failed to send email verification email:',
      err.message,
    );

    throw new ApiError(
      503,
      'Account created, but we could not send the verification email. Please try again.',
    );
  }

  res.status(201).json({
    success: true,
    data: {
      message: 'Verification code sent to your email.',
      email: user.email,
      expiresInSeconds: OTP_EXPIRES_MINUTES * 60,
      resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS,
    },
  });
});

// =========================================================
// VERIFY EMAIL
// =========================================================

const verifyEmail = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new ApiError(
      400,
      'Email and verification code are required',
    );
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  const invalidOtpError = () =>
    new ApiError(
      400,
      'Invalid or expired verification code',
    );

  const user = await User.findOne({
    email: normalizedEmail,
  }).select(
    '+emailVerificationOtpHash ' +
      '+emailVerificationOtpExpires ' +
      '+emailVerificationAttempts',
  );

  if (
    !user ||
    user.isEmailVerified !== false ||
    !user.emailVerificationOtpHash ||
    !user.emailVerificationOtpExpires ||
    user.emailVerificationOtpExpires.getTime() < Date.now()
  ) {
    throw invalidOtpError();
  }

  if (user.emailVerificationAttempts >= OTP_MAX_ATTEMPTS) {
    user.emailVerificationOtpHash = undefined;
    user.emailVerificationOtpExpires = undefined;
    user.emailVerificationAttempts = 0;

    await user.save({
      validateBeforeSave: false,
    });

    throw new ApiError(
      429,
      'Too many attempts. Please request a new verification code.',
    );
  }

  const isMatch = await compareOtp(
    String(otp),
    user.emailVerificationOtpHash,
  );

  if (!isMatch) {
    user.emailVerificationAttempts += 1;

    await user.save({
      validateBeforeSave: false,
    });

    throw invalidOtpError();
  }

  user.isEmailVerified = true;

  user.emailVerificationOtpHash = undefined;
  user.emailVerificationOtpExpires = undefined;
  user.emailVerificationAttempts = 0;
  user.emailVerificationLastSentAt = undefined;

  await user.save({
    validateBeforeSave: false,
  });

  const token = generateToken(user._id);

  res.status(200).json({
    success: true,
    data: {
      message: 'Email verified successfully.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    },
  });
});

// =========================================================
// RESEND EMAIL VERIFICATION
// =========================================================

const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    throw new ApiError(
      400,
      'Please provide a valid email address',
    );
  }

  const normalizedEmail = email.toLowerCase().trim();

  const user = await User.findOne({
    email: normalizedEmail,
  }).select(
    '+emailVerificationOtpHash ' +
      '+emailVerificationOtpExpires ' +
      '+emailVerificationLastSentAt',
  );

  // Generic response for unknown/verified accounts.
  if (!user || user.isEmailVerified !== false) {
    return res.status(200).json({
      success: true,
      data: {
        message:
          'If an unverified account exists for that email, a verification code has been sent.',
        expiresInSeconds: OTP_EXPIRES_MINUTES * 60,
        resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS,
      },
    });
  }

  if (user.emailVerificationLastSentAt) {
    const elapsed =
      Date.now() -
      user.emailVerificationLastSentAt.getTime();

    const cooldownMs =
      RESEND_COOLDOWN_SECONDS * 1000;

    if (elapsed < cooldownMs) {
      const remainingSeconds = Math.ceil(
        (cooldownMs - elapsed) / 1000,
      );

      throw new ApiError(
        429,
        `Please wait ${remainingSeconds} seconds before requesting another code.`,
      );
    }
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);

  user.emailVerificationOtpHash = otpHash;
  user.emailVerificationOtpExpires = new Date(
    Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000,
  );
  user.emailVerificationAttempts = 0;
  user.emailVerificationLastSentAt = new Date();

  await user.save({
    validateBeforeSave: false,
  });

  try {
    await sendEmailVerificationEmail({
      to: user.email,
      name: user.name,
      otp,
      expiresMinutes: OTP_EXPIRES_MINUTES,
    });
  } catch (err) {
    console.error(
      'Failed to resend verification email:',
      err.message,
    );

    throw new ApiError(
      503,
      'We could not send the verification email. Please try again later.',
    );
  }

  res.status(200).json({
    success: true,
    data: {
      message: 'A new verification code has been sent.',
      expiresInSeconds: OTP_EXPIRES_MINUTES * 60,
      resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS,
    },
  });
});

// =========================================================
// LOGIN
// =========================================================

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(
      400,
      'Email and password are required',
    );
  }

  const normalizedEmail = String(email)
    .toLowerCase()
    .trim();

  const user = await User.findOne({
    email: normalizedEmail,
  }).select('+password');

  if (!user) {
    throw new ApiError(
      401,
      'Invalid email or password',
    );
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    throw new ApiError(
      401,
      'Invalid email or password',
    );
  }

  // New accounts explicitly have false.
  // Legacy accounts without this field remain usable.
  if (user.isEmailVerified === false) {
    throw new ApiError(
      403,
      'Please verify your email before logging in.',
    );
  }

  const token = generateToken(user._id);

  res.status(200).json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    },
  });
});

// =========================================================
// GET ME
// =========================================================

const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: req.user,
  });
});

// =========================================================
// UPDATE ME
// =========================================================

const updateMe = asyncHandler(async (req, res) => {
  const { name, address, phone } = req.body;

  const user = await User.findById(req.user._id);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (name !== undefined) {
    user.name = name;
  }

  if (address !== undefined) {
    user.address = address;
  }

  if (phone !== undefined) {
    user.phone = phone;
  }

  await user.save();

  res.status(200).json({
    success: true,
    data: user,
  });
});

// =========================================================
// FORGOT PASSWORD
// =========================================================

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    throw new ApiError(
      400,
      'Please provide a valid email address',
    );
  }

  const normalizedEmail = email.toLowerCase().trim();

  const genericMessage =
    "If an account exists for that email, we've sent a verification code.";

  const user = await User.findOne({
    email: normalizedEmail,
  }).select(
    '+passwordResetLastSentAt',
  );

  // Do not allow password reset for explicitly unverified
  // newly-created accounts.
  if (user && user.isEmailVerified === false) {
    return res.status(200).json({
      success: true,
      data: {
        message: genericMessage,
        expiresInSeconds: OTP_EXPIRES_MINUTES * 60,
        resendAvailableInSeconds:
          RESEND_COOLDOWN_SECONDS,
      },
    });
  }

  if (user) {
    const cooldownActive =
      user.passwordResetLastSentAt &&
      Date.now() -
        user.passwordResetLastSentAt.getTime() <
        RESEND_COOLDOWN_SECONDS * 1000;

    if (!cooldownActive) {
      const otp = generateOtp();
      const otpHash = await hashOtp(otp);

      user.passwordResetOtpHash = otpHash;
      user.passwordResetOtpExpires = new Date(
        Date.now() +
          OTP_EXPIRES_MINUTES * 60 * 1000,
      );
      user.passwordResetAttempts = 0;
      user.passwordResetLastSentAt = new Date();

      user.passwordResetTokenHash = undefined;
      user.passwordResetTokenExpires = undefined;

      await user.save({
        validateBeforeSave: false,
      });

      try {
        await sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          otp,
          expiresMinutes: OTP_EXPIRES_MINUTES,
        });
      } catch (err) {
        console.error(
          'Failed to send password reset email:',
          err.message,
        );

        if (process.env.NODE_ENV !== 'production') {
          console.log(
            `[DEV ONLY] Password reset OTP for ${user.email}: ${otp}`,
          );
        }
      }
    }
  }

  res.status(200).json({
    success: true,
    data: {
      message: genericMessage,
      expiresInSeconds:
        OTP_EXPIRES_MINUTES * 60,
      resendAvailableInSeconds:
        RESEND_COOLDOWN_SECONDS,
    },
  });
});

// =========================================================
// VERIFY RESET OTP
// =========================================================

const verifyResetOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new ApiError(
      400,
      'Email and verification code are required',
    );
  }

  const normalizedEmail = String(email)
    .toLowerCase()
    .trim();

  const invalidOtpError = () =>
    new ApiError(
      400,
      'Invalid or expired verification code',
    );

  const user = await User.findOne({
    email: normalizedEmail,
  }).select(
    '+passwordResetOtpHash ' +
      '+passwordResetOtpExpires ' +
      '+passwordResetAttempts',
  );

  if (
    !user ||
    !user.passwordResetOtpHash ||
    !user.passwordResetOtpExpires ||
    user.passwordResetOtpExpires.getTime() <
      Date.now()
  ) {
    throw invalidOtpError();
  }

  if (
    user.passwordResetAttempts >=
    OTP_MAX_ATTEMPTS
  ) {
    user.passwordResetOtpHash = undefined;
    user.passwordResetOtpExpires = undefined;
    user.passwordResetAttempts = 0;

    await user.save({
      validateBeforeSave: false,
    });

    throw new ApiError(
      429,
      'Too many attempts. Please request a new code.',
    );
  }

  const isMatch = await compareOtp(
    String(otp),
    user.passwordResetOtpHash,
  );

  if (!isMatch) {
    user.passwordResetAttempts += 1;

    await user.save({
      validateBeforeSave: false,
    });

    throw invalidOtpError();
  }

  const resetToken = generateResetToken();

  user.passwordResetTokenHash =
    hashResetToken(resetToken);

  user.passwordResetTokenExpires = new Date(
    Date.now() +
      RESET_TOKEN_EXPIRES_MINUTES * 60 * 1000,
  );

  user.passwordResetOtpHash = undefined;
  user.passwordResetOtpExpires = undefined;
  user.passwordResetAttempts = 0;

  await user.save({
    validateBeforeSave: false,
  });

  res.status(200).json({
    success: true,
    data: {
      message: 'Verification code confirmed',
      resetToken,
      expiresInSeconds:
        RESET_TOKEN_EXPIRES_MINUTES * 60,
    },
  });
});

// =========================================================
// RESET PASSWORD
// =========================================================

const resetPassword = asyncHandler(async (req, res) => {
  const {
    email,
    resetToken,
    newPassword,
    confirmPassword,
  } = req.body;

  if (
    !email ||
    !resetToken ||
    !newPassword ||
    !confirmPassword
  ) {
    throw new ApiError(
      400,
      'All fields are required',
    );
  }

  if (newPassword !== confirmPassword) {
    throw new ApiError(
      400,
      'Passwords do not match',
    );
  }

  if (!isStrongPassword(newPassword)) {
    throw strongPasswordError();
  }

  const normalizedEmail = String(email)
    .toLowerCase()
    .trim();

  const sessionExpiredError = () =>
    new ApiError(
      400,
      'Your reset session has expired. Please start again.',
    );

  const user = await User.findOne({
    email: normalizedEmail,
  }).select(
    '+passwordResetTokenHash ' +
      '+passwordResetTokenExpires',
  );

  if (
    !user ||
    !user.passwordResetTokenHash ||
    !user.passwordResetTokenExpires ||
    user.passwordResetTokenExpires.getTime() <
      Date.now()
  ) {
    throw sessionExpiredError();
  }

  const providedTokenHash = hashResetToken(
    String(resetToken),
  );

  if (
    !safeCompareHex(
      providedTokenHash,
      user.passwordResetTokenHash,
    )
  ) {
    throw sessionExpiredError();
  }

  user.password = newPassword;

  user.passwordResetTokenHash = undefined;
  user.passwordResetTokenExpires = undefined;

  user.passwordResetOtpHash = undefined;
  user.passwordResetOtpExpires = undefined;
  user.passwordResetAttempts = 0;
  user.passwordResetLastSentAt = undefined;

  await user.save();

  res.status(200).json({
    success: true,
    data: {
      message:
        'Your password has been reset successfully',
    },
  });
});

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  getMe,
  updateMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
};

