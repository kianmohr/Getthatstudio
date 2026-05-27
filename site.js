const header = document.querySelector(".site-header");
const mobileQuery = window.matchMedia("(max-width: 680px)");
let lastScrollY = window.scrollY;

function syncMobileHeader() {
  if (!header || !mobileQuery.matches) {
    header?.classList.remove("is-hidden");
    lastScrollY = window.scrollY;
    return;
  }

  const currentScrollY = window.scrollY;
  const isScrollingDown = currentScrollY > lastScrollY;
  const hasScrolledPastHeader = currentScrollY > header.offsetHeight + 24;

  header.classList.toggle("is-hidden", isScrollingDown && hasScrolledPastHeader);
  lastScrollY = currentScrollY;
}

window.addEventListener("scroll", syncMobileHeader, { passive: true });
mobileQuery.addEventListener("change", syncMobileHeader);
syncMobileHeader();

const transitionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

document.addEventListener("click", (event) => {
  const link = event.target.closest("a");

  if (
    !link ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.target ||
    link.hasAttribute("download") ||
    transitionQuery.matches
  ) {
    return;
  }

  const url = new URL(link.href, window.location.href);

  if (
    url.origin !== window.location.origin ||
    url.pathname === window.location.pathname && url.hash ||
    url.href === window.location.href
  ) {
    return;
  }

  event.preventDefault();
  document.body.classList.add("is-leaving");
  window.setTimeout(() => {
    window.location.href = url.href;
  }, 170);
});
