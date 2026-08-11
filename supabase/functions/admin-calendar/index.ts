// Admin endpoint: block / unblock a calendar date.
// Same authentication + authorization contract as admin-booking.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ACTIONS = ["block", "unblock"] as const;
type Action = typeof ACTIONS[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REASONS = ["Holiday", "Unavailable", "Personal", "Other"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return json({ ok: false, error: "unauthenticated" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return json({ ok: false, error: "unauthenticated" }, 401);

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (adminError) {
      console.error("admin_lookup_error", adminError.message);
      return json({ ok: false, error: "server_error" }, 500);
    }
    if (!admin) return json({ ok: false, error: "not_authorized" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "") as Action;
    const date = String(body?.date ?? "");
    const rawReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    const reason = REASONS.includes(rawReason) ? rawReason : (rawReason ? "Other" : null);

    if (!ACTIONS.includes(action)) return json({ ok: false, error: "invalid_action" }, 400);
    if (!DATE_RE.test(date)) return json({ ok: false, error: "invalid_date" }, 400);

    const { data, error } = action === "block"
      ? await supabase.rpc("block_date", { p_date: date, p_reason: reason, p_admin_id: user.id })
      : await supabase.rpc("unblock_date", { p_date: date, p_admin_id: user.id });

    if (error) {
      console.error(`${action}_date_error`, error.message);
      return json({ ok: false, error: "server_error" }, 500);
    }
    if (!data?.ok) {
      const code = data?.error ?? "server_error";
      const status = code === "not_authorized" ? 403 : 409;
      return json({ ok: false, error: code }, status);
    }

    return json({ ok: true, ...data });
  } catch (err) {
    console.error("admin_calendar_unhandled", String(err));
    return json({ ok: false, error: "server_error" }, 500);
  }
});
