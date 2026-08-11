(() => {
  "use strict";

  const body = document.body;
  const header = document.querySelector("[data-header]");
  const navToggle = document.querySelector(".nav-toggle");
  const navMenu = document.querySelector(".nav-menu");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const setMenu = (open) => {
    navToggle?.setAttribute("aria-expanded", String(open));
    navToggle?.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    navMenu?.classList.toggle("is-open", open);
    body.classList.toggle("menu-open", open);
  };

  navToggle?.addEventListener("click", () => setMenu(navToggle.getAttribute("aria-expanded") !== "true"));
  navMenu?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 32);
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  window.addEventListener("load", () => {
    window.setTimeout(() => document.querySelector(".preloader")?.classList.add("is-hidden"), reduceMotion ? 0 : 500);
  });

  const revealItems = document.querySelectorAll("[data-reveal]");
  // Opt in to the hidden start state only now that scripting is confirmed working.
  // Without this class the CSS leaves all content visible.
  document.documentElement.classList.add("js-reveal");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    document.documentElement.classList.add("reveal-done");
    revealItems.forEach((item) => item.classList.add("is-visible"));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => revealObserver.observe(item));

    // Failsafe: reveal animations are an enhancement, never a precondition for
    // reading the page. If the observer never fires — throttled tab, zero-height
    // ancestor, stalled compositor — force the finished state and drop the
    // transitions so it applies instantly rather than animating from nothing.
    window.setTimeout(() => {
      revealItems.forEach((item) => item.classList.add("is-visible"));
      document.documentElement.classList.add("reveal-done");
    }, 3000);
  }

  const counters = document.querySelectorAll("[data-counter]");
  const animateCounter = (element) => {
    const target = Number(element.dataset.counter);
    if (reduceMotion) {
      element.textContent = String(target);
      return;
    }
    const duration = 1500;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = String(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if ("IntersectionObserver" in window) {
    const counterObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.7 });
    counters.forEach((counter) => counterObserver.observe(counter));
  } else {
    counters.forEach(animateCounter);
  }

  const moods = {
    soulful: { title: "Soulful", text: "Melodies chosen for moments that call for feeling, warmth, and connection.", accent: "#d6a84f" },
    romantic: { title: "Romantic", text: "Evergreen romantic songs for a tender, timeless atmosphere.", accent: "#c9786d" },
    retro: { title: "Retro", text: "The nostalgic charm of old Bollywood and the golden era's timeless classics.", accent: "#b87735" },
    sufi: { title: "Sufi", text: "Sufi music for moments of depth, devotion, and expression.", accent: "#9d794c" },
    ghazal: { title: "Ghazal", text: "Ghazal selections that bring poetry, grace, and a reflective mood.", accent: "#78908a" },
    unplugged: { title: "Unplugged", text: "Bollywood unplugged for an intimate, close-to-the-music experience.", accent: "#9c805d" },
    energetic: { title: "Energetic", text: "Peppy numbers and live band energy to lift the celebration.", accent: "#cf623c" },
    contemporary: { title: "Contemporary", text: "Contemporary favourites curated for a fresh, modern mood.", accent: "#8a729f" }
  };

  const moodButtons = [...document.querySelectorAll("[data-mood]")];
  const moodTitle = document.querySelector(".mood-player__copy h3");
  const moodText = document.querySelector(".mood-player__copy p");
  const moodNumber = document.querySelector(".mood-player__number");
  const moodDisc = document.querySelector(".mood-player__disc");
  const moodDiscLabel = moodDisc?.querySelector("span");
  moodButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const mood = moods[button.dataset.mood];
      moodButtons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle("is-active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      if (moodTitle) moodTitle.textContent = mood.title;
      if (moodText) moodText.textContent = mood.text;
      if (moodNumber) moodNumber.textContent = `${String(index + 1).padStart(2, "0")} / 08`;
      if (moodDisc) moodDisc.style.borderColor = mood.accent;
      if (moodDiscLabel) moodDiscLabel.textContent = mood.title.toUpperCase();
    });
  });

  const sections = [...document.querySelectorAll("main section[id]")];
  const navLinks = [...document.querySelectorAll('.nav-menu a[href^="#"]')];
  if ("IntersectionObserver" in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
      const activeEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!activeEntry) return;
      navLinks.forEach((link) => link.toggleAttribute("aria-current", link.getAttribute("href") === `#${activeEntry.target.id}`));
    }, { rootMargin: "-28% 0px -58%", threshold: [0, 0.1] });
    sections.forEach((section) => sectionObserver.observe(section));
  }

  const customSelect = document.querySelector("[data-custom-select]");
  const selectField = customSelect?.closest(".field");
  const selectTrigger = customSelect?.querySelector(".custom-select__trigger");
  const selectMenu = customSelect?.querySelector(".custom-select__menu");
  const selectLabel = customSelect?.querySelector("#event-type-value");
  const selectValue = customSelect?.querySelector("[data-event-value]");
  const selectOptions = [...(customSelect?.querySelectorAll('[role="option"]') ?? [])];
  let focusedOptionIndex = 0;

  selectOptions.forEach((option, index) => {
    option.id = `event-type-option-${index}`;
  });

  const focusSelectOption = (index) => {
    if (!selectMenu || !selectOptions.length) return;
    focusedOptionIndex = (index + selectOptions.length) % selectOptions.length;
    selectOptions.forEach((option, optionIndex) => option.classList.toggle("is-focused", optionIndex === focusedOptionIndex));
    selectMenu.setAttribute("aria-activedescendant", selectOptions[focusedOptionIndex].id);
    selectOptions[focusedOptionIndex].scrollIntoView({ block: "nearest" });
  };

  const setSelectOpen = (open, focusMenu = false) => {
    if (!selectTrigger || !selectMenu) return;
    selectTrigger.setAttribute("aria-expanded", String(open));
    selectMenu.hidden = !open;
    selectField?.classList.toggle("is-open", open);
    if (open) {
      const selectedIndex = Math.max(selectOptions.findIndex((option) => option.getAttribute("aria-selected") === "true"), 0);
      focusSelectOption(selectedIndex);
      if (focusMenu) selectMenu.focus();
    }
  };

  const chooseSelectOption = (option) => {
    if (!selectLabel || !selectValue || !selectTrigger) return;
    selectOptions.forEach((item) => item.setAttribute("aria-selected", String(item === option)));
    selectLabel.textContent = option.textContent.trim();
    selectValue.value = option.dataset.value ?? "";
    selectTrigger.removeAttribute("aria-invalid");
    setSelectOpen(false);
    selectTrigger.focus();
  };

  selectTrigger?.addEventListener("click", () => {
    setSelectOpen(selectTrigger.getAttribute("aria-expanded") !== "true", true);
  });

  selectTrigger?.addEventListener("keydown", (event) => {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setSelectOpen(true, true);
      if (event.key === "ArrowDown") focusSelectOption(focusedOptionIndex + 1);
      if (event.key === "ArrowUp") focusSelectOption(focusedOptionIndex - 1);
    }
  });

  selectMenu?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectOpen(false);
      selectTrigger?.focus();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowDown") focusSelectOption(focusedOptionIndex + 1);
      if (event.key === "ArrowUp") focusSelectOption(focusedOptionIndex - 1);
      if (event.key === "Home") focusSelectOption(0);
      if (event.key === "End") focusSelectOption(selectOptions.length - 1);
      return;
    }
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      chooseSelectOption(selectOptions[focusedOptionIndex]);
    }
  });

  selectOptions.forEach((option, index) => {
    option.addEventListener("pointermove", () => focusSelectOption(index));
    option.addEventListener("click", () => chooseSelectOption(option));
  });

  document.addEventListener("pointerdown", (event) => {
    if (customSelect && !customSelect.contains(event.target)) setSelectOpen(false);
  });

  // Enquiry submission lives in js/booking.js, which posts to the Supabase Edge Function.
  // This file owns only the presentation layer of the form (the custom event-type select).

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  if (finePointer && !reduceMotion) {
    const cursor = document.querySelector(".custom-cursor");
    let cursorFrame = 0;
    let pointerX = -100;
    let pointerY = -100;
    const drawCursor = () => {
      cursorFrame = 0;
      if (!cursor) return;
      cursor.style.left = `${pointerX}px`;
      cursor.style.top = `${pointerY}px`;
    };
    document.addEventListener("pointermove", (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      cursor?.classList.add("is-visible");
      if (!cursorFrame) cursorFrame = requestAnimationFrame(drawCursor);
    }, { passive: true });
    document.documentElement.addEventListener("mouseleave", () => cursor?.classList.remove("is-visible"));

    const interactiveItems = document.querySelectorAll("a, button, input, textarea, .genre-card, .event-card, .social-card, .legend-list span");
    interactiveItems.forEach((item) => {
      item.addEventListener("mouseenter", () => cursor?.classList.add("is-active"));
      item.addEventListener("mouseleave", () => cursor?.classList.remove("is-active"));
    });

    document.querySelectorAll(".genre-card, .event-card, .social-card").forEach((surface) => {
      surface.addEventListener("pointermove", (event) => {
        const bounds = surface.getBoundingClientRect();
        surface.style.setProperty("--mouse-x", `${event.clientX - bounds.left}px`);
        surface.style.setProperty("--mouse-y", `${event.clientY - bounds.top}px`);
      }, { passive: true });
    });
  }
})();
