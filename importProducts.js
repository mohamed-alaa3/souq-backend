require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const cloudinary = require("./config/cloudinary");

const Product = require("./models/Product");
const Category = require("./models/Category");
const User = require("./models/User");

const DATA_FILE = path.join(__dirname, "import-data", "products.json");
const IMAGES_DIR = path.join(__dirname, "import-data", "organized-products");

const CATEGORY_MAP = {
  Men: "Men",
  Shoes: "Shoes",
  Accessories: "Accessories",
  "Uncategorized (Women's — no matching category provided)": "Women's",
};

async function ensureCategory(name) {
  let category = await Category.findOne({ name });
  if (!category) {
    category = await Category.create({
      name,
      description: `Products imported into the ${name} category.`,
    });
    console.log(`Created category: ${name}`);
  }
  return category;
}

async function uploadProductImages(product) {
  const folder = path.join(IMAGES_DIR, product.productId);

  if (!fs.existsSync(folder)) {
    throw new Error(`Image folder not found: ${folder}`);
  }

  const imagePaths = (product.images || []).map((relativePath) => {
    const filename = path.basename(relativePath);
    const fullPath = path.join(folder, filename);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Image not found for ${product.productId}: ${fullPath}`);
    }

    return { fullPath, filename };
  });

  const urls = [];

  for (const image of imagePaths) {
    const ext = path.extname(image.filename).toLowerCase();
    const publicId = path.basename(image.filename, ext);

    console.log(`  Uploading ${product.productId}/${image.filename}...`);

    const result = await cloudinary.uploader.upload(image.fullPath, {
      folder: `souq/products/imported/${product.productId}`,
      public_id: publicId,
      overwrite: true,
      resource_type: "image",
    });

    urls.push(result.secure_url);
  }

  return urls;
}

async function importProducts() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from .env");
  }

  if (!process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary environment variables are missing from .env");
  }

  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Missing ${DATA_FILE}`);
  }

  const products = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("products.json is empty or invalid");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected.");

  // Use the existing seller. You can force a specific seller with SELLER_ID.
  let seller;
  if (process.env.SELLER_ID) {
    seller = await User.findById(process.env.SELLER_ID);
  } else {
    seller = await User.findOne({ role: "seller" }).sort({ createdAt: 1 });
  }

  if (!seller) {
    throw new Error(
      "No seller account found. Run `node createSeller.js` first, or set SELLER_ID in .env."
    );
  }

  console.log(`Using seller: ${seller.name} (${seller._id})`);

  const categoryNames = [...new Set(products.map((p) => CATEGORY_MAP[p.category] || p.category))];
  const categories = new Map();

  for (const name of categoryNames) {
    categories.set(name, await ensureCategory(name));
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const product of products) {
    try {
      const categoryName = CATEGORY_MAP[product.category] || product.category;
      const category = categories.get(categoryName);

      if (!category) {
        throw new Error(`No category mapping for "${product.category}"`);
      }

      // Product.js does not have a sourceProductId field, so name + seller
      // is used as the idempotency key. Re-running the import will update
      // the same product instead of creating another copy.
      let existing = await Product.findOne({
        name: product.name,
        seller: seller._id,
      });

      // Reuse existing image URLs when the product is already imported.
      // This prevents unnecessary Cloudinary uploads on a normal re-run.
      let imageUrls = existing?.images?.length ? existing.images : null;

      if (!imageUrls) {
        imageUrls = await uploadProductImages(product);
      } else {
        console.log(`Skipping image upload for ${product.productId} (already has images).`);
      }

      const payload = {
        name: product.name,
        description: product.description,
        price: Number(product.price),
        discountPercentage: Number(product.discountPercentage || 0),
        stock: Number(product.stock || 0),
        images: imageUrls,
        category: category._id,
        seller: seller._id,
        isActive: true,
      };

      if (existing) {
        Object.assign(existing, payload);
        await existing.save();
        updated++;
        console.log(`UPDATED ${product.productId}: ${product.name}`);
      } else {
        await Product.create(payload);
        created++;
        console.log(`CREATED ${product.productId}: ${product.name}`);
      }
    } catch (error) {
      failed++;
      console.error(`FAILED ${product.productId}: ${error.message}`);
    }
  }

  console.log("\n===== IMPORT SUMMARY =====");
  console.log(`Total:   ${products.length}`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed:  ${failed}`);
  console.log("==========================");

  await mongoose.connection.close();

  if (failed > 0) {
    process.exitCode = 1;
  }
}

importProducts().catch(async (error) => {
  console.error("\nIMPORT ABORTED:", error.message);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exitCode = 1;
});
