import worker, { type Env } from '../src/index';
import { describe, expect, it } from 'bun:test';

class NoopStatement {
  bind(): NoopStatement {
    return this;
  }

  first(): Promise<null> {
    return Promise.resolve(null);
  }

  run(): Promise<null> {
    return Promise.resolve(null);
  }
}

class NoopDatabase {
  prepare(): NoopStatement {
    return new NoopStatement();
  }
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('admin login handler', () => {
  const db = new NoopDatabase();
  const ctx: ExecutionContext = {
    waitUntil(promise) {
      promise.catch(() => {
        // swallow errors for tests
      });
    },
    passThroughOnException() {
      // noop
    },
  };

  it('rejects when admin credentials are not configured', async () => {
    const request = new Request('https://example.com/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'secret' }),
    });

    const env: Env = { DB: db };
    const response = await worker.fetch(request, env, ctx);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Admin access is not configured.');
  });

  it('rejects incorrect credentials', async () => {
    const request = new Request('https://example.com/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'wrong' }),
    });

    const env: Env = { DB: db, ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'secret' };
    const response = await worker.fetch(request, env, ctx);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Incorrect admin credentials.');
  });

  it('logs in successfully with the correct plain password', async () => {
    const request = new Request('https://example.com/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'secret' }),
    });

    const env: Env = { DB: db, ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'secret' };
    const response = await worker.fetch(request, env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Admin login successful.');
  });

  it('logs in successfully with the correct hashed password', async () => {
    const passwordHash = await sha256Hex('hashed-secret');
    const request = new Request('https://example.com/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'hashed-secret' }),
    });

    const env: Env = {
      DB: db,
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD_HASH: passwordHash,
    };

    const response = await worker.fetch(request, env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Admin login successful.');
  });
});
