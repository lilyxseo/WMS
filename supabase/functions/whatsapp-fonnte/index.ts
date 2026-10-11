import { handleFonnteWebhook } from './handler.js';

Deno.serve((request: Request) => handleFonnteWebhook({
  request,
  env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    WMS_SUPABASE_SECRET_KEY: Deno.env.get('WMS_SUPABASE_SECRET_KEY'),
    FONNTE_TOKEN: Deno.env.get('FONNTE_TOKEN'),
    FONNTE_WEBHOOK_SECRET: Deno.env.get('FONNTE_WEBHOOK_SECRET'),
    WHATSAPP_ALLOWED_NUMBERS: Deno.env.get('WHATSAPP_ALLOWED_NUMBERS'),
  },
}));
