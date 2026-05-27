const API_BASE = "https://getthatstudio-production.up.railway.app";

const statusElement = document.querySelector("#service-status");
const serviceGrid = document.querySelector("#service-grid");

if (!statusElement || !serviceGrid) {
  // This script is only needed on the services page.
} else {
  function formatMoney(amount, currency) {
    if (typeof amount !== "number" || !currency) {
      return "Price on request";
    }

    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency
    }).format(amount / 100);
  }

  function formatDuration(durationMinutes) {
    if (!durationMinutes) {
      return "Duration varies";
    }

    if (durationMinutes % 60 === 0) {
      const hours = durationMinutes / 60;
      return `${hours} hr${hours === 1 ? "" : "s"}`;
    }

    if (durationMinutes > 60) {
      const hours = Math.floor(durationMinutes / 60);
      const minutes = durationMinutes % 60;
      return `${hours} hr ${minutes} min`;
    }

    return `${durationMinutes} min`;
  }

  function createServiceCard(service) {
    const article = document.createElement("article");
    article.className = "service-card";
    article.dataset.serviceId = service.serviceVariationId ?? "";

    const title = document.createElement("h3");
    title.textContent = service.name;

    const meta = document.createElement("p");
    meta.className = "service-meta";
    meta.textContent = `${formatDuration(service.durationMinutes)} • ${formatMoney(service.priceAmount, service.currency)}`;

    article.append(title, meta);

    if (service.description) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "service-toggle";
      toggle.textContent = "Read more";
      toggle.addEventListener("click", () => {
        openServiceModal(service);
      });

      article.append(toggle);
    }

    return article;
  }

  function ensureServiceModal() {
    let modal = document.querySelector("#service-modal");

    if (modal) {
      return modal;
    }

    modal = document.createElement("div");
    modal.id = "service-modal";
    modal.className = "service-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="service-modal__backdrop" data-close-modal="true"></div>
      <div class="service-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="service-modal-title">
        <button class="service-modal__close" type="button" aria-label="Close service details">&times;</button>
        <p class="service-modal__eyebrow">Service details</p>
        <h2 id="service-modal-title"></h2>
        <p class="service-modal__meta" id="service-modal-meta"></p>
        <div class="service-modal__body" id="service-modal-body"></div>
      </div>
    `;

    modal.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.dataset.closeModal === "true" || target.classList.contains("service-modal__close")) {
        closeServiceModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeServiceModal();
      }
    });

    document.body.append(modal);
    return modal;
  }

  function openServiceModal(service) {
    const modal = ensureServiceModal();
    const title = modal.querySelector("#service-modal-title");
    const meta = modal.querySelector("#service-modal-meta");
    const body = modal.querySelector("#service-modal-body");

    if (!title || !meta || !body) {
      return;
    }

    title.textContent = service.name;
    meta.textContent = `${formatDuration(service.durationMinutes)} • ${formatMoney(service.priceAmount, service.currency)}`;
    body.textContent = service.description || "No extra details available for this service yet.";

    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeServiceModal() {
    const modal = document.querySelector("#service-modal");

    if (!modal) {
      return;
    }

    modal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  async function loadServices() {
    try {
      const response = await fetch(`${API_BASE}/api/services`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load services");
      }

      if (!Array.isArray(payload.services) || payload.services.length === 0) {
        statusElement.hidden = false;
        statusElement.textContent = payload.message || "No live services found yet. Showing placeholders for now.";
        return;
      }

      serviceGrid.replaceChildren(...payload.services.map(createServiceCard));
      statusElement.hidden = true;
      statusElement.textContent = "";
    } catch (error) {
      statusElement.hidden = false;
      statusElement.textContent = error.message || "Could not load live services. Showing placeholders for now.";
    }
  }

  loadServices();
}
