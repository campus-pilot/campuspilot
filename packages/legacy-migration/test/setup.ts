process.env.NODE_ENV = 'test';
process.env.SYSTEM_ADMIN_EMAIL = 'admin@synthetic.test';
process.env.BETTER_AUTH_SECRET =
  'synthetic-secret-that-is-at-least-32-characters';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000';
process.env.GOOGLE_CLIENT_ID = 'synthetic-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'synthetic-client-secret';
process.env.PUBLIC_APP_URL = 'http://127.0.0.1:3001';
process.env.CORS_ORIGIN = 'http://127.0.0.1:3001';
process.env.DATABASE_URL =
  'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic';
process.env.S3_BUCKET = 'synthetic';
process.env.S3_REGION = 'us-east-1';
process.env.GOTENBERG_URL = 'http://127.0.0.1:3004';
process.env.OPA_URL = 'http://127.0.0.1:8181';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.RESTATE_ADMIN_URL = 'http://127.0.0.1:9070';
process.env.RESTATE_FABRIC_URL = 'http://127.0.0.1:5122';
process.env.RESTATE_INGRESS_URL = 'http://127.0.0.1:8080';
