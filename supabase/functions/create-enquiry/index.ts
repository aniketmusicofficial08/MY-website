// Public endpoint: accept a booking enquiry from the website.
// No JWT required. All validation is repeated here even though the client also validates,
// and the authoritative availability re-check happens inside the create_enquiry RPC.

import { createClient } from "jsr:@supabase/supabase-js@2";

const EVENT_TYPES = [
  "Weddings", "Corporate Events", "Private Parties", "Birthdays", "Anniversaries",
  "Housewarming Ceremonies", "Clubs", "Cultural Events", "Special Celebrations",
];

const OWNER_EMAIL = "aniketmusicofficial08@gmail.com";
const MAX_BODY_BYTES = 16_000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const formatEventDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const nowInIndia = () =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata",
  }).format(new Date());

const todayInIndia = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const clean = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const cleanMultiline = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/[ \t]+/g, " ").slice(0, 2000) : "";

function ownerEmailHtml(row: Record<string, string>) {
  const rows = [
    ["Name", esc(row.name)],
    ["Phone", `<a href="tel:${esc(row.phone.replace(/[^\d+]/g, ""))}" style="color:#d6a84f;text-decoration:none">${esc(row.phone)}</a>`],
    ["Email", `<a href="mailto:${esc(row.email)}" style="color:#d6a84f;text-decoration:none">${esc(row.email)}</a>`],
    ["Event Type", esc(row.event_type)],
    ["Event Date", esc(formatEventDate(row.event_date))],
    ["Location", esc(row.location)],
    ["Received", esc(nowInIndia()) + " IST"],
  ].map(([label, value]) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid rgba(242,234,217,.12);color:#a9a08f;font-size:11px;letter-spacing:.14em;text-transform:uppercase;width:130px;vertical-align:top">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid rgba(242,234,217,.12);color:#f2ead9;font-size:15px">${value}</td>
    </tr>`).join("");

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0a0907;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#11100d;border:1px solid rgba(214,168,79,.25);padding:32px">
    <p style="margin:0 0 4px;color:#d6a84f;font-size:11px;letter-spacing:.22em;text-transform:uppercase">New Booking Enquiry</p>
    <h1 style="margin:0 0 24px;color:#f2ead9;font-size:24px;font-weight:400">Aniket Patel &amp; Band</h1>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="margin:24px 0 8px;color:#a9a08f;font-size:11px;letter-spacing:.14em;text-transform:uppercase">Message</p>
    <p style="margin:0;color:#f2ead9;font-size:15px;line-height:1.6;white-space:pre-wrap">${esc(row.message)}</p>
    <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid rgba(242,234,217,.12);color:#6f695f;font-size:12px">
      Review and approve this enquiry in your admin dashboard.
    </p>
  </div></body></html>`;
}

type EmailOutcome = {
  status: "sent" | "failed" | "not_configured";
  detail: Record<string, unknown>;
};

async function sendOwnerEmail(row: Record<string, string>): Promise<EmailOutcome> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    // Diagnostic only — never logs the key itself, only its absence.
    console.error("resend_key_absent_from_environment");
    return { status: "not_configured", detail: { reason: "RESEND_API_KEY absent" } };
  }

  const from = Deno.env.get("BOOKING_FROM_EMAIL") ?? "Aniket Patel & Band <onboarding@resend.dev>";
  const usingFallbackSender = !Deno.env.get("BOOKING_FROM_EMAIL");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [OWNER_EMAIL],
        // Safe: email already matched EMAIL_RE, so it cannot contain CR/LF or spaces.
        reply_to: row.email,
        subject: "New Booking Enquiry — Aniket Patel & Band",
        html: ownerEmailHtml(row),
      }),
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }

    const detail: Record<string, unknown> = {
      provider: "resend",
      http_status: res.status,
      from,
      to: OWNER_EMAIL,
      using_fallback_sender: usingFallbackSender,
      message_id: parsed.id ?? null,
      error: res.ok ? null : parsed,
      // Shape of the credential — never any part of its value. Distinguishes a truncated
      // paste, stray whitespace, or the wrong kind of secret entirely.
      key_shape: {
        length: apiKey.length,
        has_re_prefix: apiKey.startsWith("re_"),
        has_surrounding_whitespace: apiKey !== apiKey.trim(),
        has_inner_whitespace: /\s/.test(apiKey.trim()),
      },
    };

    if (!res.ok) {
      console.error("resend_owner_email_failed", res.status, text);
      return { status: "failed", detail };
    }
    // Resend accepted the message for delivery. This is not proof of inbox delivery.
    console.log("resend_owner_email_accepted", text);
    return { status: "sent", detail };
  } catch (err) {
    console.error("resend_owner_email_error", String(err));
    return { status: "failed", detail: { provider: "resend", error: String(err) } };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    // Honeypot: real people never fill this. Answer 200 so bots learn nothing.
    if (clean(body.company) !== "" || clean(body.website) !== "") {
      return json({ ok: true, enquiryId: null });
    }

    const name = clean(body.name);
    const phone = clean(body.phone);
    const email = clean(body.email).toLowerCase();
    const eventType = clean(body.eventType);
    const eventDate = clean(body.eventDate);
    const location = clean(body.location);
    const message = cleanMultiline(body.message);

    const invalid = (field: string, error = "invalid_input") =>
      json({ ok: false, error, field }, 400);

    if (name.length < 2 || name.length > 120) return invalid("name");
    if (phone.length < 6 || phone.length > 32 || !/^[\d+()\-\s]+$/.test(phone)) return invalid("phone");
    if (email.length > 254 || !EMAIL_RE.test(email)) return invalid("email");
    if (!EVENT_TYPES.includes(eventType)) return invalid("eventType");
    if (!DATE_RE.test(eventDate)) return invalid("eventDate");
    if (location.length < 2 || location.length > 200) return invalid("location");
    if (message.length < 1 || message.length > 2000) return invalid("message");

    const parsed = new Date(`${eventDate}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== eventDate) {
      return invalid("eventDate");
    }
    if (eventDate < todayInIndia()) return invalid("eventDate", "event_date_in_past");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data, error } = await supabase.rpc("create_enquiry", {
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_event_type: eventType,
      p_event_date: eventDate,
      p_location: location,
      p_message: message,
      p_source: "website",
    });

    if (error) {
      console.error("create_enquiry_rpc_error", error.message);
      return json({ ok: false, error: "server_error" }, 500);
    }
    if (!data?.ok) {
      const code = data?.error ?? "server_error";
      const status = code === "date_unavailable" ? 409 : 400;
      return json({ ok: false, error: code }, status);
    }

    const enquiryId = data.enquiry_id as string;

    const outcome = await sendOwnerEmail({
      name, phone, email, event_type: eventType,
      event_date: eventDate, location, message,
    });
    await supabase.rpc("record_email_attempt", {
      p_enquiry_id: enquiryId,
      p_kind: "new_enquiry",
      p_status: outcome.status,
      p_detail: outcome.detail,
    });

    // The enquiry is stored regardless of email outcome; the visitor is not shown
    // provider details.
    return json({ ok: true, enquiryId });
  } catch (err) {
    console.error("create_enquiry_unhandled", String(err));
    return json({ ok: false, error: "server_error" }, 500);
  }
});
