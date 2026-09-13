// Wraps an async route handler and forwards any rejected promise to next(err),
// so the global error handler always catches it.
const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
