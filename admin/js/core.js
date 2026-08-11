/* Shared admin runtime: Supabase client, session guard, formatting, confirm modal.
 *
 * The guard here is for user experience only. Real enforcement lives in the database
 * (RLS + SECURITY DEFINER functions) and in the Edge Functions, which re-verify the JWT
 * and admin_users membership on every request. Nothing in this file is trusted server-side.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.SUPABASE_CONFIG;

export const supabase = createClient(cfg.url, cfg.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "apb-admin-auth" },
});

export const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export const EVENT_TYPES = ["Weddings", "Corporate Events", "Private Parties", "Birthdays",
  "Anniversaries", "Housewarming Ceremonies", "Clubs", "Cultural Events", "Special Celebrations"];

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtEventDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export const fmtDateTime = (ts) => {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
  }).format(new Date(ts)) + " IST";
};

export const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/* ----------------------------------------------------------------- session */

export async function requireAdmin() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace("login.html");
    return null;
  }

  // RLS only returns this row to an active admin, so an empty result means not authorized.
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id, role")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !data) {
    await supabase.auth.signOut();
    location.replace("login.html?denied=1");
    return null;
  }

  document.querySelectorAll("[data-admin-email]").forEach((el) => {
    el.textContent = session.user.email ?? "";
  });

  return { session, user: session.user, admin: data };
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace("login.html");
}

export function wireLogout() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", () => signOut());
  });
}

/* --------------------------------------------------------------- functions */

export async function callFn(name, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace("login.html");
    return { ok: false, error: "unauthenticated" };
  }

  let res;
  try {
    res = await fetch(`${cfg.functionsUrl}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.publishableKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "network_error" };
  }

  const body = await res.json().catch(() => ({}));

  if (res.status === 401) {
    await supabase.auth.signOut();
    location.replace("login.html?expired=1");
    return { ok: false, error: "unauthenticated" };
  }

  return { ...body, ok: res.ok && body.ok === true, httpStatus: res.status };
}

export const ERROR_TEXT = {
  not_authorized: "You are not authorized to perform this action.",
  enquiry_not_found: "That enquiry no longer exists.",
  enquiry_not_pending: "This enquiry has already been actioned. Refreshing…",
  enquiry_not_approved: "This booking is not in an approved state.",
  date_already_reserved: "Another booking was approved for this date first. This enquiry cannot be approved.",
  date_blocked: "That date is blocked in the calendar. Unblock it first.",
  event_date_in_past: "That event date has already passed.",
  date_in_past: "You cannot block a date in the past.",
  date_reserved: "That date already has an approved booking.",
  already_blocked: "That date is already blocked.",
  not_blocked: "That date is not currently blocked.",
  network_error: "Could not reach the server. Check your connection and try again.",
  server_error: "Something went wrong. Please try again.",
};

export const errorText = (code) => ERROR_TEXT[code] ?? ERROR_TEXT.server_error;

/* ------------------------------------------------------------------ notice */

export function notice(message, kind = "info") {
  const el = document.querySelector("[data-notice]");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
  el.className = "notice" + (message ? ` notice--${kind}` : "");
  if (message) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ------------------------------------------------------------------- modal */

let modalEl = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement("div");
  modalEl.className = "modal";
  modalEl.hidden = true;
  modalEl.setAttribute("role", "dialog");
  modalEl.setAttribute("aria-modal", "true");
  modalEl.innerHTML = `
    <div class="modal__card">
      <h2 data-modal-title></h2>
      <dl class="modal__summary" data-modal-summary></dl>
      <div class="modal__body" data-modal-body></div>
      <div class="modal__actions">
        <button class="btn btn--outline" type="button" data-modal-cancel>Cancel</button>
        <button class="btn btn--gold" type="button" data-modal-confirm></button>
      </div>
    </div>`;
  document.body.appendChild(modalEl);
  return modalEl;
}

/** Two-step confirmation. Resolves true only when the confirm button is pressed. */
export function confirmModal({ title, summary = [], body = "", confirmLabel = "Confirm", danger = false }) {
  const modal = ensureModal();
  const previouslyFocused = document.activeElement;

  modal.querySelector("[data-modal-title]").textContent = title;
  modal.querySelector("[data-modal-summary]").innerHTML = summary
    .map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`)
    .join("");
  modal.querySelector("[data-modal-summary]").hidden = summary.length === 0;
  modal.querySelector("[data-modal-body]").innerHTML = body;

  const confirmBtn = modal.querySelector("[data-modal-confirm]");
  const cancelBtn = modal.querySelector("[data-modal-cancel]");
  confirmBtn.textContent = confirmLabel;
  confirmBtn.className = `btn ${danger ? "btn--danger" : "btn--gold"}`;

  modal.hidden = false;
  confirmBtn.focus();

  return new Promise((resolve) => {
    const close = (result) => {
      modal.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("pointerdown", onBackdrop);
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      resolve(result);
    };
    const onConfirm = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (event) => { if (event.target === modal) close(false); };
    const onKey = (event) => {
      if (event.key === "Escape") close(false);
      if (event.key === "Tab") {
        // Minimal focus trap across the two actions.
        event.preventDefault();
        (document.activeElement === confirmBtn ? cancelBtn : confirmBtn).focus();
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("pointerdown", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

/* --------------------------------------------------------------- nav badge */

export async function refreshPendingBadge() {
  const badge = document.querySelector("[data-pending-count]");
  if (!badge) return;
  const { count } = await supabase
    .from("booking_enquiries")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  badge.textContent = String(count ?? 0);
  badge.hidden = !count;
}
