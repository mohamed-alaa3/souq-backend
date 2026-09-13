const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("./cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "souq/products",
    upload_preset: "ml_default",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

module.exports = storage;
