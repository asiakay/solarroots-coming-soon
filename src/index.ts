interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<T>;
}

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB: D1Database;
  ASSETS?: AssetFetcher;
  MAIL_FROM_EMAIL?: string;
  MAIL_FROM_NAME?: string;
  MAILCHANNELS_DOMAIN?: string;
  MAILCHANNELS_SUBDOMAIN?: string;
  SITE_BASE_URL?: string;
}

interface SubscriptionRecord {
  email: string;
  confirmed: number;
  confirmation_token?: string | null;
}

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
};

const HTML_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
};

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function getLogger(ctx: ExecutionContext): (...args: unknown[]) => void {
  if ('log' in ctx && typeof (ctx as { log?: (...args: unknown[]) => void }).log === 'function') {
    return (...args: unknown[]) => {
      (ctx as { log: (...args: unknown[]) => void }).log(...args);
    };
  }

  return (...args: unknown[]) => {
    console.log(...args);
  };
}

async function parseJson(request: Request, log: (...args: unknown[]) => void): Promise<Record<string, unknown> | null> {
  try {
    const data = (await request.json()) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }

    return data as Record<string, unknown>;
  } catch (error) {
    log('Failed to parse JSON body', error);
    return null;
  }
}

function isValidEmail(email: string): boolean {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
}

async function ensureSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS subscriptions (email TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT, confirmed INTEGER NOT NULL DEFAULT 0, confirmation_token TEXT, token_created_at TEXT)'
    )
    .run();

  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, bio TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(email) REFERENCES subscriptions(email))'
    )
    .run();
}

function buildConfirmationLink(
  requestUrl: string,
  configuredBaseUrl: string | undefined,
  email: string,
  token: string
): string {
  const base = configuredBaseUrl ?? new URL(requestUrl).origin;
  const url = new URL('/confirm', base);
  url.searchParams.set('token', token);
  url.searchParams.set('email', email);
  return url.toString();
}

function htmlResponse(title: string, message: string, status: 'success' | 'error' | 'info' = 'info'): Response {
  const accent =
    status === 'success' ? '#e7ffad' : status === 'error' ? '#ffdfdf' : 'rgba(255, 255, 255, 0.85)';

  const body = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background-color: #2e5e4e;
        color: #ffffff;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 3rem 1.5rem;
        background: linear-gradient(to bottom right, rgba(46, 94, 78, 0.95), rgba(255, 216, 91, 0.85));
        color: #ffffff;
        text-align: center;
      }

      main {
        width: min(420px, 100%);
        display: grid;
        gap: 1.5rem;
        padding: 2.5rem 2rem;
        border-radius: 18px;
        background: rgba(0, 0, 0, 0.28);
        box-shadow: 0 25px 40px -20px rgba(0, 0, 0, 0.4);
      }

      h1 {
        font-size: clamp(1.75rem, 3vw + 1rem, 2.5rem);
        margin: 0;
      }

      p {
        margin: 0;
        line-height: 1.6;
        font-size: 1rem;
        color: ${accent};
        font-weight: 600;
      }

      .logo {
        font-weight: 700;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.8);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="logo">Solar Roots</div>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;

  return new Response(body, {
    status: status === 'error' ? 400 : 200,
    headers: HTML_HEADERS,
  });
}

async function handleConfirmation(
  request: Request,
  env: Env,
  log: (...args: unknown[]) => void
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { ...HTML_HEADERS, Allow: 'GET' },
    });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const email = url.searchParams.get('email');

  if (!token || !email) {
    return htmlResponse('Confirmation Failed', 'The confirmation link is missing required information.', 'error');
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return htmlResponse('Confirmation Failed', 'The confirmation link is missing required information.', 'error');
  }

  try {
    await ensureSchema(env.DB);

    const existing = await env.DB
      .prepare('SELECT email, confirmed, confirmation_token FROM subscriptions WHERE email = ?')
      .bind(normalizedEmail)
      .first<SubscriptionRecord>();

    if (!existing) {
      return htmlResponse('Confirmation Failed', 'We could not find a subscription for this email address.', 'error');
    }

    if (existing.confirmed) {
      return htmlResponse('You’re already confirmed!', 'Thanks for being part of Solar Roots. We will keep you posted.', 'success');
    }

    if (!existing.confirmation_token || existing.confirmation_token !== token) {
      return htmlResponse('Confirmation Failed', 'This confirmation link is no longer valid. Please request a new one.', 'error');
    }

    const now = new Date().toISOString();
    await env.DB
      .prepare(
        'UPDATE subscriptions SET confirmed = 1, confirmation_token = NULL, updated_at = ?, token_created_at = NULL WHERE email = ?'
      )
      .bind(now, normalizedEmail)
      .run();

    return htmlResponse('You’re all set!', 'Your email has been confirmed. Thanks for joining Solar Roots!', 'success');
  } catch (error) {
    log('Confirmation handler failed', error);
    return htmlResponse('Confirmation Failed', 'Something went wrong on our end. Please try again later.', 'error');
  }
}

async function sendConfirmationEmail(
  env: Env,
  recipient: string,
  link: string,
  log: (...args: unknown[]) => void
): Promise<void> {
  await sendWithMailChannels(env, recipient, link, log);
}

