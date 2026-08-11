/* Public booking: availability calendar + real backend enquiry submission.
 * Talks only to the public Edge Functions. No Supabase SDK, no keys beyond the
 * publishable key, no customer data ever read back from the API. */
(() => {
  "use strict";

  const cfg = window.SUPABASE_CONFIG;
  const form = document.querySelector("[data-enquiry-form]");
  if (!cfg || !form) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const picker = form.querySelector("[data-date-picker]");
  const trigger = form.querySelector("[data-date-trigger]");
  const panel = form.querySelector("[data-date-panel]");
  const dateLabel = form.querySelector("[data-date-label]");
  const dateInput = form.querySelector("[data-date-value]");
  const grid = form.querySelector("[data-cal-grid]");
  const calTitle = form.querySelector("[data-cal-title]");
  const prevBtn = form.querySelector("[data-cal-prev]");
  const nextBtn = form.querySelector("[data-cal-next]");
  const calMsg = form.querySelector("[data-cal-msg]");
  const statusEl = form.querySelector("[data-form-status]");
  const submitBtn = form.querySelector('button[type="submit"]');
  const eventTypeInput = form.querySelector("[data-event-value]");
  const eventTypeTrigger = form.querySelector("#event-type-button");
  const eventTypeLabel = form.querySelector("#event-type-value");
  const shell = document.querySelector("[data-booking-shell]");
  const successPanel = document.querySelector("[data-enquiry-success]");

  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MAX_MONTHS_AHEAD = 24;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  const availability = new Map();
  const loadedMonths = new Set();
  let today = null;
  let viewYear;
  let viewMonth;
  let selected = "";
  let submitting = false;

  const localToday = () => {
    const d = new Date();
    return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
  };

  // Until the server tells us the Asia/Kolkata date, fall back to the device date.
  today = localToday();
  {
    const d = new Date();
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
  }

  const prettyDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  };

  const setStatus = (message, variant) => {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.hidden = !message;
    statusEl.className = "form-status" + (variant ? ` form-status--${variant}` : "");
  };

  const setCalMsg = (message) => {
    if (calMsg) calMsg.textContent = message || "";
  };

  /* ------------------------------------------------------------------ availability */

  async function loadMonth(year, month, { force = false } = {}) {
    const key = monthKey(year, month);
    if (!force && loadedMonths.has(key)) return;

    const from = isoOf(year, month, 1);
    const to = isoOf(year, month, daysInMonth(year, month));

    const res = await fetch(
      `${cfg.functionsUrl}/get-availability?from=${from}&to=${to}`,
      { headers: { apikey: cfg.publishableKey } },
    );
    if (!res.ok) throw new Error("availability_unavailable");

    const data = await res.json();
    if (!data || !data.ok) throw new Error("availability_unavailable");

    today = data.today;
    data.days.forEach((day) => availability.set(day.date, day.status));
    loadedMonths.add(key);
  }

  async function showMonth(year, month, opts) {
    viewYear = year;
    viewMonth = month;
    render();
    try {
      await loadMonth(year, month, opts);
      setCalMsg("");
    } catch {
      setCalMsg("Could not load availability. Please try again.");
    }
    render();
  }

  /* ---------------------------------------------------------------------- rendering */

  const monthsFromToday = (year, month) => {
    const [ty, tm] = today.split("-").map(Number);
    return (year - ty) * 12 + (month - (tm - 1));
  };

  function render() {
    if (!grid || !calTitle) return;

    calTitle.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    const offset = monthsFromToday(viewYear, viewMonth);
    if (prevBtn) prevBtn.disabled = offset <= 0;
    if (nextBtn) nextBtn.disabled = offset >= MAX_MONTHS_AHEAD;

    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const total = daysInMonth(viewYear, viewMonth);
    const parts = [];

    for (let i = 0; i < firstWeekday; i += 1) {
      parts.push('<span class="date-picker__day date-picker__day--empty" aria-hidden="true"></span>');
    }

    for (let day = 1; day <= total; day += 1) {
      const iso = isoOf(viewYear, viewMonth, day);
      const known = availability.get(iso);
      const status = iso < today ? "past" : (known || "loading");
      const isSelected = iso === selected;
      const selectable = status === "available";

      const classes = ["date-picker__day", `date-picker__day--${status}`];
      if (isSelected) classes.push("date-picker__day--selected");

      const labels = {
        available: "available",
        booked: "already booked",
        blocked: "unavailable",
        past: "in the past",
        loading: "loading availability",
      };

      parts.push(
        `<button type="button" class="${classes.join(" ")}" data-date="${iso}" data-status="${status}"` +
        ` tabindex="${isSelected || (!selected && day === 1) ? 0 : -1}"` +
        `${status === "past" || status === "loading" ? " disabled" : ""}` +
        `${isSelected ? ' aria-current="date"' : ""}` +
        ` aria-label="${prettyDate(iso)}, ${labels[status]}"` +
        `${selectable ? "" : ' aria-disabled="true"'}>${day}</button>`,
      );
    }

    grid.innerHTML = parts.join("");
  }

  /* ----------------------------------------------------------------- picker control */

  const setPickerOpen = (open) => {
    if (!trigger || !panel) return;
    trigger.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
    if (open) {
      trigger.removeAttribute("aria-invalid");
      setCalMsg("");
      showMonth(viewYear, viewMonth);
    }
  };

  const selectDate = (iso) => {
    selected = iso;
    if (dateInput) dateInput.value = iso;
    if (dateLabel) {
      dateLabel.textContent = prettyDate(iso);
      dateLabel.classList.add("is-set");
    }
    trigger?.removeAttribute("aria-invalid");
    setPickerOpen(false);
    trigger?.focus();
  };

  const clearDate = () => {
    selected = "";
    if (dateInput) dateInput.value = "";
    if (dateLabel) {
      dateLabel.textContent = "Select a date";
      dateLabel.classList.remove("is-set");
    }
  };

  trigger?.addEventListener("click", () => {
    setPickerOpen(trigger.getAttribute("aria-expanded") !== "true");
  });

  prevBtn?.addEventListener("click", () => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    showMonth(d.getFullYear(), d.getMonth());
  });

  nextBtn?.addEventListener("click", () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    showMonth(d.getFullYear(), d.getMonth());
  });

  grid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    const { date, status } = button.dataset;

    if (status === "available") {
      selectDate(date);
      return;
    }
    if (status === "booked") setCalMsg("This date is already booked.");
    else if (status === "blocked") setCalMsg("This date is unavailable.");
  });

  grid?.addEventListener("keydown", (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();

    const days = [...grid.querySelectorAll("[data-date]")];
    const index = days.indexOf(document.activeElement);
    const next = days[index + step];
    if (next) {
      days.forEach((d) => d.setAttribute("tabindex", "-1"));
      next.setAttribute("tabindex", "0");
      next.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && trigger?.getAttribute("aria-expanded") === "true") {
      setPickerOpen(false);
      trigger.focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (picker && !picker.contains(event.target)) setPickerOpen(false);
  });

  /* ---------------------------------------------------------------------- submission */

  const FIELD_MESSAGES = {
    name: "Please enter your name.",
    phone: "Please enter a valid phone number.",
    email: "Please enter a valid email address.",
    eventType: "Please choose an event type.",
    eventDate: "Please choose an event date.",
    location: "Please enter the event location.",
    message: "Please tell us about your celebration.",
  };

  const ERROR_MESSAGES = {
    date_unavailable: "That date is no longer available. Please choose another date.",
    event_date_in_past: "Please choose a date in the future.",
    event_date_too_far: "Please choose a date within the next two years.",
    payload_too_large: "Your message is too long. Please shorten it and try again.",
    server_error: "Something went wrong on our end. Please try again in a moment.",
  };

  function readForm() {
    const data = new FormData(form);
    const get = (key) => String(data.get(key) ?? "").trim();
    return {
      name: get("name"),
      phone: get("phone"),
      email: get("email"),
      eventType: get("eventType"),
      eventDate: get("eventDate"),
      location: get("location"),
      message: get("message"),
      company: get("company"),
    };
  }

  function validate(values) {
    if (values.name.length < 2) return "name";
    if (!/^[\d+()\-\s]{6,32}$/.test(values.phone)) return "phone";
    if (!EMAIL_RE.test(values.email)) return "email";
    if (!values.eventType) return "eventType";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.eventDate)) return "eventDate";
    if (values.location.length < 2) return "location";
    if (values.message.length < 1) return "message";
    return null;
  }

  function focusField(field) {
    if (field === "eventType") {
      eventTypeTrigger?.setAttribute("aria-invalid", "true");
      eventTypeTrigger?.focus();
      return;
    }
    if (field === "eventDate") {
      trigger?.setAttribute("aria-invalid", "true");
      trigger?.focus();
      return;
    }
    form.querySelector(`[name="${field}"]`)?.focus();
  }

  function resetForm() {
    form.reset();
    clearDate();
    if (eventTypeInput) eventTypeInput.value = "";
    if (eventTypeLabel) eventTypeLabel.textContent = "Select an event";
    form.querySelectorAll('#event-type-list [role="option"]').forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === 0));
    });
    availability.clear();
    loadedMonths.clear();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;

    const values = readForm();
    const invalidField = validate(values);
    if (invalidField) {
      setStatus(FIELD_MESSAGES[invalidField], "error");
      focusField(invalidField);
      return;
    }

    submitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute("aria-busy", "true");
    }
    setStatus("Sending your enquiry…", "busy");

    try {
      const res = await fetch(`${cfg.functionsUrl}/create-enquiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.publishableKey },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        setStatus("", null);
        showSuccess(values);
        resetForm();
        return;
      }

      const code = data?.error;
      if (code === "date_unavailable") {
        clearDate();
        availability.clear();
        loadedMonths.clear();
        setStatus(ERROR_MESSAGES.date_unavailable, "error");
        setPickerOpen(true);
        return;
      }

      if (code === "invalid_input" && data?.field) {
        setStatus(FIELD_MESSAGES[data.field] ?? "Please check your details and try again.", "error");
        focusField(data.field);
        return;
      }

      setStatus(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.server_error, "error");
    } catch {
      setStatus("We could not reach the server. Please check your connection and try again.", "error");
    } finally {
      submitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute("aria-busy");
      }
    }
  });

  /* The form and the success panel are two states of one container, never two stacked
     elements. Swapping `data-state` shows exactly one of them. */
  function showSuccess(values) {
    if (!successPanel || !shell) return;
    successPanel.querySelector("[data-success-event]").textContent = values.eventType;
    successPanel.querySelector("[data-success-date]").textContent = prettyDate(values.eventDate);
    successPanel.querySelector("[data-success-location]").textContent = values.location;

    shell.dataset.state = "success";
    shell.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    successPanel.querySelector(".enquiry-success__title")?.focus();
  }

  successPanel?.querySelector("[data-success-again]")?.addEventListener("click", async () => {
    if (!shell) return;

    // Clear the previous submission's details before the panel is shown again.
    successPanel.querySelector("[data-success-event]").textContent = "";
    successPanel.querySelector("[data-success-date]").textContent = "";
    successPanel.querySelector("[data-success-location]").textContent = "";

    shell.dataset.state = "form";
    setStatus("", null);
    setCalMsg("");
    trigger?.removeAttribute("aria-invalid");
    eventTypeTrigger?.removeAttribute("aria-invalid");

    // Availability may have changed while the success panel was on screen.
    const now = new Date();
    await showMonth(now.getFullYear(), now.getMonth(), { force: true }).catch(() => {});

    form.querySelector('[name="name"]')?.focus();
  });

  // Warm the calendar so the first open is instant and `today` comes from the server.
  showMonth(viewYear, viewMonth).catch(() => {});
})();
