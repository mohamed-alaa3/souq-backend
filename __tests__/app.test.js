process.env.JWT_SECRET = 'test_secret_key';

const request = require('supertest');
const express = require('express');
const notFound = require('../middlewares/notFound');
const errorHandler = require('../middlewares/errorHandler');
const protect = require('../middlewares/protect');
const authorize = require('../middlewares/authorize');
const ApiError = require('../utils/ApiError');

// Minimal app wired the same way server.js does, so we exercise the REAL middlewares.
const buildApp = () => {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ success: true }));

  // route that throws a custom ApiError -> should be caught by errorHandler
  app.get('/api/boom', (req, res, next) => next(new ApiError(400, 'Bad input')));

  // route protected by our real `protect` middleware (needs a valid JWT)
  app.get('/api/private', protect, (req, res) => res.json({ success: true, user: req.user }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
};

test('GET /api/health returns 200', async () => {
  const res = await request(buildApp()).get('/api/health');
  expect(res.status).toBe(200);
});

test('unknown route hits notFound middleware -> 404 with success:false', async () => {
  const res = await request(buildApp()).get('/api/does-not-exist');
  expect(res.status).toBe(404);
  expect(res.body.success).toBe(false);
});

test('ApiError(400) is caught by global errorHandler with correct status/message', async () => {
  const res = await request(buildApp()).get('/api/boom');
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ success: false, message: 'Bad input' });
});

test('protect middleware rejects request with no token -> 401', async () => {
  const res = await request(buildApp()).get('/api/private');
  expect(res.status).toBe(401);
  expect(res.body.success).toBe(false);
});

test('protect middleware rejects an invalid token -> 401', async () => {
  const res = await request(buildApp())
    .get('/api/private')
    .set('Authorization', 'Bearer not-a-real-token');
  expect(res.status).toBe(401);
});

test('authorize middleware blocks role not in allowed list -> 403', () => {
  const req = { user: { role: 'customer' } };
  const res = { };
  let capturedErr;
  const next = (err) => { capturedErr = err; };
  authorize('admin')(req, res, next);
  expect(capturedErr).toBeInstanceOf(ApiError);
  expect(capturedErr.statusCode).toBe(403);
});

test('authorize middleware allows role in allowed list -> calls next() with no error', () => {
  const req = { user: { role: 'admin' } };
  const res = {};
  let called = false;
  const next = (err) => { called = err === undefined; };
  authorize('admin', 'seller')(req, res, next);
  expect(called).toBe(true);
});
