const ApiError = require('../utils/ApiError');
const logSecurityEvent = require('../utils/securityLogger');

// Usage: authorize('admin'), authorize('admin', 'seller')
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Not authorized, no user on request'));
    }
    if (!roles.includes(req.user.role)) {
      logSecurityEvent('FORBIDDEN_ACCESS', {
        userId: req.user._id?.toString(),
        role: req.user.role,
        requiredRoles: roles,
        path: req.originalUrl,
        method: req.method,
      });
      return next(
        new ApiError(403, `Role '${req.user.role}' is not allowed to access this resource`)
      );
    }
    next();
  };
};

module.exports = authorize;
