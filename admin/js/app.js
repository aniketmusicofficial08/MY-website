/* Page controllers for the admin dashboard, dispatched on <body data-page>. */
import {
  supabase, requireAdmin, wireLogout, callFn, confirmModal, notice, errorText,
  esc, fmtEventDate, fmtDateTime, todayIST, isoOf, daysInMonth, MONTHS,
  EVENT_TYPES, refreshPendingBadge,
} from "./core.js";

const $ = (sel, root = document) => root.querySelector(sel);
const page = document.body.dataset.page;

const ENQUIRY_FIELDS =
  "id, name, phone, email, event_type, event_date, location, message, status," +
  " created_at, updated_at, approved_at, denied_at, cancelled_at," +
  " new_enquiry_email_status, approval_email_status";

const telHref = (phone) => String(phone ?? "").replace(/[^\d+]/g, "");

/* ------------------------------------------------------------------ shared */

/** Detail split into labelled groups so an admin can scan one thing at a time. */
function detailGrid(row) {
  const statusRows = [
    row.approved_at ? `<div><dt>Approved</dt><dd>${esc(fmtDateTime(row.approved_at))}</dd></div>` : "",
    row.denied_at ? `<div><dt>Denied</dt><dd>${esc(fmtDateTime(row.denied_at))}</dd></div>` : "",
    row.cancelled_at ? `<div><dt>Cancelled</dt><dd>${esc(fmtDateTime(row.cancelled_at))}</dd></div>` : "",
    emailDestination(row),
  ].filter(Boolean).join("");

  return `
    <div class="enq-group">
      <span class="enq-group__label">Customer</span>
      <dl class="enq-grid">
        <div><dt>Phone</dt><dd><a href="tel:${esc(telHref(row.phone))}">${esc(row.phone)}</a></dd></div>
        <div><dt>Email</dt><dd><a href="mailto:${esc(row.email)}">${esc(row.email)}</a></dd></div>
      </dl>
    </div>
    <div class="enq-group">
      <span class="enq-group__label">Event</span>
      <dl class="enq-grid">
        <div><dt>Type</dt><dd>${esc(row.event_type)}</dd></div>
        <div><dt>Date</dt><dd>${esc(fmtEventDate(row.event_date))}</dd></div>
        <div><dt>Location</dt><dd>${esc(row.location)}</dd></div>
        <div><dt>Received</dt><dd>${esc(fmtDateTime(row.created_at))}</dd></div>
      </dl>
    </div>
    ${statusRows ? `<div class="enq-group">
      <span class="enq-group__label">Status</span>
      <dl class="enq-grid">${statusRows}</dl>
    </div>` : ""}`;
}

/** Status of the confirmation email that goes to the CUSTOMER, not to the band. */
function emailFlag(row) {
  if (row.status !== "approved") return "";
  const map = {
    sent: ["badge--approved", "✓", "Confirmation email sent"],
    failed: ["badge--warn", "!", "Confirmation email failed"],
    not_configured: ["badge--pending", "!", "Confirmation email not configured"],
  };
  const entry = map[row.approval_email_status];
  if (!entry) return "";
  const [cls, icon, label] = entry;
  return `<span class="badge ${cls}"><span aria-hidden="true">${icon}</span> ${label}</span>`;
}

/** Explicitly shows where the customer confirmation was addressed. */
function emailDestination(row) {
  if (row.status !== "approved" || !row.approval_email_status) return "";
  const verb = row.approval_email_status === "sent" ? "Sent to" : "Addressed to";
  return `<div><dt>${verb}</dt><dd><a href="mailto:${esc(row.email)}">${esc(row.email)}</a></dd></div>`;
}

function enquiryCard(row, actionsHtml) {
  return `
    <article class="enq-card" data-row="${esc(row.id)}">
      <div class="enq-card__top">
        <h3 class="enq-card__name">${esc(row.name)}</h3>
        <span class="badge badge--${esc(row.status)}">${esc(row.status)}</span>
      </div>
      ${detailGrid(row)}
      <p class="enq-message">${esc(row.message)}</p>
      <div class="enq-actions">${actionsHtml}${emailFlag(row)}</div>
    </article>`;
}

