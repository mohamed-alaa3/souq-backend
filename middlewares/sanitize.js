// Strips MongoDB operator injection ($gt, $ne, $where, $regex, etc.) and
// dotted-path injection out of user-controlled input before it ever reaches
// a Mongoose query or a Model.create()/set() call.
//
// IMPORTANT (Express 5): req.query is a getter-only property in Express 5,
// so it cannot be reassigned (`req.query = {}` throws / is silently
// ignored). Every object here is therefore sanitized *in place* by
// deleting/rewriting its own keys rather than replacing the object.

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === '[object Object]';

// Recursively removes any key that starts with '$' (Mongo operator) or
// contains a '.' (dotted-path injection), for both objects and arrays.
const sanitizeInPlace = (value) => {
  if (Array.isArray(value)) {
    value.forEach((item) => sanitizeInPlace(item));
    return value;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  Object.keys(value).forEach((key) => {
    if (key.startsWith('$') || key.includes('.')) {
      delete value[key];
      return;
    }

    sanitizeInPlace(value[key]);
  });

  return value;
};

// Applied globally, before any route handler. Covers body, query and
// params - the three sources of user-controlled input that ever reach a
// database query in this API.
const sanitizeRequest = (req, res, next) => {
  if (req.body) sanitizeInPlace(req.body);
  if (req.query) sanitizeInPlace(req.query);
  if (req.params) sanitizeInPlace(req.params);
  next();
};

module.exports = sanitizeRequest;
module.exports.sanitizeInPlace = sanitizeInPlace;
