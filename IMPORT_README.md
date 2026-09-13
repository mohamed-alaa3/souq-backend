# Souq bulk product import

This project includes `importProducts.js` and `import-data/`.

## Run

1. Put your real `.env` back in the project root (do NOT commit it).
2. Make sure MongoDB and Cloudinary credentials are correct.
3. Make sure a seller exists:
   `node createSeller.js`
4. Install dependencies:
   `npm install`
5. Import all products:
   `npm run import-products`

The importer:
- imports all 42 products from `import-data/products.json`
- uploads their organized images to Cloudinary
- creates the Women's category automatically for the 7 women's products
- uses the first existing seller unless `SELLER_ID` is set
- updates a matching product on re-run instead of creating a duplicate
- does not delete existing products

Note: the stock values in the source data are marked as estimated.