async function runAction(fnName, payload, successMessage, reload) {
  const result = await callFn(fnName, payload);
  if (result.ok) {
    notice(successMessage(result), "success");
  } else {
    notice(errorText(result.error), "error");
  }
  await reload();
  await refreshPendingBadge();
  return result;
}

/* --------------------------------------------------------------- dashboard */

async function initDashboard() {
  const today = todayIST();

  const countOf = async (build) => {
    const { count, error } = await build(
      supabase.from("booking_enquiries").select("id", { count: "exact", head: true }),
    );
    return error ? 0 : (count ?? 0);
  };

  const [pending, approved, upcoming, blocked, emailIssues] = await Promise.all([
    countOf((q) => q.eq("status", "pending")),
    countOf((q) => q.eq("status", "approved")),
    countOf((q) => q.eq("status", "approved").gte("event_date", today)),
    supabase.from("calendar_blocks")
      .select("id", { count: "exact", head: true })
      .eq("active", true).gte("blocked_date", today)
      .then(({ count }) => count ?? 0),
    countOf((q) => q.eq("status", "approved").eq("approval_email_status", "failed")),
  ]);

  $("[data-stat-pending]").textContent = pending;
  $("[data-stat-approved]").textContent = approved;
  $("[data-stat-upcoming]").textContent = upcoming;
  $("[data-stat-blocked]").textContent = blocked;

  const alertCard = $("[data-stat-email-card]");
  if (emailIssues > 0) {
    $("[data-stat-email]").textContent = emailIssues;
    alertCard.hidden = false;
  }

  const { data: recent } = await supabase
    .from("booking_enquiries")
    .select(ENQUIRY_FIELDS)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);

  const list = $("[data-recent]");
  list.innerHTML = (recent ?? []).length
    ? recent.map((row) => enquiryCard(row,
      `<a class="btn btn--outline btn--sm" href="enquiries.html">Review</a>`)).join("")
    : `<p class="empty">No new enquiries right now.</p>`;
}

/* --------------------------------------------------------------- enquiries */

