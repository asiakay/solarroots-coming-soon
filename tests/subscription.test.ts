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
  private selectResult: SubscriptionRecord | null;

  constructor(initialSelectResult: SubscriptionRecord | null = null) {
    this.selectResult = initialSelectResult;
  }

  prepare(query: string): D1PreparedStatement {
    return new MockPreparedStatement(this, query);
  }

  setSelectResult(record: SubscriptionRecord | null): void {
    this.selectResult = record;
  }

  handleFirst<T>(query: string, bindings: unknown[]): Promise<T | null> {
    this.operations.push({ query, bindings, kind: 'first' });

    if (query.trim().toUpperCase().startsWith('SELECT')) {
      return Promise.resolve(this.selectResult as T | null);
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
      this.insertedRow = bindings;
      return Promise.resolve({} as T);
    }

    if (normalizedQuery.startsWith('UPDATE')) {
      this.updatedRow = bindings;
      return Promise.resolve({} as T);
    }

    throw new Error(`Unexpected run() query: ${query}`);
  }
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

    expect(db.operations.length).toBe(3);
    expect(db.operations[0].query.startsWith('CREATE TABLE')).toBe(true);
    expect(db.operations[1].query.startsWith('SELECT')).toBe(true);
    expect(db.operations[2].query.startsWith('INSERT')).toBe(true);

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

    expect(db.operations.length).toBe(2);
    expect(db.operations[0].query.startsWith('CREATE TABLE')).toBe(true);
    expect(db.operations[1].query.startsWith('SELECT')).toBe(true);
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

    expect(db.operations.length).toBe(3);
    expect(db.operations[0].query.startsWith('CREATE TABLE')).toBe(true);
    expect(db.operations[1].query.startsWith('SELECT')).toBe(true);
    expect(db.operations[2].query.startsWith('UPDATE')).toBe(true);

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

    expect(db.operations.length).toBe(2);
    expect(db.operations[0].query.startsWith('CREATE TABLE')).toBe(true);
    expect(db.operations[1].query.startsWith('SELECT')).toBe(true);
    expect(db.updatedRow).toBeNull();
  });
});
