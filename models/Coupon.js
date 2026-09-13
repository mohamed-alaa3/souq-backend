const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Coupon code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },

    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },

    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },

    // Order subtotal must reach this amount before the coupon can be applied.
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Caps how much a percentage coupon can discount in absolute terms.
    // Irrelevant for fixed-amount coupons.
    maxDiscount: {
      type: Number,
      min: 0,
      default: null,
    },

    startDate: {
      type: Date,
      required: true,
    },

    expiryDate: {
      type: Date,
      required: true,
    },

    // Total number of times this coupon may ever be used, across all users.
    // null = unlimited.
    usageLimit: {
      type: Number,
      min: 1,
      default: null,
    },

    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // How many times a single user may use this coupon. null = unlimited.
    perUserLimit: {
      type: Number,
      min: 1,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Coupon", couponSchema);
