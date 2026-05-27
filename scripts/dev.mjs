import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const waiverDir = path.join(rootDir, "data", "waivers");
const signedWaiverDir = path.join(rootDir, "data", "signed-waivers");
const squareApiVersion = "2026-01-22";

const targetDir = process.argv[2] ? path.resolve(rootDir, process.argv[2]) : rootDir;
const port = Number(process.argv[3] ?? process.env.PORT ?? 3000);

async function loadDotEnv() {
  try {
    const contents = await readFile(path.join(rootDir, ".env"), "utf8");

    for (const line of contents.split(/\r?\n/u)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");

      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();

      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // `.env` is optional in local development.
  }
}

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const safePath = decodedPath === "/" ? "/index.html" : decodedPath;
  const fullPath = path.normalize(path.join(targetDir, safePath));

  if (!fullPath.startsWith(targetDir)) {
    return null;
  }

  return fullPath;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function writePdfDownload(response, filePath, fileName) {
  response.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${fileName}"`
  });
  createReadStream(filePath).pipe(response);
}

function getSquareConfig() {
  const accessToken = (process.env.SQUARE_ACCESS_TOKEN ?? "").trim();
  const environment = (process.env.SQUARE_ENVIRONMENT ?? "").trim().toLowerCase();
  const applicationId = (process.env.SQUARE_APPLICATION_ID ?? "").trim();
  const isSandbox = environment === "sandbox" || (!environment && applicationId.startsWith("sandbox-"));

  return {
    accessToken,
    applicationId,
    environment: isSandbox ? "sandbox" : "production",
    apiBaseUrl: isSandbox ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2"
  };
}

async function squareRequest(requestPath, options = {}) {
  const { accessToken, apiBaseUrl } = getSquareConfig();

  if (!accessToken) {
    throw new Error("Booking access is not configured yet.");
  }

  const response = await fetch(`${apiBaseUrl}${requestPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": squareApiVersion,
      ...(options.headers ?? {})
    }
  });

  const payload = await response.json();

  if (!response.ok) {
    const detail = payload.errors?.[0]?.detail ?? payload.errors?.[0]?.code ?? "Booking request failed";
    const error = new Error(detail);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function toServiceRecord(item, variation) {
  const variationData = variation.item_variation_data ?? {};
  const itemData = item.item_data ?? {};
  const serviceDurationMs = variationData.service_duration;
  const durationMinutes = typeof serviceDurationMs === "number"
    ? Math.round(serviceDurationMs / 60000)
    : null;

  return {
    id: item.id,
    name: itemData.name ?? "Untitled service",
    description: itemData.description ?? "",
    serviceVariationId: variation.id,
    durationMinutes,
    priceAmount: variationData.price_money?.amount ?? null,
    currency: variationData.price_money?.currency ?? "AUD",
    version: variation.version ?? null
  };
}

async function fetchSquareServices() {
  const payload = await squareRequest("/catalog/list?types=ITEM");
  const objects = Array.isArray(payload.objects) ? payload.objects : [];

  const services = objects
    .filter((object) => object.type === "ITEM" && object.item_data?.product_type === "APPOINTMENTS_SERVICE")
    .flatMap((item) => {
      const variations = Array.isArray(item.item_data?.variations) ? item.item_data.variations : [];

      return variations
        .filter((variation) => variation.item_variation_data?.available_for_booking !== false)
        .map((variation) => toServiceRecord(item, variation));
    });

  return {
    services
  };
}

async function fetchBookingBootstrap() {
  const [servicePayload, businessPayload, locationsPayload, locationProfilesPayload, teamProfilesPayload] = await Promise.all([
    fetchSquareServices(),
    squareRequest("/bookings/business-booking-profile"),
    squareRequest("/locations"),
    squareRequest("/bookings/location-booking-profiles"),
    squareRequest("/bookings/team-member-booking-profiles?bookable_only=true")
  ]);

  const locations = Array.isArray(locationsPayload.locations) ? locationsPayload.locations : [];
  const locationProfiles = Array.isArray(locationProfilesPayload.location_booking_profiles)
    ? locationProfilesPayload.location_booking_profiles
    : [];
  const bookableLocationMap = new Map(
    locationProfiles
      .filter((profile) => profile.booking_enabled || profile.online_booking_enabled)
      .map((profile) => [profile.location_id, profile])
  );

  const enabledLocations = locations
    .filter((location) => location.status === "ACTIVE" && bookableLocationMap.has(location.id))
    .map((location) => ({
      id: location.id,
      name: location.name,
      timezone: location.timezone,
      bookingSiteUrl: bookableLocationMap.get(location.id)?.booking_site_url ?? ""
    }));

  const teamMembers = (teamProfilesPayload.team_member_booking_profiles ?? []).map((profile) => ({
    id: profile.team_member_id,
    name: profile.display_name,
    imageUrl: profile.profile_image_url ?? ""
  }));

  return {
    services: servicePayload.services,
    locations: enabledLocations,
    teamMembers,
    bookingProfile: {
      bookingEnabled: businessPayload.business_booking_profile?.booking_enabled ?? false,
      supportsSellerLevelWrites: businessPayload.business_booking_profile?.support_seller_level_writes ?? false,
      anyTeamMemberBookingEnabled:
        businessPayload.business_booking_profile?.business_appointment_settings?.any_team_member_booking_enabled ?? false,
      minLeadTimeSeconds:
        businessPayload.business_booking_profile?.business_appointment_settings?.min_booking_lead_time_seconds ?? 0,
      cancellationPolicyText:
        businessPayload.business_booking_profile?.business_appointment_settings?.cancellation_policy_text ?? "",
      bookingPolicy: businessPayload.business_booking_profile?.booking_policy ?? "ACCEPT_ALL"
    }
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";

    request.on("data", (chunk) => {
      data += chunk;
    });

    request.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function toUtcRange(dateText) {
  if (!dateText) {
    throw new Error("A booking date is required.");
  }

  const start = new Date(`${dateText}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    startAt: start.toISOString(),
    endAt: end.toISOString()
  };
}

