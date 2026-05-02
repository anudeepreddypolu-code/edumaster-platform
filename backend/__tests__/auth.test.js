// Jest + SuperTest: Auth API tests
const request = require('supertest');
const { app } = require('../server.cjs');

describe('Auth API', () => {
  it('should login and return a JWT', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@edumaster.local', password: 'Admin@123' });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('should reject invalid login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@edumaster.local', password: 'wrong' });
    expect(res.statusCode).toBe(401);
  });
});
