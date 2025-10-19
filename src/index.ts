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
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_FROM_NAME?: string;
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

async function sendConfirmationEmail(
  env: Env,
  recipient: string,
  link: string,
  log: (...args: unknown[]) => void
): Promise<void> {
  if (env.SENDGRID_API_KEY) {
    await sendWithSendGrid(env, recipient, link, log);
  } else {
    await sendWithMailChannels(env, recipient, link, log);
  }
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

async function sendWithSendGrid(
  env: Env,
  recipient: string,
  link: string,
  log: (...args: unknown[]) => void
): Promise<void> {
  const fromEmail = env.SENDGRID_FROM_EMAIL ?? env.MAIL_FROM_EMAIL ?? 'noreply@example.com';
  const fromName = env.SENDGRID_FROM_NAME ?? env.MAIL_FROM_NAME ?? 'Solar Roots';

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: recipient }],
        },
      ],
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
    log('SendGrid error', response.status, errorText);
    throw new Error(`SendGrid request failed with status ${response.status}`);
  }
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname !== '/api/subscribe') {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { ...CORS_HEADERS, Allow: 'POST,OPTIONS' },
      });
    }

    const log = getLogger(ctx);

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
      if (!normalizedEmail) {
        return jsonResponse({ success: false, error: 'A valid email address is required.' }, 400);
      }

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
          .prepare(
            'UPDATE subscriptions SET confirmation_token = ?, token_created_at = ?, updated_at = ? WHERE email = ?'
          )
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
  },
};
