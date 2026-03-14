import type {
  OAuthHelpers,
  AuthRequest,
} from '@cloudflare/workers-oauth-provider';
import { upsertUser } from './db/queries';

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
}

// OAuthProvider injects helpers into env.OAUTH_PROVIDER before calling this handler
type EnvWithOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers };

// ExportedHandler object — compatible with OAuthProvider's defaultHandler requirement
export const GoogleAuthHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const oauthHelpers = (env as EnvWithOAuth).OAUTH_PROVIDER;
    const url = new URL(request.url);

    if (url.pathname === '/authorize') {
      return handleAuthorize(request, env, oauthHelpers);
    }

    if (url.pathname === '/callback') {
      return handleCallback(request, env, ctx, oauthHelpers);
    }

    if (url.pathname === '/admin/login') {
      return handleAdminLogin(request, env);
    }
    if (url.pathname === '/admin/callback') {
      const { handleAdminCallback } = await import('./admin/callback');
      return handleAdminCallback(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleAuthorize(
  request: Request,
  env: Env,
  oauthHelpers: OAuthHelpers
): Promise<Response> {
  const oauthReqInfo = await oauthHelpers.parseAuthRequest(request);

  // Store the OAuth request state so we can resume after Google callback
  const state = btoa(JSON.stringify(oauthReqInfo));

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set('redirect_uri', getCallbackUrl(request));
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('state', state);
  googleAuthUrl.searchParams.set('access_type', 'online');

  return Response.redirect(googleAuthUrl.toString(), 302);
}

async function handleCallback(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  oauthHelpers: OAuthHelpers
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  // Restore the original OAuth request info
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(state));
  } catch {
    return new Response('Invalid state', { status: 400 });
  }

  // Exchange code for Google tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getCallbackUrl(request),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(`Google token exchange failed: ${err}`, { status: 500 });
  }

  const tokens: GoogleTokenResponse = await tokenRes.json();

  // Get user info from Google
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return new Response('Failed to fetch Google user info', { status: 500 });
  }

  const user: GoogleUserInfo = await userRes.json();

  // Upsert user in D1
  await upsertUser(env.DB, {
    id: user.sub,
    email: user.email,
    name: user.name,
    provider: 'google',
  });

  // Complete the OAuth flow — issue MCP token with user claims
  const { redirectTo } = await oauthHelpers.completeAuthorization({
    request: oauthReqInfo,
    userId: user.sub,
    metadata: {},
    scope: oauthReqInfo.scope,
    props: {
      claims: {
        sub: user.sub,
        email: user.email,
        name: user.name,
        provider: 'google',
      },
    },
  });

  return Response.redirect(redirectTo, 302);
}

async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set('redirect_uri', `${origin}/admin/callback`);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('state', 'admin');
  googleAuthUrl.searchParams.set('access_type', 'online');
  return Response.redirect(googleAuthUrl.toString(), 302);
}

function getCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/callback`;
}
