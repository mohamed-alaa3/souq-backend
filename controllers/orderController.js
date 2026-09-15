const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const { getOrCreateCart } = require("./cartController");
const { calculateCouponForOrder } = require("./couponController");
const {
  createNotification,
  createNotifications,
} = require("../utils/notificationService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const logSecurityEvent = require("../utils/securityLogger");

// Get the selected variant from a product.
const getProductVariant = (product, variantId) => {
  if (!variantId) {
    return null;
  }

  return product.variants?.id(variantId) || null;
};

// @desc    Create an order from the current user's cart
// @route   POST /api/orders
// @access  Private
const createOrder = asyncHandler(async (req, res) => {
  const { shippingAddress, couponCode } = req.body;

  if (!shippingAddress) {
    throw new ApiError(400, "shippingAddress is required");
  }

  const cart = await getOrCreateCart(req.user._id);

  if (!cart.items || cart.items.length === 0) {
    throw new ApiError(400, "Your cart is empty");
  }

  const session = await mongoose.startSession();

  let order;
  const itemSellerIds = [];

  try {
    await session.withTransaction(async () => {
      const orderItems = [];
      let subtotal = 0;

      for (const cartItem of cart.items) {
        const product = await Product.findById(cartItem.product).session(
          session,
        );

        if (!product || !product.isActive) {
          throw new ApiError(
            404,
            "One of the products in your cart no longer exists",
          );
        }

        let selectedVariant = null;

        // Product has variants.
        if (product.variants && product.variants.length > 0) {
          if (!cartItem.variant) {
            throw new ApiError(
              400,
              `Please select a variant for "${product.name}"`,
            );
          }

          selectedVariant = getProductVariant(product, cartItem.variant);

          if (!selectedVariant) {
            throw new ApiError(
              400,
              `Selected variant for "${product.name}" no longer exists`,
            );
          }

          if (selectedVariant.stock < cartItem.quantity) {
            throw new ApiError(
              400,
              `Only ${selectedVariant.stock} unit(s) of "${product.name}" are in stock for the selected variant`,
            );
          }
        } else {
          // Old product without variants.
          if (product.stock < cartItem.quantity) {
            throw new ApiError(
              400,
              `Only ${product.stock} unit(s) of "${product.name}" are in stock`,
            );
          }
        }

        // Calculate the final price from the database.
        const finalPrice =
          product.price * (1 - product.discountPercentage / 100);

        const itemTotal = finalPrice * cartItem.quantity;

        const orderItem = {
          product: product._id,
          name: product.name,
          price: product.price,
          discountPercentage: product.discountPercentage,
          finalPrice,
          quantity: cartItem.quantity,
        };

        // Save a historical snapshot of the selected variant.
        if (selectedVariant) {
          orderItem.variant = {
            variantId: selectedVariant._id,
            size: selectedVariant.size,
            color: selectedVariant.color,
            sku: selectedVariant.sku,
          };
        }

        orderItems.push(orderItem);

        if (product.seller) {
          itemSellerIds.push(product.seller.toString());
        }

        subtotal += itemTotal;

        // Reduce stock from the selected variant.
        if (selectedVariant) {
          selectedVariant.stock -= cartItem.quantity;
        } else {
          // Backward-compatible product-level stock.
          product.stock -= cartItem.quantity;
        }

        await product.save({ session });
      }

      // Coupons are calculated using the authoritative
      // server-side subtotal.
      let couponResult = null;

      if (couponCode) {
        couponResult = await calculateCouponForOrder(
          couponCode,
          subtotal,
          req.user._id,
          session,
        );
      }

      const discountAmount = couponResult ? couponResult.discountAmount : 0;

      const totalPrice = Math.round((subtotal - discountAmount) * 100) / 100;

      const createdOrders = await Order.create(
        [
          {
            user: req.user._id,
            items: orderItems,
            subtotal,

            coupon: couponResult
              ? {
                  code: couponResult.coupon.code,
                  discountType: couponResult.coupon.discountType,
                  discountValue: couponResult.coupon.discountValue,
                  discountAmount,
                }
              : undefined,

            totalPrice,
            shippingAddress,
          },
        ],
        { session },
      );

      order = createdOrders[0];

      // Record coupon usage atomically.
      if (couponResult) {
        couponResult.coupon.usedCount += 1;

        await couponResult.coupon.save({
          session,
        });
      }

      // Clear cart after successful order creation.
      cart.items = [];

      await cart.save({ session });
    });
  } finally {
    await session.endSession();
  }

  // Notifications are best-effort: a failure here must never undo or fail
  // an order that was already successfully placed and paid for.
  try {
    logSecurityEvent("ORDER_CREATED", {
      orderId: order._id.toString(),
      userId: req.user._id.toString(),
      totalPrice: order.totalPrice,
    });

    // Notify the customer.
    await createNotification({
      user: req.user._id,
      type: "order_created",
      title: "Order placed successfully",
      message: "Your order has been placed successfully.",
      relatedOrder: order._id,
    });

    // Notify all sellers whose products are included in the order.
    const uniqueSellerIds = [...new Set(itemSellerIds)];

    await createNotifications(
      uniqueSellerIds.map((sellerId) => ({
        user: sellerId,
        type: "order_created",
        title: "New order received",
        message: "You have received a new order containing your product.",
        relatedOrder: order._id,
      })),
    );

    // Notify all admins about the new order.
    const admins = await User.find({ role: "admin" }).select("_id").lean();

    await createNotifications(
      admins.map((admin) => ({
        user: admin._id,
        type: "order_created",
        title: "New order placed",
        message: "A new customer order has been placed.",
        relatedOrder: order._id,
      })),
    );
  } catch (err) {
    console.error("Order notification error:", err);
  }

  res.status(201).json({
    success: true,
    data: order,
  });
});

// @desc    Get logged-in user's own orders
// @route   GET /api/orders/me
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({
    user: req.user._id,
  }).sort("-createdAt");

  res.status(200).json({
    success: true,
    data: orders,
  });
});

