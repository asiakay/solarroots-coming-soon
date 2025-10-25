import worker, { type Env } from '../src/index';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

type OperationKind = 'first' | 'run';

interface OperationRecord {
  query: string;
  bindings: unknown[];
  kind: OperationKind;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<T>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface SubscriptionRecord {
  email: string;
  confirmed: number;
  confirmation_token?: string | null;
}

class MockPreparedStatement implements D1PreparedStatement {
  private bindings: unknown[] = [];

  constructor(private readonly db: MockD1Database, private readonly query: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.bindings = values;
    return this;
  }

  first<T = unknown>(): Promise<T | null> {
    return this.db.handleFirst<T>(this.query, this.bindings);
  }

  run<T = unknown>(): Promise<T> {
    return this.db.handleRun<T>(this.query, this.bindings);
  }
}

class MockD1Database implements D1Database {
  operations: OperationRecord[] = [];
  insertedRow: unknown[] | null = null;
  updatedRow: unknown[] | null = null;
  profileInsertedRow: unknown[] | null = null;
  alteredSubscriptionColumns: string[] = [];
  private subscriptionSelectResult: SubscriptionRecord | null;
  private profileSelectResult: { password_hash: string | null } | null = null;
  private passwordColumnExists = true;
  private subscriptionColumns: Record<string, boolean> = {
    email: true,
    created_at: true,
    updated_at: true,
    confirmed: true,
    confirmation_token: true,
    token_created_at: true,
  };

  constructor(initialSelectResult: SubscriptionRecord | null = null) {
    this.subscriptionSelectResult = initialSelectResult;
  }

  prepare(query: string): D1PreparedStatement {
    return new MockPreparedStatement(this, query);
  }

  setSelectResult(record: SubscriptionRecord | null): void {
    this.subscriptionSelectResult = record;
  }

  setProfileSelectResult(record: { password_hash: string | null } | null): void {
    this.profileSelectResult = record;
  }

  setPasswordColumnExists(value: boolean): void {
    this.passwordColumnExists = value;
  }

  setSubscriptionColumnExists(column: keyof MockD1Database['subscriptionColumns'], value: boolean): void {
    this.subscriptionColumns[column] = value;
  }

  handleFirst<T>(query: string, bindings: unknown[]): Promise<T | null> {
    this.operations.push({ query, bindings, kind: 'first' });

    const normalizedQuery = query.trim().toUpperCase();

    if (normalizedQuery.includes("PRAGMA_TABLE_INFO('PROFILES')")) {
      if (this.passwordColumnExists) {
        return Promise.resolve({ name: 'password_hash' } as unknown as T);
      }

      return Promise.resolve(null);
    }

    if (normalizedQuery.includes("PRAGMA_TABLE_INFO('SUBSCRIPTIONS')")) {
      const column = typeof bindings[0] === 'string' ? bindings[0] : '';
      if (column && this.subscriptionColumns[column as keyof typeof this.subscriptionColumns]) {
        return Promise.resolve({ name: column } as unknown as T);
      }

      return Promise.resolve(null);
    }

    if (normalizedQuery.includes('FROM SUBSCRIPTIONS')) {
      return Promise.resolve(this.subscriptionSelectResult as unknown as T | null);
    }

    if (normalizedQuery.includes('FROM PROFILES')) {
      return Promise.resolve(this.profileSelectResult as unknown as T | null);
    }

    throw new Error(`Unexpected first() query: ${query}`);
  }

  handleRun<T>(query: string, bindings: unknown[]): Promise<T> {
    this.operations.push({ query, bindings, kind: 'run' });
    const normalizedQuery = query.trim().toUpperCase();

    if (normalizedQuery.startsWith('CREATE TABLE')) {
      return Promise.resolve({} as T);
    }

    if (normalizedQuery.startsWith('INSERT')) {
      if (normalizedQuery.includes('INTO PROFILES')) {
        this.profileInsertedRow = bindings;
      } else {
        this.insertedRow = bindings;
      }
      return Promise.resolve({} as T);
    }

    if (normalizedQuery.startsWith('UPDATE')) {
      this.updatedRow = bindings;
      return Promise.resolve({} as T);
    }

    if (normalizedQuery.startsWith('ALTER TABLE')) {
      if (normalizedQuery.includes('PROFILES')) {
        if (!this.passwordColumnExists) {
          this.passwordColumnExists = true;
        }
        return Promise.resolve({} as T);
      }

      if (normalizedQuery.includes('SUBSCRIPTIONS')) {
        const match = query.match(/ADD COLUMN\s+([a-zA-Z_]+)/i);
        if (match) {
          const column = match[1] as keyof typeof this.subscriptionColumns;
          this.subscriptionColumns[column] = true;
          this.alteredSubscriptionColumns.push(column);
        }
        return Promise.resolve({} as T);
      }
    }

    throw new Error(`Unexpected run() query: ${query}`);
  }
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('subscribe handler', () => {
  const originalFetch = globalThis.fetch;
  const originalRandomUUID = crypto.randomUUID.bind(crypto);

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    (crypto as unknown as { randomUUID: () => string }).randomUUID = originalRandomUUID;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (crypto as unknown as { randomUUID: () => string }).randomUUID = originalRandomUUID;
  });

