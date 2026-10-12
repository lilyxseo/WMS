import { handleAppGoogleAuth } from './handler.js';
Deno.serve((request: Request) => handleAppGoogleAuth(request, {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  WMS_SUPABASE_SECRET_KEY: Deno.env.get('WMS_SUPABASE_SECRET_KEY'),
  GOOGLE_OAUTH_CLIENT_ID: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID'),
  GOOGLE_OAUTH_CLIENT_SECRET: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET'),
  GOOGLE_OAUTH_REFRESH_TOKEN: Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN'),
}));
