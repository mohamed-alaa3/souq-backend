const mongoose = require("mongoose");

// Kept here (rather than scattered across controllers) so new notification
// types can be added in one place.
const NOTIFICATION_TYPES = [
  "order_created",
  "order_processing",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
  "product_review",
  "low_stock",
  "system",
];

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },

    relatedProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },

    // Not part of the original spec's field list, but required so a
    // review notification can deep-link to the *exact* review (a product
    // can have many reviews) - needed for seller/admin moderation.
    relatedReview: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review",
    },
  },
  { timestamps: true },
);

// Notification list is always "this user's notifications, newest first".
notificationSchema.index({ user: 1, createdAt: -1 });
// Powers the unread-count badge / read-all queries.
notificationSchema.index({ user: 1, isRead: 1 });

notificationSchema.statics.NOTIFICATION_TYPES = NOTIFICATION_TYPES;

module.exports = mongoose.model("Notification", notificationSchema);
