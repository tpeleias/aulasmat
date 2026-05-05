import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { email, password } = await req.json();
    if (!email || !password) return new Response(JSON.stringify({ error: "missing" }), { status: 400, headers: corsHeaders });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: existing } = await admin.auth.admin.listUsers();
    if (existing.users.find(u => u.email === email)) {
      return new Response(JSON.stringify({ ok: true, message: "already exists" }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, user: data.user?.id }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