async function searchSquareAvailability({ locationId, serviceVariationId, teamMemberId, date }) {
  const { startAt, endAt } = toUtcRange(date);
  const segmentFilter = {
    service_variation_id: serviceVariationId
  };

  if (teamMemberId) {
    segmentFilter.team_member_id_filter = {
      any: [teamMemberId]
    };
  }

  const payload = await squareRequest("/bookings/availability/search", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: {
          location_id: locationId,
          start_at_range: {
            start_at: startAt,
            end_at: endAt
          },
          segment_filters: [segmentFilter]
        }
      }
    })
  });

  return {
    availabilities: payload.availabilities ?? []
  };
}

async function createSquareCustomer({ firstName, lastName, email, phone }) {
  const payload = await squareRequest("/customers", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      given_name: firstName,
      family_name: lastName,
      email_address: email,
      phone_number: phone
    })
  });

  return payload.customer;
}

async function createSquareBooking({ customer, availability, locationId, waiverId }) {
  const segment = availability?.appointment_segments?.[0];

  if (!segment?.team_member_id || !segment?.service_variation_id || !segment?.service_variation_version || !availability?.start_at) {
    throw new Error("Selected availability is missing required booking fields.");
  }

  const bookingPayload = await squareRequest("/bookings", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      booking: {
        location_id: locationId,
        customer_id: customer.id,
        customer_note: waiverId
          ? `Booked from the GetthatBod website. Signed waiver record: ${waiverId}.`
          : "Booked from the GetthatBod website.",
        start_at: availability.start_at,
        appointment_segments: [
          {
            team_member_id: segment.team_member_id,
            service_variation_id: segment.service_variation_id,
            service_variation_version: segment.service_variation_version
          }
        ]
      }
    })
  });

  return bookingPayload.booking;
}