async function sendWithMailChannels(
  env: Env,
  recipient: string,
  link: string,
  log: (...args: unknown[]) => void
): Promise<void> {
  const fromEmail = env.MAIL_FROM_EMAIL ?? 'noreply@example.com';
  const fromName = env.MAIL_FROM_NAME ?? 'Solar Roots';

  const personalization: Record<string, unknown> = {
    to: [{ email: recipient }],
  };

  if (env.MAILCHANNELS_DOMAIN) {
    personalization['dkim_domain'] = env.MAILCHANNELS_DOMAIN;
  }

  if (env.MAILCHANNELS_SUBDOMAIN) {
    personalization['dkim_selector'] = env.MAILCHANNELS_SUBDOMAIN;
  }

  const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [personalization],
      from: { email: fromEmail, name: fromName },
      subject: 'Confirm your Solar Roots subscription',
      content: [
        {
          type: 'text/plain',
          value: `Thanks for subscribing to Solar Roots! Confirm your email by visiting: ${link}`,
        },
        {
          type: 'text/html',
          value: `<p>Thanks for subscribing to Solar Roots!</p><p><a href="${link}">Click here to confirm your email address</a>.</p>`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('MailChannels error', response.status, errorText);
    throw new Error(`MailChannels request failed with status ${response.status}`);
  }
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS },
  });
}

async function handleSubscriptionCheck(request: Request, env: Env, log: (...args: unknown[]) => void): Promise<Response> {
  const payload = await parseJson(request, log);
  if (!payload || typeof payload.email !== 'string') {
    return jsonResponse({ success: false, error: 'Invalid request.' }, 400);
  }

  const email = payload.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    return jsonResponse({ success: false, error: 'Invalid email address.' }, 400);
  }

  await ensureSchema(env.DB);
  const existing = await env.DB
    .prepare('SELECT email FROM subscriptions WHERE email = ?')
    .bind(email)
    .first();

  return jsonResponse(
    {
      success: true,
      exists: !!existing,
      message: existing ? 'This email is already subscribed.' : 'This email is available.',
    },
    200
  );
}

async function handleProfile(
  request: Request,
  env: Env,
  log: (...args: unknown[]) => void
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: 'POST,OPTIONS' },
    });
  }

  const payload = await parseJson(request, log);
  if (!payload) {
    return jsonResponse({ success: false, error: 'Invalid JSON body.' }, 400);
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const bio = typeof payload.bio === 'string' ? payload.bio.trim() : '';

  if (!isValidEmail(email)) {
    return jsonResponse({ success: false, error: 'Invalid email address.' }, 400);
  }

  if (!name) {
    return jsonResponse({ success: false, error: 'Name is required.' }, 400);
  }

  if (!bio) {
    return jsonResponse({ success: false, error: 'Bio is required.' }, 400);
  }

  try {
    await ensureSchema(env.DB);
    const existing = await env.DB
      .prepare('SELECT email FROM subscriptions WHERE email = ?')
      .bind(email)
      .first();

    if (!existing) {
      return jsonResponse({ success: false, error: 'Email not found in subscriptions.' }, 404);
    }

    const now = new Date().toISOString();
    await env.DB
      .prepare(
        'INSERT INTO profiles (email, name, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(email) DO UPDATE SET name = excluded.name, bio = excluded.bio, updated_at = excluded.updated_at'
      )
      .bind(email, name, bio, now, now)
      .run();

    return jsonResponse({ success: true, message: 'Profile saved successfully.' }, 200);
  } catch (error) {
    log('Profile handler failed', error);
    return jsonResponse({ success: false, error: 'Internal Server Error' }, 500);
  }
}

async function handleSubscribe(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  log: (...args: unknown[]) => void
): Promise<Response> {
  try {
    const payload = await parseJson(request, log);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid JSON body.' }, 400);
    }

    const { email } = payload;
    if (typeof email !== 'string' || !isValidEmail(email)) {
      return jsonResponse({ success: false, error: 'A valid email address is required.' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    await ensureSchema(env.DB);

    const existing = await env.DB
      .prepare('SELECT email, confirmed, confirmation_token FROM subscriptions WHERE email = ?')
      .bind(normalizedEmail)
      .first<SubscriptionRecord>();

    const now = new Date().toISOString();
    let token = crypto.randomUUID();

    if (existing) {
      if (existing.confirmed) {
        return jsonResponse({ success: true, message: 'Email is already confirmed.' }, 200);
      }

      token = existing.confirmation_token ?? token;
      await env.DB
        .prepare('UPDATE subscriptions SET confirmation_token = ?, token_created_at = ?, updated_at = ? WHERE email = ?')
        .bind(token, now, now, normalizedEmail)
        .run();
    } else {
      await env.DB
        .prepare(
          'INSERT INTO subscriptions (email, created_at, confirmed, confirmation_token, token_created_at) VALUES (?, ?, 0, ?, ?)'
        )
        .bind(normalizedEmail, now, token, now)
        .run();
    }

    const confirmationLink = buildConfirmationLink(request.url, env.SITE_BASE_URL, normalizedEmail, token);

    ctx.waitUntil(
      sendConfirmationEmail(env, normalizedEmail, confirmationLink, log).catch((error) => {
        log('Failed to send confirmation email', error);
      })
    );

    return jsonResponse(
      {
        success: true,
        message: 'Confirmation email sent. Please check your inbox.',
      },
      202
    );
  } catch (error) {
    log('Subscription handler failed', error);
    return jsonResponse({ success: false, error: 'Internal Server Error' }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const log = getLogger(ctx);

    if (url.pathname === '/confirm') {
      return handleConfirmation(request, env, log);
    }

    if (url.pathname === '/api/profile') {
      return handleProfile(request, env, log);
    }

    if (url.pathname === '/api/check') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { ...CORS_HEADERS, Allow: 'POST,OPTIONS' },
        });
      }

      return handleSubscriptionCheck(request, env, log);
    }

    if (url.pathname === '/api/subscribe') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { ...CORS_HEADERS, Allow: 'POST,OPTIONS' },
        });
      }

      return handleSubscribe(request, env, ctx, log);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
