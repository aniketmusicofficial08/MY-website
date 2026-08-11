// Admin endpoint: approve / deny / cancel a booking, and retry a failed approval email.
//
// Authorization is never taken from the request body. The caller's JWT is verified against
// the auth server, then the resolved user id is checked against admin_users. Only after both
// pass is the atomic RPC invoked — and the RPC re-verifies admin status itself.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ACTIONS = ["approve", "deny", "cancel", "retry_approval_email"] as const;
type Action = typeof ACTIONS[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

function approvalEmailHtml(row: { name: string; event_type: string; event_date: string; location: string }) {
  const line = (label: string, value: string) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid rgba(242,234,217,.12);color:#a9a08f;font-size:11px;letter-spacing:.14em;text-transform:uppercase;width:130px">${label}</td>
      <td style="padding:9px 0;border-bottom:1px solid rgba(242,234,217,.12);color:#f2ead9;font-size:15px">${value}</td>
    </tr>`;

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0a0907;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#11100d;border:1px solid rgba(214,168,79,.25);padding:32px">
    <p style="margin:0 0 4px;color:#d6a84f;font-size:11px;letter-spacing:.22em;text-transform:uppercase">Booking Approved</p>
    <h1 style="margin:0 0 24px;color:#f2ead9;font-size:24px;font-weight:400">Aniket Patel &amp; Band</h1>
    <p style="margin:0 0 18px;color:#f2ead9;font-size:16px">Hello ${esc(row.name)},</p>
    <p style="margin:0 0 24px;color:#c6bdad;font-size:15px;line-height:1.6">
      Your booking enquiry with Aniket Patel &amp; Band has been approved.
    </p>
    <table style="width:100%;border-collapse:collapse">
      ${line("Event Type", esc(row.event_type))}
      ${line("Event Date", esc(formatEventDate(row.event_date)))}
      ${line("Location", esc(row.location))}
    </table>
    <p style="margin:24px 0 0;color:#d6a84f;font-size:15px">Your booking date has been reserved.</p>
    <p style="margin:16px 0 0;color:#c6bdad;font-size:14px;line-height:1.6">
      For further communication, Aniket Patel &amp; Band may contact you using the
      information you provided with your enquiry.
    </p>
    <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid rgba(242,234,217,.12);color:#8f887c;font-size:14px">
      Aniket Patel &amp; Band
    </p>
  </div></body></html>`;
}

function approvalEmailText(row: { name: string; event_type: string; event_date: string; location: string }) {
  return `Hello ${row.name},

Your booking enquiry with Aniket Patel & Band has been approved.

Event Type:
${row.event_type}

Event Date:
${formatEventDate(row.event_date)}

Location:
${row.location}

Your booking date has been reserved.

For further communication, Aniket Patel & Band may contact you using the information
you provided with your enquiry.

Aniket Patel & Band`;
}

type EmailOutcome = {
  status: "sent" | "failed" | "not_configured";
  detail: Record<string, unknown>;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

/**
 * Sends the approval confirmation to the CUSTOMER.
 *
 * `row` is always read from booking_enquiries by id — never from the request body. The
 * admin's browser can only name which enquiry to approve, never where the mail goes, so a
 * tampered request cannot redirect a customer's confirmation elsewhere.
 */
async function sendApprovalEmail(row: {
  name: string; email: string; event_type: string; event_date: string; location: string;
}): Promise<EmailOutcome> {
  // Defence in depth: the column is constrained at the database level, but a malformed
  // address must never reach the provider or be used to build a header.
  if (typeof row.email !== "string" || !EMAIL_RE.test(row.email) || row.email.length > 254) {
    console.error("approval_email_invalid_recipient");
    return { status: "failed", detail: { provider: "resend", error: "invalid_recipient_in_database" } };
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
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
        to: [row.email],
        subject: "Booking Approved — Aniket Patel & Band",
        html: approvalEmailHtml(row),
        text: approvalEmailText(row),
      }),
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }

    const detail = {
      provider: "resend",
      http_status: res.status,
      from,
      to: row.email,
      using_fallback_sender: usingFallbackSender,
      message_id: parsed.id ?? null,
      error: res.ok ? null : parsed,
    };

    if (!res.ok) {
      console.error("resend_approval_email_failed", res.status, text);
      return { status: "failed", detail };
    }
    // Accepted for delivery by the provider. Not proof of inbox delivery.
    console.log("resend_approval_email_accepted", text);
    return { status: "sent", detail };
  } catch (err) {
    console.error("resend_approval_email_error", String(err));
    return { status: "failed", detail: { provider: "resend", error: String(err) } };
  }
}

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

    // 1. Authentication — verify the JWT against the auth server.
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return json({ ok: false, error: "unauthenticated" }, 401);

    // 2. Authorization — membership in admin_users, never the request's email claim.
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

    // The browser may name an action and an enquiry id. Nothing else is ever trusted —
    // in particular, no email address is read from the request body.
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "") as Action;
    const enquiryId = String(body?.enquiryId ?? "");

    if (!ACTIONS.includes(action)) return json({ ok: false, error: "invalid_action" }, 400);
    if (!UUID_RE.test(enquiryId)) return json({ ok: false, error: "invalid_enquiry_id" }, 400);

    if (action === "retry_approval_email") {
      // Recipient is re-read from the database, exactly as on the approve path.
      const { data: row, error } = await supabase
        .from("booking_enquiries")
        .select("id, name, email, event_type, event_date, location, status")
        .eq("id", enquiryId)
        .maybeSingle();
      if (error) {
        console.error("retry_lookup_error", error.message);
        return json({ ok: false, error: "server_error" }, 500);
      }
      if (!row) return json({ ok: false, error: "enquiry_not_found" }, 404);
      if (row.status !== "approved") return json({ ok: false, error: "enquiry_not_approved" }, 409);

      // The reservation must already exist; retry sends mail only and never re-approves.
      const { count } = await supabase
        .from("booking_reservations")
        .select("id", { count: "exact", head: true })
        .eq("enquiry_id", enquiryId)
        .eq("active", true);
      if (!count) return json({ ok: false, error: "reservation_missing" }, 409);

      const outcome = await sendApprovalEmail(row);
      await supabase.rpc("record_email_attempt", {
        p_enquiry_id: enquiryId, p_kind: "approval",
        p_status: outcome.status, p_detail: outcome.detail,
      });
      await supabase.rpc("log_email_retry", { p_enquiry_id: enquiryId, p_admin_id: user.id });
      return json({ ok: true, emailStatus: outcome.status });
    }

    const rpcName = action === "approve"
      ? "approve_booking"
      : action === "deny"
      ? "deny_booking"
      : "cancel_booking";

    const { data, error } = await supabase.rpc(rpcName, {
      p_enquiry_id: enquiryId,
      p_admin_id: user.id,
    });
    if (error) {
      console.error(`${rpcName}_error`, error.message);
      return json({ ok: false, error: "server_error" }, 500);
    }
    if (!data?.ok) {
      const code = data?.error ?? "server_error";
      const status = code === "not_authorized" ? 403 : code === "enquiry_not_found" ? 404 : 409;
      return json({ ok: false, error: code, status: data?.status }, status);
    }

    if (action !== "approve") return json({ ok: true });

    // The reservation is already committed. An email failure must never undo it — it is
    // recorded so the admin can retry from the dashboard.
    const outcome = await sendApprovalEmail({
      name: data.name, email: data.email, event_type: data.event_type,
      event_date: data.event_date, location: data.location,
    });
    await supabase.rpc("record_email_attempt", {
      p_enquiry_id: enquiryId, p_kind: "approval",
      p_status: outcome.status, p_detail: outcome.detail,
    });

    return json({ ok: true, reservationId: data.reservation_id, emailStatus: outcome.status });
  } catch (err) {
    console.error("admin_booking_unhandled", String(err));
    return json({ ok: false, error: "server_error" }, 500);
  }
});
