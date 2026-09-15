process.env.JWT_SECRET = 'test_secret_key';

const jwt = require('jsonwebtoken');

// =========================================================
// NOSQL INJECTION - sanitize middleware
// =========================================================
describe('sanitize middleware (NoSQL / operator injection)', () => {
  const sanitizeRequest = require('../middlewares/sanitize');

  const runMiddleware = (req) => {
    const next = jest.fn();
    sanitizeRequest(req, {}, next);
    return next;
  };

  test('strips top-level MongoDB operator keys from req.query', () => {
    const req = { query: { category: { $ne: null } }, body: {}, params: {} };
    const next = runMiddleware(req);

    expect(req.query.category).toEqual({});
    expect(next).toHaveBeenCalledWith();
  });

  test('strips nested operator keys from req.body', () => {
    const req = {
      body: { email: 'a@a.com', password: { $gt: '' } },
      query: {},
      params: {},
    };
    runMiddleware(req);

    expect(req.body.password).toEqual({});
    expect(req.body.email).toBe('a@a.com');
  });

  test('strips $where and $regex anywhere in a nested object', () => {
    const req = {
      body: { filter: { name: { $regex: '.*' }, $where: 'malicious()' } },
      query: {},
      params: {},
    };
    runMiddleware(req);

    expect(req.body.filter.$where).toBeUndefined();
    expect(req.body.filter.name).toEqual({});
  });

  test('strips dotted-path keys (a different Mongo injection vector)', () => {
    const req = {
      body: { 'user.role': 'admin' },
      query: {},
      params: {},
    };
    runMiddleware(req);

    expect(req.body['user.role']).toBeUndefined();
  });

  test('sanitizes arrays of objects in place', () => {
    const req = {
      body: { items: [{ price: { $gt: 0 } }, { price: 10 }] },
      query: {},
      params: {},
    };
    runMiddleware(req);

    expect(req.body.items[0].price).toEqual({});
    expect(req.body.items[1].price).toBe(10);
  });

  test('leaves legitimate values untouched', () => {
    const req = {
      body: { name: 'Shirt', price: 20 },
      query: { category: 'cat1', page: '2' },
      params: { id: 'abc123' },
    };
    runMiddleware(req);

    expect(req.body).toEqual({ name: 'Shirt', price: 20 });
    expect(req.query).toEqual({ category: 'cat1', page: '2' });
    expect(req.params).toEqual({ id: 'abc123' });
  });
});

