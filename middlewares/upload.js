const multer = require("multer");
const storage = require("../config/cloudinaryStorage");

const upload = multer({
  storage,
  limits: {
    files: 5,
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = upload;
