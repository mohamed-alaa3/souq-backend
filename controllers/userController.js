const User = require("../models/User");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// @desc    Get all users
// @route   GET /api/users
// @access  Admin
const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({}).select("-password").sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: users.length,
    data: users,
  });
});

// @desc    Change user role
// @route   PATCH /api/users/:id/role
// @access  Admin
const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (!["customer", "seller"].includes(role)) {
    throw new ApiError(400, "Role must be either customer or seller");
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Admin accounts cannot be changed from the Users page.
  if (user.role === "admin") {
    throw new ApiError(403, "Admin role cannot be changed");
  }

  user.role = role;

  await user.save();

  res.status(200).json({
    success: true,
    message: `User role changed to ${role}`,
    data: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

module.exports = {
  getUsers,
  updateUserRole,
};
