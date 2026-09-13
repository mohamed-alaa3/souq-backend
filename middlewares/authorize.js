const ApiError = require('../utils/ApiError');

// Usage: authorize('admin'), authorize('admin', 'seller')
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Not authorized, no user on request'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new ApiError(403, `Role '${req.user.role}' is not allowed to access this resource`)
      );
    }
    next();
  };
};

module.exports = authorize;
