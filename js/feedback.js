/* Static customer video stories.
 * Add real, approved media entries to feedbackVideos. No video source is assigned
 * until a visitor opens a card, so the page never downloads videos on load. */
(() => {
  "use strict";

  const feedbackVideos = [
    // Future entries:
    // {
    //   video: "assets/feedback/videos/customer-feedback-01.mp4",
    //   poster: "assets/feedback/posters/customer-feedback-01.webp",
    //   customerName: "",
    //   eventType: "",
    //   caption: "",
    // },
  ];

  const grid = document.querySelector("[data-feedback-grid]");
  const empty = document.querySelector("[data-feedback-empty]");
  const modal = document.querySelector("[data-feedback-modal]");
  const player = modal?.querySelector("[data-feedback-player]");
  const closeButton = modal?.querySelector("[data-feedback-close]");
  const modalTitle = modal?.querySelector("[data-feedback-modal-title]");
  const modalCaption = modal?.querySelector("[data-feedback-modal-caption]");
  let lastFocused = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  const closeModal = () => {
    if (!modal || !player || modal.hidden) return;
    player.pause();
    player.removeAttribute("src");
    player.removeAttribute("poster");
    player.load();
    modal.hidden = true;
    document.body.classList.remove("feedback-modal-open");
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  };

  const openModal = (item, trigger) => {
    if (!modal || !player || !closeButton) return;
    lastFocused = trigger;
    modalTitle.textContent = item.customerName || "Customer Feedback";
    modalCaption.textContent = [item.eventType, item.caption].filter(Boolean).join(" — ");
    modalCaption.hidden = !modalCaption.textContent;
    if (item.poster) player.poster = item.poster;
    player.src = item.video;
    modal.hidden = false;
    document.body.classList.add("feedback-modal-open");
    closeButton.focus();
    player.play().catch(() => {});
  };

  const render = () => {
    if (!grid || !empty) return;
    empty.hidden = feedbackVideos.length > 0;
    grid.hidden = feedbackVideos.length === 0;
    grid.innerHTML = feedbackVideos.map((item, index) => {
      const title = item.customerName || "Customer Feedback";
      const meta = item.eventType ? `<span>${escapeHtml(item.eventType)}</span>` : "";
      const caption = item.caption ? `<p>${escapeHtml(item.caption)}</p>` : "";
      return `<article class="feedback-video-card">
        <button type="button" data-feedback-index="${index}" aria-label="Play video: ${escapeHtml(title)}">
          <img src="${escapeHtml(item.poster)}" alt="" loading="lazy" decoding="async">
          <span class="feedback-video-card__play" aria-hidden="true"><svg class="icon"><use href="#i-play"/></svg></span>
        </button>
        <div class="feedback-video-card__copy"><small>Customer Story</small><h3>${escapeHtml(title)}</h3>${meta}${caption}</div>
      </article>`;
    }).join("");
  };

  grid?.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-feedback-index]");
    if (!trigger) return;
    const item = feedbackVideos[Number(trigger.dataset.feedbackIndex)];
    if (item?.video) openModal(item, trigger);
  });

  closeButton?.addEventListener("click", closeModal);
  modal?.addEventListener("pointerdown", (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener("keydown", (event) => {
    if (!modal || modal.hidden) return;
    if (event.key === "Escape") closeModal();
    if (event.key === "Tab") {
      const controls = [closeButton, player].filter(Boolean);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  render();
})();
