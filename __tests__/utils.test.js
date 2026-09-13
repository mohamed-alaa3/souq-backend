process.env.JWT_SECRET = 'test_secret_key';
process.env.JWT_EXPIRES_IN = '1h';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const generateToken = require('../utils/generateToken');

test('generateToken produces a verifiable JWT containing the user id', () => {
  const token = generateToken('abc123');
  expect(typeof token).toBe('string');
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  expect(decoded.id).toBe('abc123');
});

test('bcrypt hashes and verifies a password correctly', async () => {
  const plain = 'mySecret123';
  const hash = await bcrypt.hash(plain, 10);
  expect(hash).not.toBe(plain);
  const match = await bcrypt.compare(plain, hash);
  expect(match).toBe(true);
  const noMatch = await bcrypt.compare('wrongPassword', hash);
  expect(noMatch).toBe(false);
});
