const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // =========================================================
    // BASIC USER INFORMATION
    // =========================================================

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: 2,
      maxlength: 60,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },

    // =========================================================
    // AUTHENTICATION
    // =========================================================

    password: {
      type: String,
      minlength: 6,
      select: false,
    },

    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    googleId: {
      type: String,
      unique: true,
      sparse: true,
      select: false,
    },

    role: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: "customer",
    },

    address: {
      type: String,
      default: "",
    },

    phone: {
      type: String,
      default: "",
    },

    // =========================================================
    // EMAIL VERIFICATION
    // =========================================================

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerificationOtpHash: {
      type: String,
      select: false,
    },

    emailVerificationOtpExpires: {
      type: Date,
      select: false,
    },

    emailVerificationAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    emailVerificationLastSentAt: {
      type: Date,
      select: false,
    },

    // =========================================================
    // PASSWORD RESET
    // =========================================================

    passwordResetOtpHash: {
      type: String,
      select: false,
    },

    passwordResetOtpExpires: {
      type: Date,
      select: false,
    },

    passwordResetAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    passwordResetLastSentAt: {
      type: Date,
      select: false,
    },

    passwordResetTokenHash: {
      type: String,
      select: false,
    },

    passwordResetTokenExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

// =========================================================
// VALIDATE AUTH PROVIDER
// =========================================================

userSchema.pre("validate", function validateAuthProvider(next) {
  // Local accounts MUST have a password.
  if (
    this.authProvider === "local" &&
    (!this.password || this.password.trim() === "")
  ) {
    this.invalidate("password", "Password is required");
  }

  // Google accounts MUST have a Google ID.
  if (
    this.authProvider === "google" &&
    (!this.googleId || this.googleId.trim() === "")
  ) {
    this.invalidate("googleId", "Google ID is required for Google accounts");
  }

  next();
});

// =========================================================
// HASH PASSWORD BEFORE SAVE
// =========================================================

userSchema.pre("save", async function hashPassword(next) {
  // Google accounts don't have a password.
  if (!this.isModified("password") || !this.password) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);

  this.password = await bcrypt.hash(this.password, salt);

  next();
});

// =========================================================
// COMPARE PASSWORD
// =========================================================

userSchema.methods.comparePassword = async function comparePassword(candidate) {
  // Google accounts don't have a password.
  if (!this.password) {
    return false;
  }

  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("User", userSchema);