async function initEnquiries() {
  const list = $("[data-list]");
  const search = $("[data-search]");
  const typeFilter = $("[data-filter-type]");
  const sort = $("[data-sort]");
  let rows = [];

  typeFilter.innerHTML = `<option value="">All event types</option>` +
    EVENT_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");

  async function load() {
    const { data, error } = await supabase
      .from("booking_enquiries")
      .select(ENQUIRY_FIELDS)
      .eq("status", "pending");
    if (error) {
      notice("Could not load enquiries.", "error");
      rows = [];
    } else {
      rows = data ?? [];
    }
    render();
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    const type = typeFilter.value;

    let view = rows.filter((row) => {
      if (type && row.event_type !== type) return false;
      if (!term) return true;
      return [row.name, row.email, row.phone, row.location, row.message]
        .some((v) => String(v).toLowerCase().includes(term));
    });

    const order = sort.value;
    view.sort((a, b) => {
      if (order === "event_desc") return b.event_date.localeCompare(a.event_date);
      if (order === "received_desc") return b.created_at.localeCompare(a.created_at);
      if (order === "received_asc") return a.created_at.localeCompare(b.created_at);
      return a.event_date.localeCompare(b.event_date);
    });

    $("[data-count]").textContent = `${view.length} of ${rows.length}`;

    list.innerHTML = view.length
      ? view.map((row) => enquiryCard(row, `
          <button class="btn btn--gold btn--sm" type="button" data-approve="${esc(row.id)}">Approve Booking</button>
          <button class="btn btn--danger btn--sm" type="button" data-deny="${esc(row.id)}">Deny Enquiry</button>`)).join("")
      : `<p class="empty">${rows.length ? "No enquiries match your filters." : "No new enquiries right now."}</p>`;
  }

  search.addEventListener("input", render);
  typeFilter.addEventListener("change", render);
  sort.addEventListener("change", render);

  list.addEventListener("click", async (event) => {
    const approveId = event.target.closest("[data-approve]")?.dataset.approve;
    const denyId = event.target.closest("[data-deny]")?.dataset.deny;
    const row = rows.find((r) => r.id === (approveId || denyId));
    if (!row) return;

    if (approveId) {
      const confirmed = await confirmModal({
        title: "Approve this booking?",
        summary: [
          ["Customer", row.name],
          ["Customer Email", row.email],
          ["Event", row.event_type],
          ["Date", fmtEventDate(row.event_date)],
          ["Location", row.location],
        ],
        body: `<p>Approving will:</p><ul>
                 <li>Reserve ${esc(fmtEventDate(row.event_date))} for this booking</li>
                 <li>Move the enquiry to Approved Bookings</li>
                 <li>Make this date unavailable publicly</li>
                 <li>Email the confirmation to <strong>${esc(row.email)}</strong></li>
               </ul>`,
        confirmLabel: "Confirm Approval",
      });
      if (!confirmed) return;

      await runAction("admin-booking", { action: "approve", enquiryId: row.id }, (res) => {
        if (res.emailStatus === "sent") return `Booking approved. Confirmation email sent to ${row.email}.`;
        if (res.emailStatus === "not_configured") {
          return `Booking approved and the date is reserved. The confirmation email was not sent because email delivery is not configured yet.`;
        }
        return `Booking approved and the date is reserved, but the confirmation email failed. You can retry it from the Approved page.`;
      }, load);
      return;
    }

    if (denyId) {
      const confirmed = await confirmModal({
        title: "Deny this enquiry?",
        summary: [
          ["Customer", row.name],
          ["Event", row.event_type],
          ["Date", fmtEventDate(row.event_date)],
        ],
        body: `<p>Denying will:</p><ul>
                 <li>Mark this enquiry as denied</li>
                 <li>Leave ${esc(fmtEventDate(row.event_date))} available, unless it is separately reserved or blocked</li>
                 <li>Keep it on the Denied page for 72 hours, then hide it without deleting it</li>
                 <li>Send the customer nothing — no email goes out on denial</li>
               </ul>`,
        confirmLabel: "Confirm Denial",
        danger: true,
      });
      if (!confirmed) return;

      await runAction("admin-booking", { action: "deny", enquiryId: row.id },
        () => "Enquiry denied.", load);
    }
  });

  await load();
}

/* ---------------------------------------------------------------- approved */

