const mongoose = require("mongoose");
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

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new ApiError(400, "Invalid user id");
  }

  // Only ever load the field needed to decide whether this change is
  // allowed - password/googleId (both `select: false`) are never fetched
  // here, so they can't leak and never need to be touched.
  const existingUser = await User.findById(req.params.id).select("role");

  if (!existingUser) {
    throw new ApiError(404, "User not found");
  }

  // Admin accounts cannot be changed from the Users page.
  if (existingUser.role === "admin") {
    throw new ApiError(403, "Admin role cannot be changed");
  }

  // Update ONLY the role field directly against the database instead of
  // loading a full document and calling .save(). A `.save()` on a document
  // fetched without its `select: false` auth fields (password, googleId)
  // re-runs the schema's full validateAuthProvider check with those fields
  // appearing empty (they were never loaded, not because they're actually
  // missing), incorrectly failing the save for every user regardless of
  // provider. findByIdAndUpdate's document middleware for `validate` is
  // document-only by default, so it is never triggered by this call -
  // password/googleId are left completely untouched in the database, and
  // `runValidators` still enforces the `role` enum on the one field being
  // written.
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { role } },
    { new: true, runValidators: true, context: "query" },
  ).select("name email role");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

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
