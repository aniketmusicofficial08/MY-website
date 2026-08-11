// Public endpoint: date availability for the booking calendar.
// Returns ONLY { date, status } pairs — never any customer information.

import { createClient } from "jsr:@supabase/supabase-js@2";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 400;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const todayInIndia = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const url = new URL(req.url);
    const today = todayInIndia();
    const from = url.searchParams.get("from") ?? today;
    let to = url.searchParams.get("to") ?? addDays(from, 62);

    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return json({ ok: false, error: "invalid_range" }, 400);
    }
    if (to < from) return json({ ok: false, error: "invalid_range" }, 400);
    if (to > addDays(from, MAX_RANGE_DAYS)) to = addDays(from, MAX_RANGE_DAYS);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data, error } = await supabase.rpc("get_availability", { p_from: from, p_to: to });
    if (error) {
      console.error("get_availability_rpc_error", error.message);
      return json({ ok: false, error: "server_error" }, 500);
    }

    // Explicit projection: nothing but date + status can escape this endpoint.
    const days = (data ?? []).map((row: { day: string; status: string }) => ({
      date: row.day,
      status: row.status,
    }));

    return json({ ok: true, today, from, to, days });
  } catch (err) {
    console.error("get_availability_unhandled", String(err));
    return json({ ok: false, error: "server_error" }, 500);
  }
});