// =========================================================
// PRODUCT QUERY / MUTATION VALIDATION
// =========================================================
describe('productController input validation', () => {
  jest.mock('../models/Product');
  const Product = require('../models/Product');
  const { getProducts, createProduct } = require('../controllers/productController');

  const buildRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getProducts rejects a non-string category (operator-injection survivor)', async () => {
    const req = { query: { category: { $ne: null } } };
    const res = buildRes();
    const next = jest.fn();

    await getProducts(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(Product.find).not.toHaveBeenCalled();
  });

  test('createProduct rejects a negative price', async () => {
    const req = {
      user: { _id: 'seller1', role: 'seller' },
      body: {
        name: 'Shirt',
        description: 'Nice shirt',
        price: -10,
        category: '507f1f77bcf86cd799439011',
      },
      files: [],
    };
    const res = buildRes();
    const next = jest.fn();

    await createProduct(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(Product.create).not.toHaveBeenCalled();
  });

  test('createProduct rejects a malformed category id', async () => {
    const req = {
      user: { _id: 'seller1', role: 'seller' },
      body: {
        name: 'Shirt',
        description: 'Nice shirt',
        price: 10,
        category: 'not-a-valid-object-id',
      },
      files: [],
    };
    const res = buildRes();
    const next = jest.fn();

    await createProduct(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(Product.create).not.toHaveBeenCalled();
  });

  test('createProduct rejects a discountPercentage over 100', async () => {
    const req = {
      user: { _id: 'seller1', role: 'seller' },
      body: {
        name: 'Shirt',
        description: 'Nice shirt',
        price: 10,
        discountPercentage: 150,
        category: '507f1f77bcf86cd799439011',
      },
      files: [],
    };
    const res = buildRes();
    const next = jest.fn();

    await createProduct(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(Product.create).not.toHaveBeenCalled();
  });
});

// =========================================================
// PRIVILEGE ESCALATION - user role management
// =========================================================
// Role-change privilege-escalation and auth-provider-safety tests for
// updateUserRole now live in __tests__/userRoleUpdate.test.js, alongside
// the rest of that endpoint's regression coverage (see the fix for the
// validateAuthProvider bug: PATCH /api/users/:id/role used to fail for
// every user because it loaded a document without its `select: false`
// password/googleId fields and then called .save()).

// =========================================================
// JWT HARDENING
// =========================================================
describe('protect middleware - JWT handling', () => {
  jest.mock('../models/User');
  const User = require('../models/User');
  const protect = require('../middlewares/protect');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects a request with no Authorization header', async () => {
    const req = { headers: {} };
    const next = jest.fn();

    await protect(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('rejects a malformed/invalid JWT', async () => {
    const req = { headers: { authorization: 'Bearer not-a-real-token' } };
    const next = jest.fn();

    await protect(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('rejects an expired JWT', async () => {
    const expiredToken = jwt.sign(
      { id: 'user1' },
      process.env.JWT_SECRET,
      { expiresIn: -10 },
    );
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const next = jest.fn();

    await protect(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('rejects a token signed with the wrong secret', async () => {
    const forgedToken = jwt.sign({ id: 'user1', role: 'admin' }, 'wrong-secret');
    const req = { headers: { authorization: `Bearer ${forgedToken}` } };
    const next = jest.fn();

    await protect(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('rejects a valid signature for a user that no longer exists', async () => {
    User.findById.mockResolvedValue(null);
    const token = jwt.sign({ id: 'ghost-user' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();

    await protect(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('accepts a valid token for an existing user and attaches req.user', async () => {
    const dbUser = { _id: 'user1', role: 'customer' };
    User.findById.mockResolvedValue(dbUser);
    const token = jwt.sign({ id: 'user1' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();

    await protect(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBe(dbUser);
  });
});

// =========================================================
// ROLE-BASED ACCESS CONTROL
// =========================================================
describe('authorize middleware', () => {
  const authorize = require('../middlewares/authorize');

  test('blocks a customer from an admin-only route', () => {
    const req = {
      user: { _id: 'user1', role: 'customer' },
      originalUrl: '/api/users',
      method: 'GET',
    };
    const next = jest.fn();

    authorize('admin')(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  test('blocks a seller from an admin-only route', () => {
    const req = { user: { _id: 'seller1', role: 'seller' } };
    const next = jest.fn();

    authorize('admin')(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  test('allows an admin through an admin-only route', () => {
    const req = { user: { _id: 'admin1', role: 'admin' } };
    const next = jest.fn();

    authorize('admin')(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});

// =========================================================
// FILE UPLOAD VALIDATION
// =========================================================
describe('upload middleware fileFilter', () => {
  // multer-storage-cloudinary talks to Cloudinary at construction time via
  // config/cloudinary, so both are mocked purely to make the module
  // requireable in a unit test with no network/credentials.
  jest.mock('multer-storage-cloudinary', () => ({
    CloudinaryStorage: jest.fn().mockImplementation(() => ({})),
  }));
  jest.mock('../config/cloudinary', () => ({}));

  test('rejects a disguised executable (wrong mimetype)', () => {
    // eslint-disable-next-line global-require
    const upload = require('../middlewares/upload');
    const cb = jest.fn();

    upload.fileFilter({}, { mimetype: 'application/x-msdownload' }, cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  test('rejects SVG uploads (inline-script XSS vector)', () => {
    // eslint-disable-next-line global-require
    const upload = require('../middlewares/upload');
    const cb = jest.fn();

    upload.fileFilter({}, { mimetype: 'image/svg+xml' }, cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  test('accepts a legitimate JPEG', () => {
    // eslint-disable-next-line global-require
    const upload = require('../middlewares/upload');
    const cb = jest.fn();

    upload.fileFilter({}, { mimetype: 'image/jpeg' }, cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });
});