// @desc    Get orders that contain products owned by the logged-in seller
// @route   GET /api/orders/seller/me
// @access  Private/Seller
const getSellerOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find()
    .populate("user", "name email")
    .sort("-createdAt");

  const sellerId = req.user._id.toString();

  const sellerOrders = [];

  for (const order of orders) {
    const sellerItems = [];

    for (const item of order.items) {
      const product = await Product.findById(item.product)
        .select("seller")
        .lean();

      if (product && product.seller.toString() === sellerId) {
        const finalPrice =
          item.finalPrice !== undefined ? item.finalPrice : item.price;

        const discountPercentage =
          item.discountPercentage !== undefined ? item.discountPercentage : 0;

        sellerItems.push({
          product: item.product,
          name: item.name,
          price: item.price,
          discountPercentage,
          finalPrice,
          quantity: item.quantity,

          // Variant snapshot if this order item has one.
          variant: item.variant
            ? {
                variantId: item.variant.variantId,
                size: item.variant.size,
                color: item.variant.color,
                sku: item.variant.sku,
              }
            : undefined,
        });
      }
    }

    if (sellerItems.length === 0) {
      continue;
    }

    const sellerTotal = sellerItems.reduce(
      (sum, item) => sum + item.finalPrice * item.quantity,
      0,
    );

    sellerOrders.push({
      _id: order._id,
      user: order.user,
      items: sellerItems,
      totalPrice: sellerTotal,
      shippingAddress: order.shippingAddress,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  }

  res.status(200).json({
    success: true,
    data: sellerOrders,
  });
});

// @desc    Get a single order
// @route   GET /api/orders/:id
// @access  Private
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  const isOwner = order.user.toString() === req.user._id.toString();

  if (!isOwner && req.user.role !== "admin") {
    throw new ApiError(403, "You are not allowed to view this order");
  }

  res.status(200).json({
    success: true,
    data: order,
  });
});

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
const getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find()
    .populate("user", "name email")
    .sort("-createdAt");

  res.status(200).json({
    success: true,
    data: orders,
  });
});

