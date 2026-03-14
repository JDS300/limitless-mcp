import { upsertUser } from '../db/queries';
import { signAdminToken } from '../crypto';

export async function handleAdminCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url  = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || state !== 'admin') {
    return new Response('Invalid admin callback', { status: 400 });
  }

  // Exchange code for Google tokens (server-side — code never touches the browser)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${url.origin}/admin/callback`,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return new Response('OAuth exchange failed', { status: 500 });
  }
  const { access_token } = await tokenRes.json() as { access_token: string };

  // Fetch user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return new Response('Failed to fetch user info', { status: 500 });
  const user = await userRes.json() as { sub: string; email: string; name: string };

  // Upsert user in D1
  await upsertUser(env.DB, { id: user.sub, email: user.email, name: user.name, provider: 'google' });

  // Issue signed admin session token (8-hour TTL)
  const sessionToken = await signAdminToken(user.sub, env.SERVER_ENCRYPTION_SECRET);

  // Redirect to /admin — token in URL fragment (never reaches server logs)
  // The browser JS reads window.location.hash and stores in sessionStorage
  return Response.redirect(
    `${url.origin}/admin#token=${encodeURIComponent(sessionToken)}`,
    302
  );
}
