import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { LimitlessMCP } from './mcp-server';
import { GoogleAuthHandler } from './auth-handler';

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: LimitlessMCP.mount('/mcp') as any,
  defaultHandler: GoogleAuthHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});

export { LimitlessMCP };
