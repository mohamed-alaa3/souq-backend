require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const connectDB = require("./config/db");
const logger = require("./middlewares/logger");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");
const sanitizeRequest = require("./middlewares/sanitize");
const { generalLimiter } = require("./middlewares/rateLimiters");

const authRoutes = require("./routes/authRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const userRoutes = require("./routes/userRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const couponRoutes = require("./routes/couponRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

// =========================================================
// CORS
// =========================================================
// CORS_ORIGINS is a comma-separated allowlist, e.g.
//   CORS_ORIGINS=https://souq.example.com,https://admin.souq.example.com
// If unset (e.g. local development against the Angular dev server), any
// origin is allowed so existing local workflows keep working unchanged.
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Requests with no Origin header (curl, server-to-server, mobile apps)
    // are always allowed - there is no browser-enforced origin to check.
    if (!origin) return callback(null, true);

    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

// =========================================================
// SECURITY / CORE MIDDLEWARE
// =========================================================
app.use(
  helmet({
    // This is a JSON API consumed by a separately-hosted Angular app, not
    // an HTML-serving app, so a CSP here would have no effect on (and must
    // not be confused with) the CSP the Angular app itself should set.
    contentSecurityPolicy: false,
    // Allows the Angular frontend (a different origin) to load
    // Cloudinary-hosted product images/resources referenced by this API.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(cors(corsOptions));
app.use(express.json());

// Strips MongoDB operator/dotted-path injection from body/query/params
// before anything else touches user input.
app.use(sanitizeRequest);

app.use(logger);

app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true, message: "Souq API is running" });
});

// General-purpose rate limit for all API traffic below. Kept generous so it
// never interferes with normal usage; per-endpoint stricter limiters are
// applied on top of this for sensitive routes (see routes/authRoutes.js,
// reviewRoutes.js, couponRoutes.js).
app.use("/api", generalLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

const start = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Souq API listening on port ${PORT}`);
    });

    process.on("SIGTERM", () => {
      console.log("SIGTERM received. Shutting down gracefully...");

      server.close(() => {
        console.log("Server closed.");
        process.exit(0);
      });
    });

    process.on("SIGINT", () => {
      console.log("SIGINT received. Shutting down gracefully...");

      server.close(() => {
        console.log("Server closed.");
        process.exit(0);
      });
    });
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

module.exports = app;