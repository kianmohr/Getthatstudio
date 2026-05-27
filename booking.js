const API_BASE = "https://getthatstudio-production.up.railway.app";

const root = document.querySelector("#booking-app");
const consentDocument = {
  title: "GET THAT BOD Client Consultation, Informed Consent & Liability Waiver",
  url: "assets/GET_THAT_BOD_Consent_Read_Only_v2.pdf"
};

if (root) {
  const state = {
    bootstrap: null,
    selectedAvailability: null,
    waiverAccepted: false,
    waiverRecord: null,
    signatureHasInk: false,
    bookingCreated: null
  };

  const elements = {
    support: document.querySelector("#booking-support"),
    service: document.querySelector("#booking-service"),
    teamMember: document.querySelector("#booking-team-member"),
    date: document.querySelector("#booking-date"),
    location: document.querySelector("#booking-location"),
    searchButton: document.querySelector("#booking-search"),
    availabilityStatus: document.querySelector("#availability-status"),
    availabilityGrid: document.querySelector("#availability-grid"),
    waiverStep: document.querySelector("#waiver-step"),
    waiverStatus: document.querySelector("#waiver-status"),
    consentRequiredFields: Array.from(document.querySelectorAll("[data-consent-required]")),
    consentOptionalFields: Array.from(document.querySelectorAll("[data-consent-optional]")),
    waiverSignerName: document.querySelector("#waiver-signer-name"),
    signatureCanvas: document.querySelector("#waiver-signature"),
    signatureClear: document.querySelector("#signature-clear"),
    waiverCheckbox: document.querySelector("#waiver-acknowledgement"),
    waiverContinue: document.querySelector("#waiver-continue"),
    waiverDownload: document.querySelector("#waiver-download"),
    bookStep: document.querySelector("#book-step"),
    bookStepStatus: document.querySelector("#book-step-status"),
    customerForm: document.querySelector("#booking-customer-form"),
    bookingStatus: document.querySelector("#booking-status"),
    submitButton: document.querySelector("#booking-submit"),
    payStep: document.querySelector("#pay-step"),
    payStepStatus: document.querySelector("#pay-step-status"),
    payStepCopy: document.querySelector("#pay-step-copy"),
    paymentContinue: document.querySelector("#payment-continue"),
    appointmentTabs: Array.from(document.querySelectorAll("[data-appointment-tab]"))
  };

  function formatMoney(amount, currency) {
    if (typeof amount !== "number" || !currency) {
      return "Price on request";
    }

    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency
    }).format(amount / 100);
  }

  function formatDuration(minutes) {
    if (!minutes) {
      return "Duration varies";
    }

    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return `${hours} hr${hours === 1 ? "" : "s"}`;
    }

    if (minutes > 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours} hr ${remainingMinutes} min`;
    }

    return `${minutes} min`;
  }

  function formatStart(isoString) {
    return new Intl.DateTimeFormat("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(isoString));
  }

  function setStatus(element, text, tone = "muted") {
    element.textContent = text;
    element.dataset.tone = tone;
  }

  async function readApiPayload(response, fallbackMessage) {
    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new Error(`${fallbackMessage} Make sure the site is running through \`npm run dev\`, not opened directly as a file.`);
      }

      throw new Error(fallbackMessage);
    }
  }

  function setStepLocked(element, locked) {
    element.classList.toggle("is-locked", locked);
    element.setAttribute("aria-disabled", String(locked));
  }

  function activateAppointmentTab(targetId) {
    for (const tab of elements.appointmentTabs) {
      tab.classList.toggle("is-active", tab.dataset.appointmentTab === targetId);
    }
  }

  function setupAppointmentTabs() {
    for (const tab of elements.appointmentTabs) {
      tab.addEventListener("click", () => {
        const targetId = tab.dataset.appointmentTab;
        const target = document.querySelector(`#${targetId}`);

        if (!target) {
          return;
        }

        activateAppointmentTab(targetId);
        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }
  }

  function getSelectedServiceLabel() {
    return elements.service.selectedOptions[0]?.textContent ?? "";
  }

  function getSelectedLocationLabel() {
    return elements.location.selectedOptions[0]?.textContent ?? "";
  }

  function getConsentSelections() {
    return [...elements.consentRequiredFields, ...elements.consentOptionalFields].map((field) => ({
      id: field.value,
      label: field.dataset.consentLabel,
      required: field.hasAttribute("data-consent-required"),
      checked: field.checked
    }));
  }

  function resizeSignatureCanvas() {
    const canvas = elements.signatureCanvas;
    const context = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.6;
    context.strokeStyle = "#171311";
  }

  function clearSignature() {
    const canvas = elements.signatureCanvas;
    const context = canvas.getContext("2d");

    context.clearRect(0, 0, canvas.width, canvas.height);
    state.signatureHasInk = false;
  }

  function setupSignaturePad() {
    const canvas = elements.signatureCanvas;
    let isDrawing = false;
    let lastPoint = null;

    function getPoint(event) {
      const rect = canvas.getBoundingClientRect();

      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    }

    function drawTo(point) {
      const context = canvas.getContext("2d");

      if (!lastPoint) {
        lastPoint = point;
      }

      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      lastPoint = point;
      state.signatureHasInk = true;
    }

    canvas.addEventListener("pointerdown", (event) => {
      isDrawing = true;
      lastPoint = getPoint(event);
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!isDrawing) {
        return;
      }

      drawTo(getPoint(event));
    });

    canvas.addEventListener("pointerup", (event) => {
      isDrawing = false;
      lastPoint = null;
      canvas.releasePointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointercancel", () => {
      isDrawing = false;
      lastPoint = null;
    });

    elements.signatureClear.addEventListener("click", () => {
      clearSignature();
      state.waiverAccepted = false;
      state.waiverRecord = null;
      setStatus(elements.waiverStatus, "Signature cleared. Sign again to continue.", "muted");
      syncFlowState();
    });

    resizeSignatureCanvas();
    window.addEventListener("resize", () => {
      resizeSignatureCanvas();
      state.signatureHasInk = false;
    });
  }

  function syncFlowState() {
    const hasAvailability = Boolean(state.selectedAvailability);
    const canBook = hasAvailability && state.waiverAccepted;
    const canPay = Boolean(state.bookingCreated);

    setStepLocked(elements.waiverStep, !hasAvailability);
    setStepLocked(elements.bookStep, !canBook);
    setStepLocked(elements.payStep, !canPay);

    if (!hasAvailability) {
      setStatus(elements.waiverStatus, "Choose a live time to unlock the waiver step.", "muted");
      setStatus(elements.bookStepStatus, "Availability and waiver must be completed before booking.", "muted");
    } else if (!state.waiverAccepted) {
      setStatus(elements.bookStepStatus, "Complete the waiver step to unlock booking.", "muted");
    } else {
      setStatus(elements.bookStepStatus, "Waiver cleared. Booking is now unlocked.", "success");
    }

    if (!canPay) {
      setStatus(elements.payStepStatus, "Payment unlocks after the booking is confirmed.", "muted");
      elements.paymentContinue.disabled = true;
    } else {
      setStatus(elements.payStepStatus, "Booking confirmed. Payment is now the next step.", "success");
      elements.paymentContinue.disabled = false;
    }
  }

  function resetDownstreamState() {
    state.waiverAccepted = false;
    state.waiverRecord = null;
    state.signatureHasInk = false;
    state.bookingCreated = null;
    elements.waiverSignerName.value = "";
    elements.waiverCheckbox.checked = false;
    elements.waiverDownload.hidden = true;
    elements.waiverDownload.removeAttribute("href");
    elements.waiverDownload.removeAttribute("download");
    for (const field of [...elements.consentRequiredFields, ...elements.consentOptionalFields]) {
      field.checked = false;
    }
    clearSignature();
    elements.customerForm.reset();
    elements.payStepCopy.textContent =
      "Once the booking is successfully created, this step is where payment or on-site payment collection will continue.";
    setStatus(elements.bookingStatus, "Complete the earlier steps to continue.", "muted");
    syncFlowState();
  }

  function setDefaultDate() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    elements.date.value = `${date.getFullYear()}-${month}-${day}`;
  }

  function populateBootstrap(data) {
    state.bootstrap = data;

    elements.service.replaceChildren(...data.services.map((service) => {
      const option = document.createElement("option");
      option.value = service.serviceVariationId;
      option.textContent = `${service.name} - ${formatDuration(service.durationMinutes)} - ${formatMoney(service.priceAmount, service.currency)}`;
      option.dataset.version = service.version ?? "";
      option.dataset.name = service.name;
      return option;
    }));

    const teamOptions = [];

    if (data.bookingProfile.anyTeamMemberBookingEnabled) {
      const anyOption = document.createElement("option");
      anyOption.value = "";
      anyOption.textContent = "Any available team member";
      teamOptions.push(anyOption);
    }

    for (const teamMember of data.teamMembers) {
      const option = document.createElement("option");
      option.value = teamMember.id;
      option.textContent = teamMember.name;
      teamOptions.push(option);
    }

    elements.teamMember.replaceChildren(...teamOptions);

    elements.location.replaceChildren(...data.locations.map((location) => {
      const option = document.createElement("option");
      option.value = location.id;
      option.textContent = location.name;
      return option;
    }));

    if (!data.bookingProfile.supportsSellerLevelWrites) {
      setStatus(elements.support, "Live times are available, but bookings cannot be created through the website yet.", "warning");
      elements.submitButton.disabled = true;
    } else {
      setStatus(elements.support, "Use the tabs here to search live times and create the booking on this webpage.", "success");
      elements.submitButton.disabled = false;
    }

    syncFlowState();
  }

  function renderAvailabilities(availabilities) {
    state.selectedAvailability = null;
    elements.availabilityGrid.replaceChildren();
    resetDownstreamState();

    if (!availabilities.length) {
      setStatus(elements.availabilityStatus, "No times available for that date. Try another day or service.", "warning");
      return;
    }

    setStatus(elements.availabilityStatus, `Found ${availabilities.length} available time${availabilities.length === 1 ? "" : "s"}.`, "success");

    for (const availability of availabilities) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "availability-slot";
      button.textContent = formatStart(availability.start_at);

      button.addEventListener("click", () => {
        state.selectedAvailability = availability;
        for (const activeButton of elements.availabilityGrid.querySelectorAll(".availability-slot")) {
          activeButton.classList.remove("is-selected");
        }
        button.classList.add("is-selected");
        resetDownstreamState();
        setStatus(elements.waiverStatus, `Your appointment time is reserved for ${formatStart(availability.start_at)}. Please review and sign the consent below to continue.`, "success");
        syncFlowState();
      });

      elements.availabilityGrid.append(button);
    }
  }

  async function loadBootstrap() {
    setStatus(elements.support, "Loading booking settings...", "muted");

    const response = await fetch(`${API_BASE}/api/bookings/bootstrap`);
    const payload = await readApiPayload(response, "Could not load booking setup.");

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load booking setup");
    }

    populateBootstrap(payload);
  }

  async function searchAvailability() {
    setStatus(elements.availabilityStatus, "Searching live availability...", "muted");
    elements.availabilityGrid.replaceChildren();
    state.selectedAvailability = null;
    resetDownstreamState();

    const response = await fetch(`${API_BASE}/api/bookings/availability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        serviceVariationId: elements.service.value,
        teamMemberId: elements.teamMember.value,
        locationId: elements.location.value,
        date: elements.date.value
      })
    });

    const payload = await readApiPayload(response, "Could not search availability.");

    if (!response.ok) {
      throw new Error(payload.error || "Failed to search availability");
    }

    renderAvailabilities(payload.availabilities ?? []);
  }

  async function continueWaiver() {
    if (!state.selectedAvailability) {
      setStatus(elements.waiverStatus, "Choose a live time first.", "warning");
      return;
    }

    const signerName = elements.waiverSignerName.value.trim();
    const missingRequiredConsent = elements.consentRequiredFields.find((field) => !field.checked);

    if (missingRequiredConsent) {
      setStatus(elements.waiverStatus, "Tick each required consent box before signing.", "warning");
      return;
    }

    if (!signerName) {
      setStatus(elements.waiverStatus, "Enter the client's full legal name before signing.", "warning");
      return;
    }

    if (!state.signatureHasInk) {
      setStatus(elements.waiverStatus, "Draw the client's signature in the signature box.", "warning");
      return;
    }

    if (!elements.waiverCheckbox.checked) {
      setStatus(elements.waiverStatus, "Tick the electronic signature consent before continuing.", "warning");
      return;
    }

    setStatus(elements.waiverStatus, "Saving signed waiver...", "muted");

    const response = await fetch(`${API_BASE}/api/waivers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        signerName,
        signatureDataUrl: elements.signatureCanvas.toDataURL("image/png"),
        service: getSelectedServiceLabel(),
        serviceVariationId: elements.service.value,
        location: getSelectedLocationLabel(),
        locationId: elements.location.value,
        appointmentStartAt: state.selectedAvailability.start_at,
        consentDocument,
        selections: getConsentSelections(),
        terms: [
          "Client has reviewed the GET THAT BOD consultation, informed consent, and liability waiver.",
          "Client consents to sign the waiver electronically before booking proceeds."
        ]
      })
    });
    const payload = await readApiPayload(response, "Could not save the signed waiver.");

    if (!response.ok) {
      throw new Error(payload.error || "Could not save the signed waiver.");
    }

    state.waiverRecord = payload.waiver;
    state.waiverAccepted = true;

    const downloadUrl = `${API_BASE}${payload.waiver.downloadUrl}`;
    const fileName = payload.waiver.fileName;

    elements.waiverDownload.hidden = false;
    elements.waiverDownload.href = "#";
    elements.waiverDownload.removeAttribute("download");
    elements.waiverDownload.onclick = async (event) => {
      event.preventDefault();
      try {
        const fileResponse = await fetch(downloadUrl);
        const blob = await fileResponse.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(blobUrl);
      } catch {
        alert("Could not download the waiver. Please try again.");
      }
    };
    setStatus(elements.waiverStatus, `Signed waiver saved. Download a copy for your records, then continue booking.`, "success");
    setStatus(elements.bookingStatus, "Enter the client details and create the booking.", "muted");
    syncFlowState();
  }

  async function createBooking(event) {
    event.preventDefault();

    if (!state.selectedAvailability) {
      setStatus(elements.bookingStatus, "Choose a time first.", "warning");
      return;
    }

    if (!state.waiverAccepted) {
      setStatus(elements.bookingStatus, "Complete the waiver step before booking.", "warning");
      return;
    }

    setStatus(elements.bookingStatus, "Sending the booking request...", "muted");

    const formData = new FormData(elements.customerForm);
    const response = await fetch(`${API_BASE}/api/bookings/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
        phone: formData.get("phone"),
        locationId: elements.location.value,
        waiverId: state.waiverRecord?.id,
        availability: state.selectedAvailability
      })
    });

    const payload = await readApiPayload(response, "Could not create booking.");

    if (!response.ok) {
      setStatus(elements.bookingStatus, payload.error || "Booking failed.", "warning");
      setStatus(elements.payStepStatus, "Payment cannot continue until the booking is successfully created.", "warning");
      return;
    }

    state.bookingCreated = payload.booking;
    setStatus(elements.bookingStatus, `Booking created for ${formatStart(payload.booking.start_at)}.`, "success");
    setStatus(elements.payStepStatus, "Booking confirmed. Payment is now the next step.", "success");
    elements.payStepCopy.textContent =
      `The booking for ${formatStart(payload.booking.start_at)} is confirmed. The next step is to launch payment from this website after booking confirmation.`;
    syncFlowState();
  }

  elements.searchButton.addEventListener("click", async () => {
    try {
      activateAppointmentTab("availability-panel");
      await searchAvailability();
    } catch (error) {
      setStatus(elements.availabilityStatus, error.message || "Could not search availability.", "warning");
    }
  });

  elements.waiverContinue.addEventListener("click", async () => {
    try {
      await continueWaiver();
    } catch (error) {
      setStatus(elements.waiverStatus, error.message || "Could not save the signed waiver.", "warning");
    }
  });

  elements.customerForm.addEventListener("submit", async (event) => {
    try {
      await createBooking(event);
    } catch (error) {
      setStatus(elements.bookingStatus, error.message || "Could not create booking.", "warning");
    }
  });

  elements.paymentContinue.addEventListener("click", () => {
    setStatus(
      elements.payStepStatus,
      "Payment is the next integration step. We still need to connect the payment flow after booking confirmation.",
      "warning"
    );
  });

  setDefaultDate();
  setupAppointmentTabs();
  setupSignaturePad();
  resetDownstreamState();
  loadBootstrap().catch((error) => {
    setStatus(elements.support, error.message || "Could not load booking setup.", "warning");
  });
}
