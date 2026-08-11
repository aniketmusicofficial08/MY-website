/* Showreel video modal + photo lightbox.
 *
 * Videos carry preload="none" and no src until opened, so the page costs nothing in
 * bandwidth until a visitor deliberately chooses a clip. Only one video can ever play:
 * the element is torn down on close. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --------------------------------------------------------- modal plumbing */

  let lastFocused = null;

  const focusables = (root) =>
    [...root.querySelectorAll('button, [href], video, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.hidden && el.offsetParent !== null);

  /* `trigger` is passed explicitly rather than read from document.activeElement, which is
     not reliably the button that opened the modal. */
  function openModal(modal, trigger) {
    lastFocused = trigger instanceof HTMLElement ? trigger : document.activeElement;
    modal.hidden = false;
    document.body.classList.add("menu-open");        // reuses the existing scroll lock
    const first = focusables(modal)[0];
    first?.focus();
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.classList.remove("menu-open");
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  function trapFocus(modal, event) {
    if (event.key !== "Tab") return;
    const items = focusables(modal);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------------------------------------- video modal */

  const videoModal = document.querySelector("[data-video-modal]");
  const videoEl = videoModal?.querySelector("[data-modal-video]");
  const videoCaption = videoModal?.querySelector("[data-modal-caption]");

  function closeVideo() {
    if (!videoModal || !videoEl) return;
    videoEl.pause();
    // Dropping the source releases the buffer and guarantees nothing keeps streaming.
    videoEl.removeAttribute("src");
    videoEl.load();
    closeModal(videoModal);
  }

  document.querySelectorAll("[data-video]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      if (!videoModal || !videoEl) return;
      videoEl.src = trigger.dataset.video;
      videoEl.poster = trigger.dataset.poster ?? "";
      if (videoCaption) videoCaption.textContent = trigger.dataset.label ?? "";
      openModal(videoModal, trigger);
      videoEl.focus();
      // Manual open: play because the visitor asked for it, but never with surprise audio.
      videoEl.play().catch(() => { /* autoplay policy — controls are available */ });
    });
  });

  /* ---------------------------------------------------------------- lightbox */

  const lightbox = document.querySelector("[data-lightbox]");
  const lightboxImg = lightbox?.querySelector("[data-lightbox-img]");
  const lightboxCaption = lightbox?.querySelector("[data-lightbox-caption]");
  const shots = [...document.querySelectorAll("[data-shot]")];
  let shotIndex = 0;

  function showShot(index) {
    if (!shots.length || !lightboxImg) return;
    shotIndex = (index + shots.length) % shots.length;
    const shot = shots[shotIndex];
    lightboxImg.src = shot.dataset.full;
    lightboxImg.alt = shot.querySelector("img")?.alt ?? "";
    if (lightboxCaption) {
      lightboxCaption.textContent =
        `${shot.dataset.caption ?? ""} — ${shotIndex + 1} of ${shots.length}`;
    }
  }

  shots.forEach((shot, index) => {
    shot.addEventListener("click", () => {
      if (!lightbox) return;
      showShot(index);
      openModal(lightbox, shot);
    });
  });

  lightbox?.querySelector("[data-lightbox-prev]")?.addEventListener("click", () => showShot(shotIndex - 1));
  lightbox?.querySelector("[data-lightbox-next]")?.addEventListener("click", () => showShot(shotIndex + 1));

  /* ------------------------------------------------------------- shared events */

  document.querySelectorAll("[data-modal-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = btn.closest(".media-modal");
      if (modal === videoModal) closeVideo();
      else if (modal) closeModal(modal);
    });
  });

  // Backdrop click closes, but clicks on the media itself must not.
  document.querySelectorAll(".media-modal").forEach((modal) => {
    modal.addEventListener("pointerdown", (event) => {
      if (event.target !== modal) return;
      if (modal === videoModal) closeVideo();
      else closeModal(modal);
    });
  });

  document.addEventListener("keydown", (event) => {
    const openOne = [videoModal, lightbox].find((m) => m && !m.hidden);
    if (!openOne) return;

    if (event.key === "Escape") {
      if (openOne === videoModal) closeVideo();
      else closeModal(openOne);
      return;
    }
    if (openOne === lightbox) {
      if (event.key === "ArrowLeft") { event.preventDefault(); showShot(shotIndex - 1); }
      if (event.key === "ArrowRight") { event.preventDefault(); showShot(shotIndex + 1); }
    }
    trapFocus(openOne, event);
  });

  /* --------------------------------------------------- swipe on the lightbox */

  if (lightbox) {
    let startX = null;
    lightbox.addEventListener("touchstart", (e) => { startX = e.changedTouches[0].clientX; }, { passive: true });
    lightbox.addEventListener("touchend", (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 45) showShot(dx > 0 ? shotIndex - 1 : shotIndex + 1);
      startX = null;
    }, { passive: true });
  }

  /* ------------------------------------------------- pointer light on media cards */

  if (!reduceMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.querySelectorAll(".reel, .shot").forEach((card) => {
      card.addEventListener("pointermove", (event) => {
        const b = card.getBoundingClientRect();
        card.style.setProperty("--mouse-x", `${event.clientX - b.left}px`);
        card.style.setProperty("--mouse-y", `${event.clientY - b.top}px`);
      }, { passive: true });
    });
  }
})();
