const Coupon = require("../models/Coupon");
const Order = require("../models/Order");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const EDITABLE_FIELDS = [
  "code",
  "discountType",
  "discountValue",
  "minOrderAmount",
  "maxDiscount",
  "startDate",
  "expiryDate",
  "usageLimit",
  "perUserLimit",
  "isActive",
];

const pickEditableFields = (body) => {
  const data = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  });
  return data;
};

// Validates a (possibly partial) set of coupon fields against the full,
// resulting coupon shape - `resulting` is what the coupon would look like
// once these fields are applied, so create and update share one path.
const validateResultingCoupon = (resulting) => {
  if (!resulting.code || !String(resulting.code).trim()) {
    throw new ApiError(400, "Coupon code is required");
  }

  if (!["percentage", "fixed"].includes(resulting.discountType)) {
    throw new ApiError(400, 'discountType must be "percentage" or "fixed"');
  }

  const discountValue = Number(resulting.discountValue);
  if (Number.isNaN(discountValue) || discountValue <= 0) {
    throw new ApiError(400, "discountValue must be a positive number");
  }

  if (resulting.discountType === "percentage" && discountValue > 100) {
    throw new ApiError(400, "A percentage discount cannot exceed 100");
  }

  if (!resulting.startDate || !resulting.expiryDate) {
    throw new ApiError(400, "startDate and expiryDate are required");
  }

  if (new Date(resulting.startDate) >= new Date(resulting.expiryDate)) {
    throw new ApiError(400, "expiryDate must be after startDate");
  }

  if (resulting.minOrderAmount !== undefined && Number(resulting.minOrderAmount) < 0) {
    throw new ApiError(400, "minOrderAmount cannot be negative");
  }

  if (resulting.usageLimit !== null && resulting.usageLimit !== undefined && Number(resulting.usageLimit) < 1) {
    throw new ApiError(400, "usageLimit must be at least 1");
  }

  if (resulting.perUserLimit !== null && resulting.perUserLimit !== undefined && Number(resulting.perUserLimit) < 1) {
    throw new ApiError(400, "perUserLimit must be at least 1");
  }
};

// ==================== ADMIN ====================

// @desc    Create a coupon
// @route   POST /api/coupons
// @access  Private/Admin
const createCoupon = asyncHandler(async (req, res) => {
  const data = pickEditableFields(req.body);
  validateResultingCoupon(data);

  data.code = String(data.code).trim().toUpperCase();

  const existing = await Coupon.findOne({ code: data.code });
  if (existing) {
    throw new ApiError(400, "A coupon with this code already exists");
  }

  const coupon = await Coupon.create(data);

  res.status(201).json({ success: true, data: coupon });
});

// @desc    List all coupons
// @route   GET /api/coupons
// @access  Private/Admin
const getCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort("-createdAt");
  res.status(200).json({ success: true, data: coupons });
});

// @desc    Get a single coupon
// @route   GET /api/coupons/:id
// @access  Private/Admin
const getCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw new ApiError(404, "Coupon not found");
  res.status(200).json({ success: true, data: coupon });
});

// @desc    Update a coupon
// @route   PUT /api/coupons/:id
// @access  Private/Admin
const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw new ApiError(404, "Coupon not found");

  const data = pickEditableFields(req.body);

  const resulting = { ...coupon.toObject(), ...data };
  validateResultingCoupon(resulting);

  if (data.code) {
    const newCode = String(data.code).trim().toUpperCase();
    const existing = await Coupon.findOne({
      code: newCode,
      _id: { $ne: coupon._id },
    });
    if (existing) {
      throw new ApiError(400, "A coupon with this code already exists");
    }
    data.code = newCode;
  }

  Object.assign(coupon, data);
  await coupon.save();

  res.status(200).json({ success: true, data: coupon });
});

