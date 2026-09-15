process.env.JWT_SECRET = 'test_secret_key';
process.env.NODE_ENV = 'test';

// =========================================================
// PART 1 - ROOT CAUSE REGRESSION (real, unmocked schema)
// =========================================================
// This documents the actual bug mechanism directly against the real User
// schema (no DB connection needed - Mongoose validation is pure in-memory
// logic that runs before any write). It proves *why* the old
// `findById()` + mutate + `.save()` pattern broke for every user, and
// guards against the bug reappearing if someone reintroduces a `.save()`
// call on a partially-loaded document.
describe('User schema - validateAuthProvider (root cause)', () => {
  const User = require('../models/User');

  test('a local-account document loaded without its password field fails full validation', async () => {
    // Mirrors exactly what `User.findById(id)` returns by default: password
    // has `select: false`, so it is never populated on the in-memory
    // document, even though the account has a real password hash stored.
    const partiallyLoadedUser = new User({
      name: 'Jane Doe',
      email: 'jane@example.com',
      authProvider: 'local',
      role: 'customer',
      // password intentionally omitted - simulates the unselected field.
    });

    await expect(partiallyLoadedUser.validate()).rejects.toThrow(
      /Password is required/,
    );
  });

  test('a google-account document loaded without its googleId field fails full validation', async () => {
    const partiallyLoadedUser = new User({
      name: 'Jane Doe',
      email: 'jane@example.com',
      authProvider: 'google',
      role: 'customer',
      // googleId intentionally omitted - simulates the unselected field.
    });

    await expect(partiallyLoadedUser.validate()).rejects.toThrow(
      /Google ID is required for Google accounts/,
    );
  });

  test('the same local-account document validates fine once password is actually present', async () => {
    const fullyLoadedUser = new User({
      name: 'Jane Doe',
      email: 'jane@example.com',
      authProvider: 'local',
      role: 'customer',
      password: 'Sup3rSecret!',
    });

    await expect(fullyLoadedUser.validate()).resolves.toBeUndefined();
  });
});

