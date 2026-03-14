import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { LimitlessMCP } from './mcp-server';
import { GoogleAuthHandler } from './auth-handler';

const oauthProvider = new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: LimitlessMCP.mount('/mcp') as any,
  defaultHandler: GoogleAuthHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // REST API — validated by admin session token in src/api/entries.ts
    if (url.pathname.startsWith('/api/')) {
      const { handleApiRequest } = await import('./api/entries');
      return handleApiRequest(request, env);
    }

    // Admin UI and admin OAuth routes — handled by GoogleAuthHandler + admin/html.ts
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      if (url.pathname === '/admin/login' || url.pathname === '/admin/callback') {
        return GoogleAuthHandler.fetch(request, env, ctx);
      }
      // Serve admin SPA
      const { getAdminHtml } = await import('./admin/html');
      return new Response(getAdminHtml(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // MCP, OAuth, and registration — handled by OAuthProvider
    return oauthProvider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

export { LimitlessMCP };