async function initApproved() {
  const list = $("[data-list]");
  let rows = [];

  async function load() {
    const { data, error } = await supabase
      .from("booking_enquiries")
      .select(ENQUIRY_FIELDS)
      .eq("status", "approved");
    if (error) {
      notice("Could not load approved bookings.", "error");
      rows = [];
    } else {
      const today = todayIST();
      const upcoming = (data ?? []).filter((r) => r.event_date >= today)
        .sort((a, b) => a.event_date.localeCompare(b.event_date));
      const past = (data ?? []).filter((r) => r.event_date < today)
        .sort((a, b) => b.event_date.localeCompare(a.event_date));
      rows = [...upcoming, ...past];   // upcoming bookings first
    }
    render();
  }

  function render() {
    $("[data-count]").textContent = String(rows.length);
    list.innerHTML = rows.length
      ? rows.map((row) => {
        const retry = ["failed", "not_configured"].includes(row.approval_email_status)
          ? `<button class="btn btn--outline btn--sm" type="button" data-retry="${esc(row.id)}">Retry Email</button>`
          : "";
        return enquiryCard(row, `
          <button class="btn btn--danger btn--sm" type="button" data-cancel="${esc(row.id)}">Cancel Booking</button>
          ${retry}`);
      }).join("")
      : `<p class="empty">No approved bookings yet.</p>`;
  }

  list.addEventListener("click", async (event) => {
    const cancelId = event.target.closest("[data-cancel]")?.dataset.cancel;
    const retryId = event.target.closest("[data-retry]")?.dataset.retry;
    const row = rows.find((r) => r.id === (cancelId || retryId));
    if (!row) return;

    if (cancelId) {
      const confirmed = await confirmModal({
        title: "Cancel this booking?",
        summary: [
          ["Customer", row.name],
          ["Event Type", row.event_type],
          ["Event Date", fmtEventDate(row.event_date)],
          ["Location", row.location],
        ],
        body: `<p>Cancelling will:</p><ul>
                 <li>Set this booking's status to Cancelled</li>
                 <li>Release the reservation held on ${esc(fmtEventDate(row.event_date))}</li>
                 <li>Make that date available publicly again, unless you block it</li>
                 <li>Keep the full booking history and audit trail</li>
               </ul>`,
        confirmLabel: "Confirm Cancellation",
        danger: true,
      });
      if (!confirmed) return;

      await runAction("admin-booking", { action: "cancel", enquiryId: row.id },
        () => `Booking cancelled. ${fmtEventDate(row.event_date)} is available again.`, load);
      return;
    }

    if (retryId) {
      const result = await runAction("admin-booking",
        { action: "retry_approval_email", enquiryId: row.id },
        (res) => res.emailStatus === "sent"
          ? `Confirmation email sent to ${row.email}.`
          : `Email could not be sent (${res.emailStatus}). The booking and its reservation are unchanged.`,
        load);
      if (result.ok && result.emailStatus !== "sent") notice(
        `Email could not be sent (${result.emailStatus}). The booking and its reservation are unchanged.`,
        "error");
    }
  });

  await load();
}

/* ------------------------------------------------------------------ denied */

async function initDenied() {
  const list = $("[data-list]");

  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("booking_enquiries")
    .select(ENQUIRY_FIELDS)
    .eq("status", "denied")
    .gt("denied_at", cutoff)
    .order("denied_at", { ascending: false });

  if (error) {
    notice("Could not load denied enquiries.", "error");
    return;
  }

  const rows = data ?? [];
  $("[data-count]").textContent = String(rows.length);
  list.innerHTML = rows.length
    ? rows.map((row) => enquiryCard(row, "")).join("")
    : `<p class="empty">No enquiries have been denied in the last 72 hours.</p>`;
}

/* ---------------------------------------------------------------- calendar */