  it('rejects requests with an invalid JSON body', async () => {
    const db = new MockD1Database();

    const request = new Request('https://example.com/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['invalid']),
    });

    const waitUntilCalls: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
      waitUntil(promise) {
        waitUntilCalls.push(promise);
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Invalid JSON body.',
    });
    expect(db.operations.length).toBe(0);
    expect(waitUntilCalls.length).toBe(0);
  });

  it('creates a subscription and sends a confirmation email', async () => {
    const db = new MockD1Database(null);
    const fetchCalls: Array<[RequestInfo, RequestInit | undefined]> = [];
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      fetchCalls.push([input, init]);
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const token = 'test-token';
    (crypto as unknown as { randomUUID: () => string }).randomUUID = () => token;

    const request = new Request('https://landing.example/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Test@Example.com' }),
    });

    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
      waitUntil(promise) {
        waitUntilPromises.push(promise);
      },
    };

    const env: Env = {
      DB: db as unknown as D1Database,
      SITE_BASE_URL: 'https://solarroots.example.com',
    };

    const response = await worker.fetch(request, env, ctx);
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      success: true,
      message: 'Confirmation email sent. Please check your inbox.',
    });

    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('SELECT'))).toBe(true);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(true);
    expect(queries.some((query) => query.startsWith('ALTER TABLE SUBSCRIPTIONS'))).toBe(false);

    expect(db.insertedRow).not.toBeNull();
    if (db.insertedRow) {
      const [email, createdAt, confirmationToken, tokenCreatedAt] = db.insertedRow;
      expect(email).toBe('test@example.com');
      expect(typeof createdAt).toBe('string');
      expect(confirmationToken).toBe(token);
      expect(tokenCreatedAt).toBe(createdAt);
      expect(Number.isNaN(Date.parse(createdAt as string))).toBe(false);
    }

    expect(waitUntilPromises.length).toBe(1);
    await Promise.all(waitUntilPromises);

    expect(fetchCalls.length).toBe(1);
    const [url, init] = fetchCalls[0];
    expect(url).toBe('https://api.mailchannels.net/tx/v1/send');
    expect(init).toBeDefined();
    const requestBody = JSON.parse(String(init?.body ?? ''));
    expect(requestBody.personalizations[0].to[0].email).toBe('test@example.com');
    const confirmationLink = 'https://solarroots.example.com/confirm?token=test-token&email=test%40example.com';
    expect(requestBody.content[0].value).toContain(confirmationLink);
    expect(requestBody.content[1].value).toContain(confirmationLink);
  });

  it('adds missing subscription columns for legacy databases before querying', async () => {
    const db = new MockD1Database(null);
    db.setSubscriptionColumnExists('created_at', false);
    db.setSubscriptionColumnExists('updated_at', false);
    db.setSubscriptionColumnExists('confirmed', false);
    db.setSubscriptionColumnExists('confirmation_token', false);
    db.setSubscriptionColumnExists('token_created_at', false);

    const fetchCalls: Array<[RequestInfo, RequestInit | undefined]> = [];
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      fetchCalls.push([input, init]);
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const request = new Request('https://example.com/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'legacy@example.com' }),
    });

    const waitUntilCalls: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
      waitUntil(promise) {
        waitUntilCalls.push(promise);
      },
    };

    const env: Env = {
      DB: db as unknown as D1Database,
    };

    const response = await worker.fetch(request, env, ctx);
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      success: true,
      message: 'Confirmation email sent. Please check your inbox.',
    });

    expect(db.alteredSubscriptionColumns).toEqual(
      expect.arrayContaining(['created_at', 'updated_at', 'confirmed', 'confirmation_token', 'token_created_at'])
    );
    expect(db.alteredSubscriptionColumns).toHaveLength(5);
    expect(fetchCalls.length).toBe(1);
    expect(waitUntilCalls.length).toBe(1);
  });

  it('acknowledges already-confirmed subscriptions without sending email', async () => {
    const existing: SubscriptionRecord = {
      email: 'user@example.com',
      confirmed: 1,
      confirmation_token: 'existing-token',
    };
    const db = new MockD1Database(existing);

    const fetchCalls: Array<[RequestInfo, RequestInit | undefined]> = [];
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      fetchCalls.push([input, init]);
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const request = new Request('https://example.com/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });

    const waitUntilCalls: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
      waitUntil(promise) {
        waitUntilCalls.push(promise);
      },
    };

    const env: Env = {
      DB: db as unknown as D1Database,
    };

    const response = await worker.fetch(request, env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Email is already confirmed.',
    });

    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('SELECT'))).toBe(true);
    expect(db.insertedRow).toBeNull();
    expect(db.updatedRow).toBeNull();
    expect(fetchCalls.length).toBe(0);
    expect(waitUntilCalls.length).toBe(0);
  });
});

