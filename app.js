"use strict";

const visualStylesheet = document.createElement("link");
visualStylesheet.rel = "stylesheet";
visualStylesheet.href = new URL("contrast.css?v=mobile-nav-contrast-1", window.location.href).href;
document.head.append(visualStylesheet);

const dnaAtmosphere = document.querySelector(".dna-atmosphere");
const hero = document.querySelector(".hero");
if (dnaAtmosphere && hero) {
  hero.prepend(dnaAtmosphere);
  const sourceStrand = dnaAtmosphere.querySelector(".dna-strand");
  if (sourceStrand) {
    ["dna-strand-d", "dna-strand-e", "dna-strand-f", "dna-strand-g"].forEach((className) => {
      const strand = sourceStrand.cloneNode(true);
      strand.className = `dna-strand ${className}`;
      dnaAtmosphere.append(strand);
    });
  }
}

const formatNumber = (value) => value === null || value === undefined
  ? "Not recorded"
  : new Intl.NumberFormat().format(value);

const setApiStatus = (elementId, message, isError = false) => {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("error", isError);
};

const addCell = (row, value, className) => {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value ?? "Not recorded";
  row.append(cell);
  return cell;
};

const createSourceLink = (source, label) => {
  if (!source?.url) return document.createTextNode(label || "Source not recorded");
  const link = document.createElement("a");
  link.href = source.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${label || source.authors || source.organization || source.title} ↗`;
  return link;
};

const estimateTypeLabel = (type) => ({
  BIRTH_PREVALENCE: "Birth prevalence",
  POPULATION_PREVALENCE: "Population prevalence",
  GENETIC_PREVALENCE: "Genetic prevalence",
  SCREENING_DETECTION_RATE: "Screening detection",
  INCIDENCE: "Incidence",
  DIAGNOSED_CASE_COUNT: "Diagnosed case count",
  OTHER: "Other",
}[type] || type);

const buildEstimateRow = (estimate) => {
  const row = document.createElement("tr");
  row.dataset.estimateType = estimate.estimateType;
  const studyCell = document.createElement("td");
  const study = document.createElement("span");
  study.className = "epi-study";
  study.textContent = estimate.source?.authors || estimate.source?.organization || estimate.source?.title || "Study";
  const location = document.createElement("span");
  location.className = "epi-location";
  location.textContent = estimate.countryName || estimate.region || "Multi-country";
  studyCell.append(study, location);
  row.append(studyCell);
  addCell(row, estimate.estimateDisplay);

  const measureCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `measure-badge${estimate.screeningBased ? " screen" : ""}`;
  badge.textContent = estimateTypeLabel(estimate.estimateType);
  measureCell.append(badge);
  row.append(measureCell);

  addCell(row, estimate.pompeType || "Not recorded");
  const sourceCell = document.createElement("td");
  sourceCell.append(createSourceLink(estimate.source, estimate.source?.authors || estimate.source?.organization));
  row.append(sourceCell);
  return row;
};

const renderEstimates = (estimates) => {
  const body = document.querySelector(".epi-table tbody");
  const fragment = document.createDocumentFragment();
  estimates.forEach((estimate) => fragment.append(buildEstimateRow(estimate)));
  body.replaceChildren(fragment);

  const globalBirthEstimates = estimates.filter((estimate) =>
    estimate.estimateType === "BIRTH_PREVALENCE" &&
    estimate.countryName === "Global" &&
    ["ALL", "IOPD", "LOPD"].includes(estimate.pompeType));
  const typeOrder = ["ALL", "IOPD", "LOPD"];
  const cards = [...document.querySelectorAll("#numbers .kpi")];
  typeOrder.forEach((pompeType, index) => {
    const estimate = globalBirthEstimates.find((record) => record.pompeType === pompeType);
    if (!estimate || !cards[index]) return;
    const valueNode = cards[index].querySelector(".kpi-value");
    valueNode.textContent = estimate.estimateDisplay.split(" per ")[0];
    const detail = estimate.lowerConfidenceInterval !== null && estimate.upperConfidenceInterval !== null
      ? `per 100,000 births · 95% CI ${estimate.lowerConfidenceInterval}–${estimate.upperConfidenceInterval}`
      : estimate.estimateDisplay;
    cards[index].querySelector(".kpi-detail").textContent = detail;
  });
};

const getProgrammeStatus = (program) => {
  if (program.screeningStatus === "UNIVERSAL") return { filter: "universal", label: "Universal", badge: "" };
  if (program.screeningStatus === "REGIONAL") return { filter: "regional", label: "Regional", badge: "regional" };
  if (program.screeningStatus === "PILOT") return { filter: "pilot", label: "Pilot", badge: "pilot" };
  if (program.screeningStatus === "PLANNED") return { filter: "recommended", label: "Recommended", badge: "national" };
  return { filter: "other", label: program.screeningStatus.replaceAll("_", " "), badge: "regional" };
};

const createMetric = (value, label) => {
  const metric = document.createElement("div");
  metric.className = `program-metric${value === null || value === undefined ? " not-recorded" : ""}`;
  const strong = document.createElement("strong");
  strong.textContent = value === null || value === undefined ? "Not recorded" : formatNumber(value);
  const caption = document.createElement("span");
  caption.textContent = label;
  metric.append(strong, caption);
  return metric;
};

const buildProgrammeCard = (program) => {
  const status = getProgrammeStatus(program);
  const card = document.createElement("article");
  card.className = "screen-card";
  card.dataset.status = status.filter;
  card.dataset.search = [
    program.countryName,
    program.programName,
    program.programScope,
    program.screeningStatus,
    program.region,
    program.studyPeriod,
    program.notes,
    program.gaaCutoffDescription,
    program.reportedBirthPrevalence,
  ].filter(Boolean).join(" ").toLowerCase();

  const header = document.createElement("div");
  header.className = "card-top";
  const location = document.createElement("div");
  location.className = "program-location";
  const mark = document.createElement("span");
  mark.className = "program-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = program.countryIso3 || program.countryName.slice(0, 2).toUpperCase();
  const titleGroup = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = program.countryName;
  const subtitle = document.createElement("small");
  subtitle.textContent = program.programName;
  titleGroup.append(title, subtitle);
  location.append(mark, titleGroup);
  const statusBadge = document.createElement("span");
  statusBadge.className = `status${status.badge ? ` ${status.badge}` : ""}`;
  statusBadge.textContent = status.label;
  header.append(location, statusBadge);

  const details = document.createElement("div");
  details.className = "program-details";
  const metrics = document.createElement("div");
  metrics.className = "program-metrics";
  const entries = [
    ["numberScreened", "newborns screened"],
    ["confirmedCases", "confirmed cases"],
    ["iopdCases", "IOPD cases"],
    ["lopdCases", "LOPD cases"],
  ].filter(([key]) => program[key] !== null && program[key] !== undefined);
  if (entries.length === 0) entries.push(["numberScreened", "screening counts"]);
  entries.forEach(([key, label]) => metrics.append(createMetric(program[key], label)));
  details.append(metrics);

  if (program.reportedBirthPrevalence) {
    const prevalence = document.createElement("p");
    prevalence.textContent = `Reported estimate: ${program.reportedBirthPrevalence}`;
    details.append(prevalence);
  }
  if (program.gaaCutoffDescription) {
    const cutoff = document.createElement("p");
    cutoff.textContent = `Source-reported GAA cutoff: ${program.gaaCutoffDescription}`;
    details.append(cutoff);
  }
  const scope = document.createElement("p");
  scope.textContent = [
    program.programScope,
    program.studyPeriod,
    program.notes,
  ].filter(Boolean).join(" · ");
  if (scope.textContent) details.append(scope);

  const source = document.createElement("span");
  source.className = "citation";
  source.append(createSourceLink(program.source, program.source?.authors || program.source?.organization));
  card.append(header, details, source);
  return card;
};

const renderProgrammes = (programmes) => {
  const grid = document.querySelector("#program-grid");
  const fragment = document.createDocumentFragment();
  programmes.forEach((programme) => fragment.append(buildProgrammeCard(programme)));
  grid.replaceChildren(fragment);

  document.querySelector("[data-screening-total]").textContent = String(programmes.length);
  document.querySelector("[data-screening-counted]").textContent = String(
    programmes.filter((programme) => programme.numberScreened !== null).length,
  );
  document.querySelector("[data-screening-pilots]").textContent = String(
    programmes.filter((programme) => programme.screeningStatus === "PILOT").length,
  );
  window.dispatchEvent(new Event("glycoguard:data-updated"));
};

const loadEvidenceData = async () => {
  if (window.location.hostname === "zsandered.github.io") {
    setApiStatus("estimates-api-status", "Showing the supplied sample estimates on this static site.");
    setApiStatus("screening-api-status", "Showing the supplied sample programmes on this static site.");
    return;
  }
  try {
    const [estimatesResponse, programmesResponse] = await Promise.all([
      fetch("/api/estimates"),
      fetch("/api/screening-programs"),
    ]);
    if (!estimatesResponse.ok || !programmesResponse.ok) {
      throw new Error("The evidence API returned an unsuccessful response.");
    }
    const estimates = await estimatesResponse.json();
    const programmes = await programmesResponse.json();
    if (!Array.isArray(estimates) || !Array.isArray(programmes)) {
      throw new Error("The evidence API returned an unexpected data format.");
    }
    renderEstimates(estimates);
    renderProgrammes(programmes);
    setApiStatus("estimates-api-status", `Loaded ${estimates.length} published estimates from the local evidence database.`);
    setApiStatus("screening-api-status", `Loaded ${programmes.length} approved screening records from the local evidence database.`);
  } catch (error) {
    console.error("Could not load GlycoGuard evidence data:", error);
    setApiStatus("estimates-api-status", "Showing the supplied sample estimates. Start the local server to load current approved records.", true);
    setApiStatus("screening-api-status", "Showing the supplied sample programmes. Start the local server to load current approved records.", true);
  }
};

loadEvidenceData();