function assertText(value, fieldName) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) {
    throw new Error(`${fieldName} is required.`);
  }

  return text;
}

function assertSignatureDataUrl(value) {
  const signatureDataUrl = assertText(value, "Signature");

  if (!signatureDataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("Signature must be a PNG data URL.");
  }

  return signatureDataUrl;
}

function slugifyName(name) {
  const slug = name
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "Client";
}

function parseConsentSelections(value) {
  if (!Array.isArray(value)) {
    throw new Error("Consent selections are required.");
  }

  const selections = value.map((selection) => ({
    id: assertText(selection.id, "Consent selection ID"),
    label: assertText(selection.label, "Consent selection label"),
    required: Boolean(selection.required),
    checked: Boolean(selection.checked)
  }));
  const missingRequired = selections.find((selection) => selection.required && !selection.checked);

  if (missingRequired) {
    throw new Error("All required consent selections must be checked.");
  }

  return selections;
}

function signatureDataUrlToBytes(signatureDataUrl) {
  return Buffer.from(signatureDataUrl.replace(/^data:image\/png;base64,/u, ""), "base64");
}

const consentSections = [
  {
    title: "Treatment information",
    paragraphs: [
      "Fat Cavitation, Radio Frequency Skin Tightening, and EMS Sculpt are non-invasive cosmetic treatments designed to assist with body contouring, skin tightening, and muscle toning.",
      "These treatments are cosmetic procedures only and are not intended to diagnose, treat, cure, or prevent any medical condition.",
      "Results vary between individuals and no guarantees have been made regarding treatment outcomes. Multiple sessions may be recommended to achieve desired results."
    ]
  },
  {
    title: "Medical disclosure",
    paragraphs: [
      "By proceeding with treatment, clients acknowledge that they have disclosed all relevant medical conditions, medications, allergies, injuries, implants, and other health-related information that may impact treatment safety.",
      "Clients acknowledge that withholding medical information may increase the risk of adverse reactions and may affect treatment safety."
    ]
  },
  {
    title: "Possible risks & side effects",
    paragraphs: [
      "Possible side effects and risks associated with these cosmetic treatments may include, but are not limited to: temporary redness, mild swelling, muscle soreness or fatigue, tingling sensations, mild cramping, temporary tenderness, skin sensitivity, and temporary discomfort during treatment.",
      "Although uncommon, adverse reactions may occur."
    ]
  },
  {
    title: "Client acknowledgement & consent",
    paragraphs: [
      "Clients acknowledge that they have read and understood the information provided regarding treatment procedures, risks, possible side effects, expected outcomes, and aftercare recommendations.",
      "Clients understand that treatment outcomes vary between individuals and that no guarantees or warranties have been made regarding results.",
      "Clients understand that multiple sessions may be required for optimal outcomes and that practitioners reserve the right to refuse or discontinue treatment where contraindications or safety concerns exist."
    ]
  },
  {
    title: "Liability waiver",
    paragraphs: [
      "Clients acknowledge that they are voluntarily undergoing cosmetic treatment at GET THAT BOD at their own risk.",
      "GET THAT BOD, its owners, employees, contractors, and practitioners are not liable for adverse reactions, injury, loss, or complications arising from treatment except where caused by negligence or unlawful conduct.",
      "Clients confirm that all information provided prior to treatment is true and accurate to the best of their knowledge."
    ]
  },
  {
    title: "Photo & media consent",
    paragraphs: [
      "Clients may be asked separately for consent regarding treatment photos, videos, and marketing material usage."
    ]
  }
];

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Adelaide"
  }).format(new Date(value));
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/u);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) {
      lines.push(line);
    }

    line = word;
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