// =========================================================
// PART 2 - CONTROLLER BEHAVIOUR (mocked model)
// =========================================================
// Consistent with the rest of this suite: the model is mocked so these
// tests exercise the controller's own logic/call-shape in isolation.
describe('updateUserRole controller', () => {
  jest.mock('../models/User');
  const User = require('../models/User');
  const { updateUserRole } = require('../controllers/userController');

  const VALID_ID = '507f1f77bcf86cd799439011';
  const ADMIN_ID = '507f1f77bcf86cd799439099';

  const buildRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  // A real Mongoose Query is both directly awaitable AND chainable
  // (`.select(...)` returns another awaitable). This mimics that shape
  // closely enough for the controller's two call patterns:
  //   User.findById(id).select("role")
  //   User.findByIdAndUpdate(id, update, opts).select("name email role")
  const queryResolving = (value) => {
    const promise = Promise.resolve(value);
    promise.select = jest.fn().mockReturnValue(Promise.resolve(value));
    return promise;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each([
    ['email/password user', 'local'],
    ['Google user', 'google'],
  ])('%s', (_label, authProvider) => {
    test.each([
      ['customer', 'seller'],
      ['seller', 'customer'],
    ])('changes role from %s to %s (200) without touching auth fields', async (fromRole, toRole) => {
      User.findById.mockReturnValue(queryResolving({ role: fromRole }));
      User.findByIdAndUpdate.mockReturnValue(
        queryResolving({
          _id: VALID_ID,
          name: 'Jane Doe',
          email: 'jane@example.com',
          role: toRole,
        }),
      );

      const req = { params: { id: VALID_ID }, body: { role: toRole } };
      const res = buildRes();
      const next = jest.fn();

      await updateUserRole(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            id: VALID_ID,
            name: 'Jane Doe',
            email: 'jane@example.com',
            role: toRole,
          }),
        }),
      );

      // The update sent to the DB touches ONLY the role field - password
      // and googleId (whatever the account's authProvider is) are never
      // part of the write, so they cannot be cleared or corrupted by a
      // role change, for either provider.
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        VALID_ID,
        { $set: { role: toRole } },
        expect.objectContaining({ new: true, runValidators: true }),
      );

      const updatePayload = User.findByIdAndUpdate.mock.calls[0][1];
      expect(updatePayload.$set).not.toHaveProperty('password');
      expect(updatePayload.$set).not.toHaveProperty('googleId');
      expect(updatePayload.$set).not.toHaveProperty('authProvider');
      expect(Object.keys(updatePayload.$set)).toEqual(['role']);

      // The existence/ownership check never loads password/googleId either.
      expect(User.findById).toHaveBeenCalledWith(VALID_ID);
      const preCheckQuery = User.findById.mock.results[0].value;
      expect(preCheckQuery.select).toHaveBeenCalledWith('role');

      // The response never includes password/googleId/authProvider.
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.data).not.toHaveProperty('password');
      expect(responseBody.data).not.toHaveProperty('googleId');
      expect(responseBody.data).not.toHaveProperty('authProvider');
    });
  });

  test('rejects an invalid role value (400) and never touches the database', async () => {
    const req = { params: { id: VALID_ID }, body: { role: 'admin' } };
    const res = buildRes();
    const next = jest.fn();

    await updateUserRole(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(User.findById).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects a malformed user id (400) and never touches the database', async () => {
    const req = { params: { id: 'not-a-valid-object-id' }, body: { role: 'seller' } };
    const res = buildRes();
    const next = jest.fn();

    await updateUserRole(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(User.findById).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('a well-formed but nonexistent user id is rejected (404)', async () => {
    User.findById.mockReturnValue(queryResolving(null));

    const req = { params: { id: VALID_ID }, body: { role: 'seller' } };
    const res = buildRes();
    const next = jest.fn();

    await updateUserRole(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects changing an existing admin account role (403) and never writes', async () => {
    User.findById.mockReturnValue(queryResolving({ role: 'admin' }));

    const req = { params: { id: ADMIN_ID }, body: { role: 'seller' } };
    const res = buildRes();
    const next = jest.fn();

    await updateUserRole(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('a concurrently-deleted target user surfaces as 404 from the update step too', async () => {
    User.findById.mockReturnValue(queryResolving({ role: 'customer' }));
    User.findByIdAndUpdate.mockReturnValue(queryResolving(null));

    const req = { params: { id: VALID_ID }, body: { role: 'seller' } };
    const res = buildRes();
    const next = jest.fn();

    await updateUserRole(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

// =========================================================
// PART 3 - END-TO-END RBAC (real routes/middleware, mocked model)
// =========================================================
// Confirms the endpoint is actually unreachable by non-admins and by
// unauthenticated requests, through the real Express pipeline (routing,
// protect, authorize, error handling) rather than unit-testing the
// middleware in isolation.
describe('PATCH /api/users/:id/role - authorization', () => {
  jest.mock('../models/User');

  const jwt = require('jsonwebtoken');
  const request = require('supertest');
  const express = require('express');
  const User = require('../models/User');
  const userRoutes = require('../routes/userRoutes');
  const notFound = require('../middlewares/notFound');
  const errorHandler = require('../middlewares/errorHandler');

  const VALID_ID = '507f1f77bcf86cd799439011';

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/users', userRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
  };

  const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects requests with no token (401)', async () => {
    const res = await request(buildApp())
      .patch(`/api/users/${VALID_ID}/role`)
      .send({ role: 'seller' });

    expect(res.status).toBe(401);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('rejects a customer attempting to change a role (403)', async () => {
    User.findById.mockResolvedValue({ _id: 'customer1', role: 'customer' });

    const res = await request(buildApp())
      .patch(`/api/users/${VALID_ID}/role`)
      .set('Authorization', `Bearer ${tokenFor('customer1')}`)
      .send({ role: 'seller' });

    expect(res.status).toBe(403);
  });

  test('rejects a seller attempting to change a role (403)', async () => {
    User.findById.mockResolvedValue({ _id: 'seller1', role: 'seller' });

    const res = await request(buildApp())
      .patch(`/api/users/${VALID_ID}/role`)
      .set('Authorization', `Bearer ${tokenFor('seller1')}`)
      .send({ role: 'seller' });

    expect(res.status).toBe(403);
  });

  test('an admin can reach the endpoint (RBAC allows it through to the controller)', async () => {
    // protect() looks up the caller (admin1); the controller separately
    // looks up the target user (VALID_ID) - respond appropriately for both.
    User.findById.mockImplementation((id) => {
      const value =
        id === 'admin1' ? { _id: 'admin1', role: 'admin' } : { role: 'customer' };
      const promise = Promise.resolve(value);
      promise.select = jest.fn().mockReturnValue(Promise.resolve(value));
      return promise;
    });
    User.findByIdAndUpdate.mockImplementation(() => {
      const value = {
        _id: VALID_ID,
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'seller',
      };
      const promise = Promise.resolve(value);
      promise.select = jest.fn().mockReturnValue(Promise.resolve(value));
      return promise;
    });

    const res = await request(buildApp())
      .patch(`/api/users/${VALID_ID}/role`)
      .set('Authorization', `Bearer ${tokenFor('admin1')}`)
      .send({ role: 'seller' });

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('password');
    expect(res.body.data).not.toHaveProperty('googleId');
  });
});
