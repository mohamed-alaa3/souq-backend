const mongoose = require("mongoose");

const orderVariantSchema = new mongoose.Schema(
  {
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    size: {
      type: String,
      trim: true,
      maxlength: 20,
    },

    color: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    sku: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },
  },
  { _id: false },
);

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    // Original product price at the time of order
    price: {
      type: Number,
      required: true,
      min: 0,
    },

    // Discount percentage at the time of order
    discountPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0,
    },

    // Final price actually paid for one unit
    finalPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    // Snapshot of the selected variant at the time of purchase.
    // Optional for old orders and products without variants.
    variant: {
      type: orderVariantSchema,
      default: undefined,
    },
  },
  { _id: false },
);

const orderCouponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
    },

    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },

    discountValue: {
      type: Number,
      required: true,
    },

    discountAmount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    items: {
      type: [orderItemSchema],
      required: true,
      validate: [
        (arr) => arr.length > 0,
        "Order must contain at least one item",
      ],
    },

    // Sum of item totals before coupon discount.
    subtotal: {
      type: Number,
      min: 0,
    },

    // Coupon snapshot at the moment of purchase.
    coupon: {
      type: orderCouponSchema,
      default: undefined,
    },

    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    shippingAddress: {
      type: String,
      required: [true, "Shipping address is required"],
    },

    status: {
      type: String,
      enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Order", orderSchema);