// @desc    Update order status
// @route   PATCH /api/orders/:id/status
// @access  Private/Admin
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  const allowed = [
    "pending",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
  ];

  if (!allowed.includes(status)) {
    throw new ApiError(400, `status must be one of: ${allowed.join(", ")}`);
  }

  const session = await mongoose.startSession();

  let updatedOrder;
  let previousStatus;

  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session);

      if (!order) {
        throw new ApiError(404, "Order not found");
      }

      previousStatus = order.status;

      // Already cancelled.
      if (order.status === "cancelled" && status === "cancelled") {
        updatedOrder = order;
        return;
      }

      // Cancel order and restore stock.
      if (status === "cancelled" && order.status !== "cancelled") {
        for (const item of order.items) {
          const product = await Product.findById(item.product).session(session);

          if (!product) {
            continue;
          }

          // New order with variant.
          if (item.variant?.variantId) {
            const variant = product.variants?.id(item.variant.variantId);

            if (variant) {
              variant.stock += item.quantity;
            } else {
              // Variant was deleted after the order.
              // Do not incorrectly add variant stock
              // to product-level stock.
            }
          } else {
            // Old order / product without variants.
            product.stock += item.quantity;
          }

          await product.save({ session });
        }
      }

      order.status = status;

      await order.save({ session });

      updatedOrder = order;
    });
  } finally {
    await session.endSession();
  }

  // Notify the customer only when the status actually changed, to avoid
  // duplicate notifications for a no-op update.
  const STATUS_NOTIFICATIONS = {
    processing: {
      type: "order_processing",
      title: "Order is being processed",
      message: "Your order is now being processed.",
    },
    shipped: {
      type: "order_shipped",
      title: "Order shipped",
      message: "Your order has been shipped.",
    },
    delivered: {
      type: "order_delivered",
      title: "Order delivered",
      message: "Your order has been delivered.",
    },
    cancelled: {
      type: "order_cancelled",
      title: "Order cancelled",
      message: "Your order has been cancelled.",
    },
  };

  if (updatedOrder && previousStatus !== updatedOrder.status) {
    logSecurityEvent("ORDER_STATUS_CHANGED", {
      orderId: updatedOrder._id.toString(),
      previousStatus,
      newStatus: updatedOrder.status,
      changedBy: req.user._id.toString(),
    });

    const notif = STATUS_NOTIFICATIONS[updatedOrder.status];

    if (notif) {
      try {
        await createNotification({
          user: updatedOrder.user,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          relatedOrder: updatedOrder._id,
        });
      } catch (err) {
        // Notification delivery failing must not fail the status update.
      }
    }
  }

  res.status(200).json({
    success: true,
    data: updatedOrder,
  });
});

// @desc    Cancel an order
// @route   PATCH /api/orders/:id/cancel
// @access  Private
const cancelOrder = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();

  let cancelledOrder;

  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session);

      if (!order) {
        throw new ApiError(404, "Order not found");
      }

      const isCustomer = order.user.toString() === req.user._id.toString();

      const isSeller = req.user.role === "seller";

      // Customer can cancel only their own order.
      if (req.user.role === "customer" && !isCustomer) {
        throw new ApiError(403, "You are not allowed to cancel this order");
      }

      // Seller can cancel only if all products belong to them.
      if (isSeller) {
        for (const item of order.items) {
          const product = await Product.findById(item.product)
            .select("seller")
            .session(session);

          if (!product) {
            throw new ApiError(404, `Product "${item.name}" no longer exists`);
          }

          if (product.seller.toString() !== req.user._id.toString()) {
            throw new ApiError(403, "You are not allowed to cancel this order");
          }
        }
      }

      // Only pending orders can be cancelled.
      if (order.status !== "pending") {
        throw new ApiError(400, "Only pending orders can be cancelled");
      }

      // Return quantities to stock.
      for (const item of order.items) {
        const product = await Product.findById(item.product).session(session);

        if (!product) {
          continue;
        }

        // Order contains a variant snapshot.
        if (item.variant?.variantId) {
          const variant = product.variants?.id(item.variant.variantId);

          if (variant) {
            variant.stock += item.quantity;
          }
        } else {
          // Old order / product without variants.
          product.stock += item.quantity;
        }

        await product.save({ session });
      }

      order.status = "cancelled";

      await order.save({ session });

      cancelledOrder = order;
    });
  } finally {
    await session.endSession();
  }

  try {
    await createNotification({
      user: cancelledOrder.user,
      type: "order_cancelled",
      title: "Order cancelled",
      message: "Your order has been cancelled.",
      relatedOrder: cancelledOrder._id,
    });
  } catch (err) {
    // Notification delivery failing must not fail the cancellation.
  }

  res.status(200).json({
    success: true,
    message: "Order cancelled successfully",
    data: cancelledOrder,
  });
});

module.exports = {
  createOrder,
  getMyOrders,
  getOrder,
  getSellerOrders,
  getAllOrders,
  updateOrderStatus,
  cancelOrder,
};
