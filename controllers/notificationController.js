const Notification = require("../models/Notification");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// @desc    Get the current user's notifications (paginated, newest first)
// @route   GET /api/notifications?page=1&limit=10
// @access  Private
const getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const skip = (pageNum - 1) * limitNum;

  // The user is always taken from the authenticated request - there is no
  // way to pass another user's id in, so cross-user access isn't possible.
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find({ user: req.user._id })
      .sort("-createdAt")
      .skip(skip)
      .limit(limitNum),
    Notification.countDocuments({ user: req.user._id }),
    Notification.countDocuments({ user: req.user._id, isRead: false }),
  ]);

  res.status(200).json({
    success: true,
    data: notifications,
    unreadCount,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// @desc    Get the current user's unread notification count
// @route   GET /api/notifications/unread-count
// @access  Private
const getUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await Notification.countDocuments({
    user: req.user._id,
    isRead: false,
  });

  res.status(200).json({ success: true, data: { unreadCount } });
});

// @desc    Mark a single notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private/Owner
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    throw new ApiError(404, "Notification not found");
  }

  if (notification.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You are not allowed to access this notification");
  }

  if (!notification.isRead) {
    notification.isRead = true;
    await notification.save();
  }

  res.status(200).json({ success: true, data: notification });
});

// @desc    Mark all of the current user's notifications as read
// @route   PATCH /api/notifications/read-all
// @access  Private
const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { user: req.user._id, isRead: false },
    { $set: { isRead: true } },
  );

  res.status(200).json({ success: true, data: {} });
});

// @desc    Delete a notification
// @route   DELETE /api/notifications/:id
// @access  Private/Owner
const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    throw new ApiError(404, "Notification not found");
  }

  if (notification.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You are not allowed to access this notification");
  }

  await notification.deleteOne();

  res.status(200).json({ success: true, data: {} });
});

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