describe('confirmation handler', () => {
  it('confirms a subscription when the token matches', async () => {
    const existing: SubscriptionRecord = {
      email: 'user@example.com',
      confirmed: 0,
      confirmation_token: 'valid-token',
    };

    const db = new MockD1Database(existing);

    const request = new Request('https://landing.example/confirm?email=user@example.com&token=valid-token', {
      method: 'GET',
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('Your email has been confirmed');

    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('SELECT'))).toBe(true);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(true);

    expect(db.updatedRow).not.toBeNull();
    if (db.updatedRow) {
      const [updatedAt, email] = db.updatedRow;
      expect(typeof updatedAt).toBe('string');
      expect(Number.isNaN(Date.parse(updatedAt as string))).toBe(false);
      expect(email).toBe('user@example.com');
    }
  });

  it('rejects confirmation when the token is invalid', async () => {
    const existing: SubscriptionRecord = {
      email: 'user@example.com',
      confirmed: 0,
      confirmation_token: 'valid-token',
    };

    const db = new MockD1Database(existing);

    const request = new Request('https://landing.example/confirm?email=user@example.com&token=other-token', {
      method: 'GET',
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('confirmation link is no longer valid');

    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('SELECT'))).toBe(true);
    expect(db.updatedRow).toBeNull();
  });
});

describe('subscription check handler', () => {
  it('rejects requests with missing email', async () => {
    const db = new MockD1Database();

    const request = new Request('https://example.com/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Invalid request.' });
    expect(db.operations.length).toBe(0);
  });

  it('indicates when an email has not subscribed yet', async () => {
    const db = new MockD1Database(null);

    const request = new Request('https://example.com/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'NewUser@example.com' }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, exists: false, message: 'This email is available.' });

    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('SELECT'))).toBe(true);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(false);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);
    expect(queries.some((query) => query.startsWith('ALTER TABLE SUBSCRIPTIONS'))).toBe(false);
  });

  it('indicates when an email is already subscribed', async () => {
    const existing: SubscriptionRecord = {
      email: 'user@example.com',
      confirmed: 1,
      confirmation_token: null,
    };
    const db = new MockD1Database(existing);

    const request = new Request('https://example.com/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, exists: true, message: 'This email is already subscribed.' });

    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('SELECT'))).toBe(true);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(false);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);
    expect(queries.some((query) => query.startsWith('ALTER TABLE SUBSCRIPTIONS'))).toBe(false);
  });

  it('rejects non-POST methods', async () => {
    const db = new MockD1Database();

    const request = new Request('https://example.com/api/check', {
      method: 'GET',
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);

    expect(response.status).toBe(405);
    expect(await response.text()).toBe('Method Not Allowed');
    expect(response.headers.get('allow')).toBe('POST,OPTIONS');
    expect(db.operations.length).toBe(0);
  });
});