function drawCheckbox(page, { x, y, checked, label, font, size = 10 }) {
  page.drawRectangle({
    x,
    y: y - 2,
    width: 11,
    height: 11,
    borderColor: rgb(0.1, 0.08, 0.07),
    borderWidth: 1
  });

  if (checked) {
    page.drawText("X", {
      x: x + 2.4,
      y: y - 0.5,
      size: 8,
      font,
      color: rgb(0.1, 0.08, 0.07)
    });
  }

  page.drawText(label, {
    x: x + 18,
    y,
    size,
    font,
    color: rgb(0.1, 0.08, 0.07),
    maxWidth: 485,
    lineHeight: size + 4
  });
}

function drawWrappedText(page, text, { x, y, font, size, maxWidth, lineHeight, color }) {
  const lines = wrapText(text, font, size, maxWidth);

  for (const line of lines) {
    page.drawText(line, {
      x,
      y,
      size,
      font,
      color
    });
    y -= lineHeight;
  }

  return y;
}

function createPdfPage(pdf) {
  const page = pdf.addPage();
  const { width, height } = page.getSize();

  return {
    page,
    width,
    height
  };
}

function ensureSpace(pdf, pageState, requiredHeight, margin) {
  if (pageState.y - requiredHeight >= margin) {
    return pageState;
  }

  const nextPage = createPdfPage(pdf);

  return {
    ...nextPage,
    y: nextPage.height - margin
  };
}

function drawConsentDocument(pdf, fonts, margin) {
  const textColor = rgb(0.1, 0.08, 0.07);
  const mutedColor = rgb(0.34, 0.29, 0.26);
  let pageState = createPdfPage(pdf);
  pageState.y = pageState.height - margin;

  pageState.page.drawText("GET THAT BOD", {
    x: margin,
    y: pageState.y,
    size: 20,
    font: fonts.bold,
    color: textColor
  });
  pageState.y -= 24;
  pageState.page.drawText("Client Consultation, Informed Consent & Liability Waiver", {
    x: margin,
    y: pageState.y,
    size: 13,
    font: fonts.bold,
    color: mutedColor
  });
  pageState.y -= 32;

  for (const section of consentSections) {
    pageState = ensureSpace(pdf, pageState, 72, margin);
    pageState.page.drawText(section.title, {
      x: margin,
      y: pageState.y,
      size: 12,
      font: fonts.bold,
      color: textColor
    });
    pageState.y -= 18;

    for (const paragraph of section.paragraphs) {
      pageState = ensureSpace(pdf, pageState, 48, margin);
      pageState.y = drawWrappedText(pageState.page, paragraph, {
        x: margin,
        y: pageState.y,
        font: fonts.regular,
        size: 10,
        maxWidth: pageState.width - margin * 2,
        lineHeight: 14,
        color: mutedColor
      });
      pageState.y -= 8;
    }

    pageState.y -= 6;
  }
}