async function initCalendar() {
  const grid = $("[data-cal-grid]");
  const title = $("[data-cal-title]");
  const prev = $("[data-cal-prev]");
  const next = $("[data-cal-next]");

  const today = todayIST();
  const [ty, tm] = today.split("-").map(Number);
  let year = ty;
  let month = tm - 1;

  const reserved = new Map();   // iso -> enquiry name
  const blocked = new Map();    // iso -> reason

  async function load() {
    const from = isoOf(year, month, 1);
    const to = isoOf(year, month, daysInMonth(year, month));
    reserved.clear();
    blocked.clear();

    const [res, blk] = await Promise.all([
      supabase.from("booking_reservations")
        .select("reserved_date, enquiry_id, booking_enquiries(name, event_type)")
        .eq("active", true).gte("reserved_date", from).lte("reserved_date", to),
      supabase.from("calendar_blocks")
        .select("blocked_date, reason")
        .eq("active", true).gte("blocked_date", from).lte("blocked_date", to),
    ]);

    if (res.error || blk.error) {
      notice("Could not load the calendar.", "error");
      return;
    }
    (res.data ?? []).forEach((r) => reserved.set(r.reserved_date, r.booking_enquiries?.name ?? "Booked"));
    (blk.data ?? []).forEach((b) => blocked.set(b.blocked_date, b.reason ?? "Unavailable"));
    render();
  }

  function render() {
    title.textContent = `${MONTHS[month]} ${year}`;
    const offset = (year - ty) * 12 + (month - (tm - 1));
    prev.disabled = offset <= 0;
    next.disabled = offset >= 24;

    const firstWeekday = new Date(year, month, 1).getDay();
    const total = daysInMonth(year, month);
    const cells = [];

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(`<div class="cal-day cal-day--empty" aria-hidden="true"></div>`);
    }

    for (let day = 1; day <= total; day += 1) {
      const iso = isoOf(year, month, day);
      let state = "available";
      let tag = "Available";

      if (iso < today) { state = "past"; tag = ""; }
      else if (reserved.has(iso)) { state = "booked"; tag = "Booked"; }
      else if (blocked.has(iso)) { state = "blocked"; tag = blocked.get(iso); }

      const label = state === "booked"
        ? `${fmtEventDate(iso)}, booked by ${reserved.get(iso)}`
        : `${fmtEventDate(iso)}, ${state}`;

      cells.push(`
        <button class="cal-day cal-day--${state}" type="button"
                data-date="${iso}" data-state="${state}"
                ${state === "past" || state === "booked" ? "disabled" : ""}
                aria-label="${esc(label)}">
          <span class="cal-day__num">${day}</span>
          ${tag ? `<span class="cal-day__tag">${esc(tag)}</span>` : ""}
        </button>`);
    }

    grid.innerHTML = cells.join("");
  }

  prev.addEventListener("click", () => {
    const d = new Date(year, month - 1, 1);
    year = d.getFullYear(); month = d.getMonth();
    load();
  });
  next.addEventListener("click", () => {
    const d = new Date(year, month + 1, 1);
    year = d.getFullYear(); month = d.getMonth();
    load();
  });

  grid.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    const { date, state } = button.dataset;

    if (state === "available") {
      const confirmed = await confirmModal({
        title: "Block this date?",
        summary: [["Date", fmtEventDate(date)]],
        body: `<p>Blocking makes this date unavailable on the public calendar, so visitors
                 cannot request it.</p>
               <div class="field" style="margin-top:1rem">
                 <label for="block-reason">Internal reason (optional)</label>
                 <select id="block-reason" data-block-reason>
                   <option value="">No reason</option>
                   <option value="Holiday">Holiday</option>
                   <option value="Unavailable">Unavailable</option>
                   <option value="Personal">Personal</option>
                   <option value="Other">Other</option>
                 </select>
               </div>`,
        confirmLabel: "Confirm Block",
      });
      if (!confirmed) return;

      const reason = document.querySelector("[data-block-reason]")?.value ?? "";
      await runAction("admin-calendar", { action: "block", date, reason },
        () => `${fmtEventDate(date)} is now blocked.`, load);
      return;
    }

    if (state === "blocked") {
      const confirmed = await confirmModal({
        title: "Unblock this date?",
        summary: [["Date", fmtEventDate(date)], ["Reason", blocked.get(date) ?? "—"]],
        body: `<p>This date will become available again on the public calendar, unless an
               approved booking already holds it.</p>`,
        confirmLabel: "Confirm Unblock",
      });
      if (!confirmed) return;

      await runAction("admin-calendar", { action: "unblock", date }, (res) =>
        res.still_reserved
          ? `${fmtEventDate(date)} is unblocked but stays booked by an approved booking.`
          : `${fmtEventDate(date)} is available again.`, load);
    }
  });

  await load();
}

/* -------------------------------------------------------------------- boot */

const PAGES = {
  dashboard: initDashboard,
  enquiries: initEnquiries,
  approved: initApproved,
  denied: initDenied,
  calendar: initCalendar,
};

(async () => {
  const session = await requireAdmin();
  if (!session) return;
  wireLogout();
  await refreshPendingBadge();
  try {
    await PAGES[page]?.();
  } catch (err) {
    console.error(err);
    notice("Something went wrong loading this page.", "error");
  }
})();


