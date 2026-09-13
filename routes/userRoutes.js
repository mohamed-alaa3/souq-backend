const express = require("express");

const { getUsers, updateUserRole } = require("../controllers/userController");

const protect = require("../middlewares/protect");
const authorize = require("../middlewares/authorize");

const router = express.Router();

// Admin only
router.use(protect, authorize("admin"));

router.get("/", getUsers);

router.patch("/:id/role", updateUserRole);

module.exports = router;