async function createSignedWaiverPdf(record, fileName) {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fonts = {
    regular: regularFont,
    bold: boldFont
  };
  const signatureImage = await pdf.embedPng(signatureDataUrlToBytes(record.signatureDataUrl));
  const margin = 48;
  drawConsentDocument(pdf, fonts, margin);
  const page = pdf.addPage();
  const { width, height } = page.getSize();
  let y = height - margin;

  page.drawText("Get That Bod Signed Consent", {
    x: margin,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0.1, 0.08, 0.07)
  });

  y -= 32;
  const details = [
    ["Client", record.signerName],
    ["Service", record.service],
    ["Location", record.location],
    ["Appointment", formatDateTime(record.appointmentStartAt)],
    ["Signed", formatDateTime(record.createdAt)]
  ];

  for (const [label, value] of details) {
    page.drawText(`${label}:`, {
      x: margin,
      y,
      size: 10,
      font: boldFont,
      color: rgb(0.1, 0.08, 0.07)
    });
    page.drawText(String(value), {
      x: margin + 105,
      y,
      size: 10,
      font: regularFont,
      color: rgb(0.1, 0.08, 0.07),
      maxWidth: width - margin * 2 - 105
    });
    y -= 18;
  }

  y -= 10;
  page.drawText("Selections", {
    x: margin,
    y,
    size: 13,
    font: boldFont,
    color: rgb(0.1, 0.08, 0.07)
  });
  y -= 24;

  for (const selection of record.selections) {
    drawCheckbox(page, {
      x: margin,
      y,
      checked: selection.checked,
      label: selection.label,
      font: regularFont
    });
    y -= 28;
  }

  y -= 8;
  page.drawText("Electronic signature", {
    x: margin,
    y,
    size: 13,
    font: boldFont,
    color: rgb(0.1, 0.08, 0.07)
  });
  y -= 118;

  const signatureWidth = 260;
  const signatureHeight = signatureWidth * (signatureImage.height / signatureImage.width);
  page.drawRectangle({
    x: margin,
    y: y - 12,
    width: 310,
    height: 96,
    borderColor: rgb(0.82, 0.78, 0.73),
    borderWidth: 1
  });
  page.drawImage(signatureImage, {
    x: margin + 16,
    y: y + 4,
    width: signatureWidth,
    height: Math.min(signatureHeight, 70)
  });
  page.drawLine({
    start: { x: margin, y: y - 22 },
    end: { x: margin + 310, y: y - 22 },
    thickness: 1,
    color: rgb(0.1, 0.08, 0.07)
  });
  page.drawText(record.signerName, {
    x: margin,
    y: y - 40,
    size: 10,
    font: regularFont,
    color: rgb(0.1, 0.08, 0.07)
  });

  y -= 74;
  page.drawText(`Document ID: ${record.id}`, {
    x: margin,
    y,
    size: 9,
    font: regularFont,
    color: rgb(0.4, 0.35, 0.32)
  });

  await mkdir(signedWaiverDir, { recursive: true });
  await writeFile(path.join(signedWaiverDir, fileName), await pdf.save());
}

async function saveSignedWaiver(body, request) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const signerName = assertText(body.signerName, "Signer name");
  const fileName = `GetThatBoddWaiver-${slugifyName(signerName)}.pdf`;
  const record = {
    id,
    createdAt,
    signerName,
    fileName,
    signatureDataUrl: assertSignatureDataUrl(body.signatureDataUrl),
    service: assertText(body.service, "Service"),
    serviceVariationId: assertText(body.serviceVariationId, "Service variation"),
    location: assertText(body.location, "Location"),
    locationId: assertText(body.locationId, "Location ID"),
    appointmentStartAt: assertText(body.appointmentStartAt, "Appointment start time"),
    consentDocument: {
      title: assertText(body.consentDocument?.title, "Consent document title"),
      url: assertText(body.consentDocument?.url, "Consent document URL")
    },
    selections: parseConsentSelections(body.selections),
    terms: Array.isArray(body.terms) ? body.terms.map((term) => String(term).trim()).filter(Boolean) : [],
    audit: {
      ip: request.socket.remoteAddress ?? "",
      userAgent: request.headers["user-agent"] ?? ""
    }
  };

  await mkdir(waiverDir, { recursive: true });
  await createSignedWaiverPdf(record, fileName);
  await writeFile(path.join(waiverDir, `${id}.json`), JSON.stringify(record, null, 2));

  return record;
}

await loadDotEnv();