describe('profile handler', () => {
  it('rejects requests with an invalid JSON body', async () => {
    const db = new MockD1Database();

    const request = new Request('https://example.com/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['invalid']),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Invalid JSON body.' });
    expect(db.operations.length).toBe(0);
  });

  it('requires a valid email address', async () => {
    const db = new MockD1Database();

    const request = new Request('https://example.com/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', name: 'Ada Lovelace', bio: 'First programmer.' }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Invalid email address.' });
    expect(db.operations.length).toBe(0);
  });

  it('requires both name and bio fields', async () => {
    const db = new MockD1Database();

    const request = new Request('https://example.com/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', name: '', bio: '' }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'Name is required.' });
    expect(db.operations.length).toBe(0);
  });

  it('returns 404 when the email is not subscribed', async () => {
    const db = new MockD1Database(null);

    const request = new Request('https://example.com/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        name: 'Solar Fan',
        password: 'password123',
        bio: 'Loves sunshine.',
      }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Email not found in subscriptions.' });
    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );
    const selectStatements = queries.filter(
      (query) => query.startsWith('SELECT') && !query.toLowerCase().includes('pragma_table_info')
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(selectStatements).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(false);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);
  });

  it('requires a password when creating a new profile', async () => {
    const existing: SubscriptionRecord = {
      email: 'user@example.com',
      confirmed: 1,
      confirmation_token: null,
    };
    const db = new MockD1Database(existing);

    const request = new Request('https://example.com/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        name: 'Solar Fan',
        bio: 'Loves sunshine.',
      }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'Password is required to create a profile.' });
    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );
    const selectStatements = queries.filter(
      (query) => query.startsWith('SELECT') && !query.toLowerCase().includes('pragma_table_info')
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(selectStatements).toHaveLength(2);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(false);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);
  });

  it('creates or updates a profile for a subscribed user', async () => {
    const existing: SubscriptionRecord = {
      email: 'user@example.com',
      confirmed: 1,
      confirmation_token: null,
    };
    const db = new MockD1Database(existing);

    const request = new Request('https://example.com/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        name: '  Solar Fan  ',
        password: 'password123',
        bio: ' Harnessing sunlight. ',
      }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, message: 'Profile saved successfully.' });
    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );
    const selectStatements = queries.filter(
      (query) => query.startsWith('SELECT') && !query.toLowerCase().includes('pragma_table_info')
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(selectStatements).toHaveLength(2);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(true);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);

    expect(db.profileInsertedRow).not.toBeNull();
    if (db.profileInsertedRow) {
      const [email, name, bio, passwordHash, createdAt, updatedAt] = db.profileInsertedRow as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      expect(email).toBe('user@example.com');
      expect(name).toBe('Solar Fan');
      expect(bio).toBe('Harnessing sunlight.');
      expect(passwordHash).toHaveLength(64);
      expect(passwordHash).not.toBe('password123');
      expect(typeof createdAt).toBe('string');
      expect(typeof updatedAt).toBe('string');
    }
  });
});

describe('login handler', () => {
  it('returns 404 when no profile with a password exists', async () => {
    const db = new MockD1Database();
    db.setProfileSelectResult(null);

    const request = new Request('https://example.com/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: 'We could not find an account with a password for that email. Please create or update your profile first.',
    });
    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );
    const selectStatements = queries.filter(
      (query) => query.startsWith('SELECT') && !query.toLowerCase().includes('pragma_table_info')
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(selectStatements).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(false);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);
  });

  it('rejects incorrect passwords', async () => {
    const db = new MockD1Database();
    const passwordHash = await sha256Hex('password123');
    db.setProfileSelectResult({ password_hash: passwordHash });

    const request = new Request('https://example.com/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'otherpass' }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Incorrect password. Please try again.' });
    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );
    const selectStatements = queries.filter(
      (query) => query.startsWith('SELECT') && !query.toLowerCase().includes('pragma_table_info')
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(selectStatements).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(false);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);
  });

  it('logs in successfully with the correct credentials', async () => {
    const db = new MockD1Database();
    const passwordHash = await sha256Hex('password123');
    db.setProfileSelectResult({ password_hash: passwordHash });

    const request = new Request('https://example.com/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });

    const ctx: ExecutionContext = {
      waitUntil() {
        // no-op for tests
      },
    };

    const response = await worker.fetch(request, { DB: db } as Env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, message: 'Login successful.' });
    const queries = db.operations.map((operation) => operation.query);
    const createStatements = queries.filter((query) => query.startsWith('CREATE TABLE'));
    const subscriptionPragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('subscriptions')")
    );
    const profilePragmas = queries.filter((query) =>
      query.toLowerCase().includes("pragma_table_info('profiles')")
    );
    const selectStatements = queries.filter(
      (query) => query.startsWith('SELECT') && !query.toLowerCase().includes('pragma_table_info')
    );

    expect(createStatements).toHaveLength(2);
    expect(subscriptionPragmas).toHaveLength(5);
    expect(profilePragmas).toHaveLength(1);
    expect(selectStatements).toHaveLength(1);
    expect(queries.some((query) => query.startsWith('INSERT'))).toBe(false);
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);
  });
});
