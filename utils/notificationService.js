const Notification = require("../models/Notification");

/**
 * Single place all controllers go through to create a notification, so the
 * shape stays consistent and callers don't duplicate Notification.create
 * calls. Failures here are the caller's responsibility to decide whether to
 * swallow (a notification failing should generally never fail the action
 * that triggered it - e.g. placing an order should still succeed even if a
 * notification couldn't be written).
 *
 * @param {Object} params
 * @param {string} params.user - recipient user id (never trust this from
 *   client input - callers must derive it from req.user or a looked-up
 *   owner/seller id, never from a request body/query value)
 * @param {string} params.type - one of Notification.NOTIFICATION_TYPES
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} [params.relatedOrder]
 * @param {string} [params.relatedProduct]
 * @param {string} [params.relatedReview]
 * @param {import('mongoose').ClientSession} [params.session]
 */
const createNotification = async ({
  user,
  type,
  title,
  message,
  relatedOrder,
  relatedProduct,
  relatedReview,
  session,
}) => {
  const [notification] = await Notification.create(
    [
      {
        user,
        type,
        title,
        message,
        relatedOrder,
        relatedProduct,
        relatedReview,
      },
    ],
    session ? { session } : undefined,
  );

  return notification;
};

/**
 * Creates several notifications (e.g. one per seller in a multi-seller
 * order, or one per admin) without letting one failure block the others.
 * Never throws - notification delivery is best-effort.
 */
const createNotifications = async (notifications) => {
  const results = await Promise.allSettled(
    notifications.map((n) => createNotification(n)),
  );

  return results;
};

module.exports = { createNotification, createNotifications };