const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:4173",
  "https://kianmohr.github.io"
]);

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin ?? "";

  if (allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if ((request.url ?? "").startsWith("/api/waivers/download/")) {
    try {
      const fileName = decodeURIComponent((request.url ?? "").split("/api/waivers/download/")[1].split("?")[0]);
      const safeFileName = path.basename(fileName);
      const filePath = path.join(signedWaiverDir, safeFileName);

      if (safeFileName !== fileName || !safeFileName.endsWith(".pdf")) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Invalid waiver file");
        return;
      }

      await access(filePath);
      writePdfDownload(response, filePath, safeFileName);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Signed waiver not found");
    }
    return;
  }

  if ((request.url ?? "").startsWith("/api/waivers")) {
    try {
      const body = await readRequestBody(request);
      const waiver = await saveSignedWaiver(body, request);
      writeJson(response, 200, {
        waiver: {
          id: waiver.id,
          createdAt: waiver.createdAt,
          signerName: waiver.signerName,
          fileName: waiver.fileName,
          downloadUrl: `/api/waivers/download/${encodeURIComponent(waiver.fileName)}`
        }
      });
    } catch (error) {
      writeJson(response, 400, {
        error: error.message || "Failed to save signed waiver"
      });
    }
    return;
  }

  if ((request.url ?? "").startsWith("/api/services")) {
    try {
      const payload = await fetchSquareServices();
      writeJson(response, 200, payload);
    } catch (error) {
      writeJson(response, 500, {
        error: error.message || "Failed to load services"
      });
    }
    return;
  }

  if ((request.url ?? "").startsWith("/api/bookings/bootstrap")) {
    try {
      const payload = await fetchBookingBootstrap();
      writeJson(response, 200, payload);
    } catch (error) {
      writeJson(response, error.statusCode ?? 500, {
        error: error.message || "Failed to load booking configuration"
      });
    }
    return;
  }

  if ((request.url ?? "").startsWith("/api/bookings/availability")) {
    try {
      const body = await readRequestBody(request);
      const payload = await searchSquareAvailability(body);
      writeJson(response, 200, payload);
    } catch (error) {
      writeJson(response, error.statusCode ?? 500, {
        error: error.message || "Failed to search booking availability"
      });
    }
    return;
  }

  if ((request.url ?? "").startsWith("/api/bookings/create")) {
    try {
      const body = await readRequestBody(request);
      const {
        firstName,
        lastName,
        email,
        phone,
        locationId,
        waiverId,
        availability
      } = body;

      if (!firstName || !lastName || !email || !phone || !locationId || !availability) {
        writeJson(response, 400, {
          error: "First name, last name, email, phone, location, and selected time are required."
        });
        return;
      }

      const bootstrap = await fetchBookingBootstrap();

      if (!bootstrap.bookingProfile.supportsSellerLevelWrites) {
        writeJson(response, 409, {
          error: "Live availability is available, but bookings cannot be created through the website yet.",
          code: "SQUARE_PLAN_UPGRADE_REQUIRED",
          details: {
            bookingSiteUrl: bootstrap.locations[0]?.bookingSiteUrl ?? ""
          }
        });
        return;
      }

      const customer = await createSquareCustomer({ firstName, lastName, email, phone });
      const booking = await createSquareBooking({ customer, availability, locationId, waiverId });

      writeJson(response, 200, {
        booking,
        customer
      });
    } catch (error) {
      writeJson(response, error.statusCode ?? 500, {
        error: error.message || "Failed to create booking",
        code: error.code,
        details: error.details
      });
    }
    return;
  }

  if ((request.url ?? "").startsWith("/api/config")) {
    writeJson(response, 200, {
      squareApplicationId: process.env.SQUARE_APPLICATION_ID ?? "",
      squareEnvironment: process.env.SQUARE_ENVIRONMENT ?? ""
    });
    return;
  }

  const requestedPath = resolveRequestPath(request.url ?? "/");

  if (!requestedPath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    await access(requestedPath);
    const fileStats = await stat(requestedPath);
    let responsePath = requestedPath;

    if (fileStats.isDirectory()) {
      responsePath = path.join(requestedPath, "index.html");
      await access(responsePath);
    }

    response.writeHead(200, { "Content-Type": getMimeType(responsePath) });
    createReadStream(responsePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Serving ${targetDir} at http://localhost:${port}`);
});
