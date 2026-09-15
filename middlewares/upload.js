const multer = require("multer");
const storage = require("../config/cloudinaryStorage");
const ApiError = require("../utils/ApiError");

// Defense-in-depth on top of CloudinaryStorage's `allowed_formats`: reject
// anything that isn't actually an image content-type before it's even
// streamed to Cloudinary. Executables, SVGs (XSS via inline script/foreignObject),
// and any other non-image upload are rejected outright.
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(
      new ApiError(400, "Only JPG, PNG and WEBP image files are allowed"),
    );
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 5,
    fileSize: 5 * 1024 * 1024,
  },
});

// Exposed so it can be unit-tested directly without needing a real HTTP
// multipart request. Does not change how routes use `upload` (they only
// ever call upload.array(...), which is unaffected by this extra property).
upload.fileFilter = fileFilter;

module.exports = upload;
