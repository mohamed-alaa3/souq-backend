# Souq — Mini E-Commerce API

Backend graduation project (Idea 4: Souq) — a REST API for a small e-commerce
marketplace: sellers list products, customers cart and order them, stock is
authoritative on the server.

## Tech Stack

- Node.js + Express.js
- MongoDB + Mongoose
- JWT (jsonwebtoken) + bcryptjs
- dotenv
- Jest + Supertest (tests)

## Install & Run

```bash
npm install
cp .env.example .env   # then fill in MONGO_URI and JWT_SECRET
npm run dev             # nodemon, http://localhost:5000
# or
npm start
```

## Environment Variables

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` / `production` / `test` |
| `PORT` | API port (default 5000) |
| `MONGO_URI` | MongoDB connection string (Atlas or local) |
| `JWT_SECRET` | Secret used to sign JWTs |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d` |

No secrets are committed — only `.env.example` (variable names, no values) is in
the repo. `.env` is git-ignored.

## Testing

```bash
npm test
```

This sandbox's dev environment doesn't have a live MongoDB connection, so the
test suite covers everything that doesn't require one: bcrypt/JWT round-trips,
Express middleware (`protect`, `authorize`, 404, error handler) via Supertest,
and the order-creation pricing/stock logic (mocked DB layer) — proving the
server never trusts a client-sent price and correctly rejects insufficient
stock. **Run the full flow against a real database on your machine** using the
included Postman collection (`postman_collection.json`) once `MONGO_URI` is
set.

## Roles

- `customer` — browse, cart, place orders, view own orders
- `seller` — CRUD on their own products only
- `admin` — manage categories, view/update all orders

## API Endpoints

| Method | Route | Access |
|---|---|---|
| POST | /api/auth/register | Public |
| POST | /api/auth/login | Public |
| GET | /api/auth/me | Private |
| PATCH | /api/auth/me | Private |
| GET | /api/categories | Public |
| POST | /api/categories | Admin |
| PUT | /api/categories/:id | Admin |
| DELETE | /api/categories/:id | Admin |
| GET | /api/products?category=&search=&minPrice=&maxPrice=&sort=&page=&limit= | Public |
| GET | /api/products/:id | Public |
| POST | /api/products | Seller, Admin |
| PUT | /api/products/:id | Seller (owner), Admin |
| DELETE | /api/products/:id | Seller (owner), Admin |
| GET | /api/cart | Private |
| POST | /api/cart/items | Private |
| PUT | /api/cart/items/:itemId | Private |
| DELETE | /api/cart/items/:itemId | Private |
| DELETE | /api/cart | Private |
| POST | /api/orders | Private |
| GET | /api/orders/me | Private |
| GET | /api/orders/:id | Private (owner or admin) |
| GET | /api/orders | Admin |
| PATCH | /api/orders/:id/status | Admin |

## Authentication & Authorization Flow

1. Register/login returns a JWT: `{ user, token }`.
2. Client sends `Authorization: Bearer <token>` on protected routes.
3. `protect` middleware verifies the JWT and attaches `req.user`.
4. `authorize('role', ...)` middleware blocks disallowed roles with `403`.
5. Ownership checks (product update/delete) compare `product.seller` to
   `req.user._id` in the controller — an admin bypasses this check.

## The Main Challenge — Server-Authoritative Orders

`POST /api/orders` never trusts anything about price or totals from the
client:

1. Reads the user's **cart from the database**, not the request body.
2. Re-fetches each **live Product** and validates current stock.
3. Snapshots `name`/`price` from the DB into the order (so later price edits
   don't retroactively change historic orders).
4. Computes `totalPrice` on the server.
5. Decrements stock and empties the cart.

Steps 2–5 run inside a MongoDB transaction (`mongoose.startSession()`), so a
failure partway through (e.g. insufficient stock on item 3 of 5) rolls
everything back. **Note:** MongoDB transactions require a replica set —
MongoDB Atlas supports this out of the box; a bare standalone local `mongod`
does not.

## Assumptions Made

- Wishlist/Compare are out of scope for the backend brief; they're handled
  client-side in the Angular app (see frontend README).
- Self-registration only allows `customer` or `seller` roles; `admin` accounts
  must be created directly in the database or promoted by an existing admin.
- Order status transitions are not state-machine-restricted (any admin can set
  any status) — kept simple per "don't add unnecessary complexity."

## Remaining / Known Issues

- No live-database integration test was possible in the build sandbox (no
  network egress to MongoDB Atlas or a downloadable `mongod`). Run
  `postman_collection.json` against your own Atlas cluster before submission.
- No image upload (Multer) yet — `Product.images` currently accepts an array
  of URL strings.