// @desc    Activate/deactivate a coupon
// @route   PATCH /api/coupons/:id/toggle
// @access  Private/Admin
const toggleCouponActive = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw new ApiError(404, "Coupon not found");

  coupon.isActive = !coupon.isActive;
  await coupon.save();

  res.status(200).json({ success: true, data: coupon });
});

// @desc    Delete a coupon
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw new ApiError(404, "Coupon not found");

  await coupon.deleteOne();

  res.status(200).json({ success: true, data: {} });
});

// ==================== CUSTOMER / SHARED ====================

/**
 * The single source of truth for "is this coupon usable, and by how much
 * does it discount this order". Used both by the checkout preview
 * (validateCoupon) and by createOrder at the moment the order is actually
 * placed - the frontend's calculated discount is never trusted directly.
 *
 * @param {string} code
 * @param {number} subtotal - authoritative, server-computed order subtotal
 * @param {string} userId
 * @param {import('mongoose').ClientSession} [session]
 */
const calculateCouponForOrder = async (code, subtotal, userId, session = null) => {
  if (!code) return null;

  const couponQuery = Coupon.findOne({ code: String(code).trim().toUpperCase() });
  const coupon = await (session ? couponQuery.session(session) : couponQuery);

  if (!coupon) {
    throw new ApiError(404, "Coupon not found");
  }

  if (!coupon.isActive) {
    throw new ApiError(400, "This coupon is no longer active");
  }

  const now = new Date();

  if (now < coupon.startDate) {
    throw new ApiError(400, "This coupon is not active yet");
  }

  if (now > coupon.expiryDate) {
    throw new ApiError(400, "This coupon has expired");
  }

  if (subtotal < coupon.minOrderAmount) {
    throw new ApiError(
      400,
      `This coupon requires a minimum order of $${coupon.minOrderAmount.toFixed(2)}`,
    );
  }

  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw new ApiError(400, "This coupon has reached its usage limit");
  }

  if (userId && coupon.perUserLimit != null) {
    const usageQuery = Order.countDocuments({
      user: userId,
      "coupon.code": coupon.code,
      status: { $ne: "cancelled" },
    });

    const userUsageCount = await (session ? usageQuery.session(session) : usageQuery);

    if (userUsageCount >= coupon.perUserLimit) {
      throw new ApiError(
        400,
        "You have already used this coupon the maximum number of times",
      );
    }
  }

  let discountAmount =
    coupon.discountType === "percentage"
      ? (subtotal * coupon.discountValue) / 100
      : coupon.discountValue;

  if (coupon.maxDiscount != null) {
    discountAmount = Math.min(discountAmount, coupon.maxDiscount);
  }

  // A coupon can never make an order total negative.
  discountAmount = Math.min(discountAmount, subtotal);
  discountAmount = Math.round(discountAmount * 100) / 100;

  return { coupon, discountAmount };
};

// @desc    Validate a coupon code against the current cart total (checkout preview)
// @route   POST /api/coupons/validate
// @access  Private/Customer
const validateCoupon = asyncHandler(async (req, res) => {
  const { code, cartTotal } = req.body;

  if (!code) {
    throw new ApiError(400, "code is required");
  }

  const subtotal = Number(cartTotal);
  if (Number.isNaN(subtotal) || subtotal < 0) {
    throw new ApiError(400, "A valid cartTotal is required");
  }

  const result = await calculateCouponForOrder(code, subtotal, req.user._id);

  res.status(200).json({
    success: true,
    data: {
      code: result.coupon.code,
      discountType: result.coupon.discountType,
      discountValue: result.coupon.discountValue,
      discountAmount: result.discountAmount,
      newTotal: Math.round((subtotal - result.discountAmount) * 100) / 100,
    },
  });
});

module.exports = {
  createCoupon,
  getCoupons,
  getCoupon,
  updateCoupon,
  toggleCouponActive,
  deleteCoupon,
  validateCoupon,
  calculateCouponForOrder,
};
