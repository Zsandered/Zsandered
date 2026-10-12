"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const express = require("express");

const ROOT = __dirname;
const DEFAULT_DB_PATH = path.join(ROOT, "data", "glycoguard.sqlite");
const SOURCE_TYPES = new Set([
  "PEER_REVIEWED_ARTICLE",
  "GOVERNMENT",
  "REGULATORY_AGENCY",
  "NEWBORN_SCREENING_PROGRAM",
  "CLINICAL_TRIAL_REGISTRY",
  "RARE_DISEASE_DATABASE",
  "ACADEMIC_INSTITUTION",
  "OTHER",
]);
const REVIEW_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"]);
const SCREENING_STATUSES = new Set([
  "UNIVERSAL",
  "REGIONAL",
  "PILOT",
  "PLANNED",
  "NOT_IDENTIFIED_IN_AVAILABLE_SOURCES",
  "UNKNOWN",
]);
const ESTIMATE_TYPES = new Set([
  "BIRTH_PREVALENCE",
  "POPULATION_PREVALENCE",
  "GENETIC_PREVALENCE",
  "SCREENING_DETECTION_RATE",
  "INCIDENCE",
  "DIAGNOSED_CASE_COUNT",
  "OTHER",
]);
const POMPE_TYPES = new Set(["ALL", "IOPD", "LOPD", "UNCLASSIFIED"]);
const EVIDENCE_QUALITIES = new Set(["HIGHER", "MODERATE", "LIMITED", "INSUFFICIENT"]);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function seedDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_sources (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      authors TEXT,
      organization TEXT,
      journal TEXT,
      publication_year INTEGER,
      doi TEXT,
      url TEXT,
      source_type TEXT NOT NULL,
      country_scope TEXT,
      topic TEXT,
      notes TEXT,
      review_status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS screening_programs (
      id TEXT PRIMARY KEY,
      country_iso3 TEXT,
      country_name TEXT NOT NULL,
      region TEXT,
      program_name TEXT NOT NULL,
      program_scope TEXT,
      screening_status TEXT NOT NULL,
      start_year INTEGER,
      end_year INTEGER,
      number_screened INTEGER,
      confirmed_cases INTEGER,
      iopd_cases INTEGER,
      lopd_cases INTEGER,
      reported_birth_prevalence TEXT,
      screening_method TEXT,
      gaa_cutoff_description TEXT,
      study_period TEXT,
      source_id TEXT NOT NULL REFERENCES evidence_sources(id) ON DELETE RESTRICT,
      last_verified TEXT,
      review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS epi_estimates (
      id TEXT PRIMARY KEY,
      country_iso3 TEXT,
      country_name TEXT,
      region TEXT,
      pompe_type TEXT NOT NULL,
      estimate_type TEXT NOT NULL,
      estimate_display TEXT NOT NULL,
      estimate_value REAL,
      numerator INTEGER,
      denominator INTEGER,
      rate_per_100000 REAL,
      lower_confidence_interval REAL,
      upper_confidence_interval REAL,
      population_description TEXT,
      sample_size INTEGER,
      study_start_year INTEGER,
      study_end_year INTEGER,
      publication_year INTEGER,
      methodology TEXT,
      screening_based INTEGER NOT NULL DEFAULT 0,
      evidence_quality TEXT,
      source_id TEXT NOT NULL REFERENCES evidence_sources(id) ON DELETE RESTRICT,
      review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_screening_public
      ON screening_programs(review_status, screening_status, country_name);
    CREATE INDEX IF NOT EXISTS idx_estimates_public
      ON epi_estimates(review_status, estimate_type, country_name);
    CREATE INDEX IF NOT EXISTS idx_sources_public
      ON evidence_sources(review_status, publication_year);
  `);

  const sourceCount = db.prepare("SELECT COUNT(*) AS count FROM evidence_sources").get().count;
  if (sourceCount > 0) return;

  const insertSource = db.prepare(`
    INSERT INTO evidence_sources
      (id, title, authors, organization, journal, publication_year, doi, url, source_type, country_scope, topic, notes, review_status)
    VALUES
      (@id, @title, @authors, @organization, @journal, @publicationYear, @doi, @url, @sourceType, @countryScope, @topic, @notes, 'APPROVED')
  `);
  const sources = [
    {
      id: "kong-2024",
      title: "Global birth prevalence of Pompe disease: systematic review and meta-analysis",
      authors: "Kong W, Lu C, Wang L",
      journal: "Neuroscience",
      publicationYear: 2024,
      doi: "10.1016/j.neuroscience.2024.09.043",
      url: "https://doi.org/10.1016/j.neuroscience.2024.09.043",
      sourceType: "PEER_REVIEWED_ARTICLE",
      countryScope: "Global",
      topic: "Birth prevalence",
    },
    {
      id: "colburn-2024",
      title: "An analysis of Pompe newborn screening data",
      authors: "Colburn, Lapidus",
      journal: "Frontiers in Pediatrics",
      publicationYear: 2024,
      doi: "10.3389/fped.2023.1221140",
      url: "https://doi.org/10.3389/fped.2023.1221140",
      sourceType: "PEER_REVIEWED_ARTICLE",
      countryScope: "Multi-country",
      topic: "Newborn screening",
    },
    {
      id: "ficicioglu-2020",
      title: "Newborn Screening for Pompe Disease: Pennsylvania Experience",
      authors: "Ficicioglu C, et al.",
      journal: "International Journal of Neonatal Screening",
      publicationYear: 2020,
      doi: "10.3390/ijns6040089",
      url: "https://doi.org/10.3390/ijns6040089",
      sourceType: "PEER_REVIEWED_ARTICLE",
      countryScope: "Pennsylvania, United States",
      topic: "Newborn screening",
    },
    {
      id: "ausems-1999",
      title: "Pompe disease epidemiology in the Netherlands",
      authors: "Ausems MGEM, et al.",
      publicationYear: 1999,
      url: "https://pubmed.ncbi.nlm.nih.gov/10482961/",
      sourceType: "PEER_REVIEWED_ARTICLE",
      countryScope: "Netherlands",
      topic: "Epidemiology",
    },
    {
      id: "chien-2008",
      title: "Pompe disease newborn screening in Taiwan",
      authors: "Chien YH, et al.",
      publicationYear: 2008,
      url: "https://pubmed.ncbi.nlm.nih.gov/18519449/",
      sourceType: "PEER_REVIEWED_ARTICLE",
      countryScope: "Taiwan",
      topic: "Newborn screening",
    },
    {
      id: "ny-wadsworth",
      title: "Newborn screening programme information",
      organization: "New York State Department of Health, Wadsworth Center",
      url: "https://www.wadsworth.org/",
      sourceType: "GOVERNMENT",
      countryScope: "New York State, United States",
      topic: "Newborn screening",
    },
    {
      id: "hrsa-rusp",
      title: "Recommended Uniform Screening Panel",
      organization: "Health Resources and Services Administration",
      url: "https://www.hrsa.gov/advisory-committees/heritable-disorders/rusp",
      sourceType: "GOVERNMENT",
      countryScope: "United States",
      topic: "Newborn screening recommendations",
    },
  ];
  db.exec("BEGIN IMMEDIATE");
  try {
    sources.forEach((source) => insertSource.run(source));

    const insertProgram = db.prepare(`
      INSERT INTO screening_programs
        (id, country_iso3, country_name, region, program_name, program_scope, screening_status,
         start_year, end_year, number_screened, confirmed_cases, iopd_cases, lopd_cases,
         reported_birth_prevalence, screening_method, gaa_cutoff_description, study_period,
         source_id, review_status, notes)
      VALUES
        (@id, @countryIso3, @countryName, @region, @programName, @programScope, @screeningStatus,
         @startYear, @endYear, @numberScreened, @confirmedCases, @iopdCases, @lopdCases,
         @reportedBirthPrevalence, @screeningMethod, @gaaCutoffDescription, @studyPeriod,
         @sourceId, 'APPROVED', @notes)
    `);
    const programs = [
      { id: "screen-pa", countryIso3: "USA", countryName: "Pennsylvania", region: "North America", programName: "Pennsylvania newborn screening", programScope: "State programme", screeningStatus: "UNIVERSAL", startYear: null, endYear: null, numberScreened: 531139, confirmedCases: null, iopdCases: 2, lopdCases: 31, reportedBirthPrevalence: null, screeningMethod: null, gaaCutoffDescription: "2.10 µmol/L/h, approximately 18% of the normal mean", studyPeriod: null, sourceId: "ficicioglu-2020", notes: "Cutoff wording is reproduced from the supplied study summary." },
      { id: "screen-tw-2008", countryIso3: "TWN", countryName: "Taiwan", region: "Asia", programName: "Taiwan newborn screening, 2008", programScope: "National programme", screeningStatus: "UNIVERSAL", startYear: 2008, endYear: 2008, numberScreened: 132538, confirmedCases: 4, iopdCases: null, lopdCases: null, reportedBirthPrevalence: null, screeningMethod: null, gaaCutoffDescription: null, studyPeriod: "2008", sourceId: "chien-2008", notes: "Counts as entered in the supplied evidence summary." },
      { id: "screen-tw-2018", countryIso3: "TWN", countryName: "Taiwan", region: "Asia", programName: "Taiwan extended screening through 2018", programScope: "National programme", screeningStatus: "UNIVERSAL", startYear: 2008, endYear: 2018, numberScreened: 994975, confirmedCases: 55, iopdCases: null, lopdCases: null, reportedBirthPrevalence: null, screeningMethod: null, gaaCutoffDescription: null, studyPeriod: "Through 2018", sourceId: "colburn-2024", notes: "Extended programme totals as entered in the supplied evidence summary." },
      { id: "screen-ny", countryIso3: "USA", countryName: "New York State", region: "North America", programName: "New York State newborn screening", programScope: "State programme", screeningStatus: "UNIVERSAL", startYear: null, endYear: null, numberScreened: null, confirmedCases: null, iopdCases: null, lopdCases: null, reportedBirthPrevalence: "Approximately 1 in 17,000", screeningMethod: null, gaaCutoffDescription: null, studyPeriod: null, sourceId: "ny-wadsworth", notes: "Numerical estimate is reported as approximate in supplied materials." },
      { id: "screen-rusp", countryIso3: "USA", countryName: "United States", region: "North America", programName: "Recommended Uniform Screening Panel (RUSP)", programScope: "National recommendation", screeningStatus: "PLANNED", startYear: 2015, endYear: null, numberScreened: null, confirmedCases: null, iopdCases: null, lopdCases: null, reportedBirthPrevalence: null, screeningMethod: null, gaaCutoffDescription: null, studyPeriod: null, sourceId: "hrsa-rusp", notes: "Pompe disease was added to the RUSP in February 2015. Recommendation is not interpreted as implementation in every state." },
      ...[
        ["IT", "Italy", "Europe"],
        ["AUS", "Australia", "Oceania"],
        ["JPN", "Japan", "Asia"],
        ["KOR", "South Korea", "Asia"],
        ["HUN", "Hungary", "Europe"],
      ].map(([iso, countryName, region]) => ({
        id: `screen-pilot-${iso.toLowerCase()}`,
        countryIso3: iso,
        countryName,
        region,
        programName: `${countryName} pilot programme`,
        programScope: "Pilot programme",
        screeningStatus: "PILOT",
        startYear: null,
        endYear: null,
        numberScreened: null,
        confirmedCases: null,
        iopdCases: null,
        lopdCases: null,
        reportedBirthPrevalence: null,
        screeningMethod: null,
        gaaCutoffDescription: null,
        studyPeriod: null,
        sourceId: "colburn-2024",
        notes: "Pilot location identified in the supplied evidence summary; programme counts were not included there.",
      })),
    ];
    programs.forEach((program) => insertProgram.run(program));

    const insertEstimate = db.prepare(`
      INSERT INTO epi_estimates
        (id, country_iso3, country_name, region, pompe_type, estimate_type, estimate_display,
         rate_per_100000, lower_confidence_interval, upper_confidence_interval, population_description,
         sample_size, publication_year, methodology, screening_based, evidence_quality,
         source_id, review_status, notes)
      VALUES
        (@id, @countryIso3, @countryName, @region, @pompeType, @estimateType, @estimateDisplay,
         @ratePer100000, @lowerConfidenceInterval, @upperConfidenceInterval, @populationDescription,
         @sampleSize, @publicationYear, @methodology, @screeningBased, @evidenceQuality,
         @sourceId, 'APPROVED', @notes)
    `);
    const estimates = [
      { id: "epi-global-all", countryIso3: null, countryName: "Global", region: "Global", pompeType: "ALL", estimateType: "BIRTH_PREVALENCE", estimateDisplay: "2.0 per 100,000 (95% CI 1.5–2.4)", ratePer100000: 2, lowerConfidenceInterval: 1.5, upperConfidenceInterval: 2.4, populationDescription: "Global meta-analysis", sampleSize: null, publicationYear: 2024, methodology: "Systematic review and meta-analysis", screeningBased: 0, evidenceQuality: "MODERATE", sourceId: "kong-2024", notes: "No single universal birth-prevalence figure is asserted." },
      { id: "epi-global-iopd", countryIso3: null, countryName: "Global", region: "Global", pompeType: "IOPD", estimateType: "BIRTH_PREVALENCE", estimateDisplay: "1.0 per 100,000 (95% CI 0.5–1.5)", ratePer100000: 1, lowerConfidenceInterval: 0.5, upperConfidenceInterval: 1.5, populationDescription: "Global meta-analysis", sampleSize: null, publicationYear: 2024, methodology: "Systematic review and meta-analysis", screeningBased: 0, evidenceQuality: "MODERATE", sourceId: "kong-2024", notes: null },
      { id: "epi-global-lopd", countryIso3: null, countryName: "Global", region: "Global", pompeType: "LOPD", estimateType: "BIRTH_PREVALENCE", estimateDisplay: "2.4 per 100,000 (95% CI 1.8–3.0)", ratePer100000: 2.4, lowerConfidenceInterval: 1.8, upperConfidenceInterval: 3, populationDescription: "Global meta-analysis", sampleSize: null, publicationYear: 2024, methodology: "Systematic review and meta-analysis", screeningBased: 0, evidenceQuality: "MODERATE", sourceId: "kong-2024", notes: null },
      { id: "epi-multicountry-screen", countryIso3: null, countryName: "Multi-country screening programmes", region: "Global", pompeType: "ALL", estimateType: "SCREENING_DETECTION_RATE", estimateDisplay: "1 in 18,711 (about 5.3 per 100,000; derived)", ratePer100000: 5.3, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: "29 programmes in 8 countries", sampleSize: 11600000, publicationYear: 2024, methodology: "Newborn screening data analysis", screeningBased: 1, evidenceQuality: "MODERATE", sourceId: "colburn-2024", notes: "5.3 per 100,000 is derived from the published 1 in 18,711 estimate." },
      { id: "epi-netherlands-iopd", countryIso3: "NLD", countryName: "Netherlands", region: "Europe", pompeType: "IOPD", estimateType: "BIRTH_PREVALENCE", estimateDisplay: "1 in 138,000", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: null, sampleSize: null, publicationYear: 1999, methodology: null, screeningBased: 0, evidenceQuality: "LIMITED", sourceId: "ausems-1999", notes: null },
      { id: "epi-netherlands-lopd", countryIso3: "NLD", countryName: "Netherlands", region: "Europe", pompeType: "LOPD", estimateType: "BIRTH_PREVALENCE", estimateDisplay: "1 in 57,000", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: null, sampleSize: null, publicationYear: 1999, methodology: null, screeningBased: 0, evidenceQuality: "LIMITED", sourceId: "ausems-1999", notes: null },
      { id: "epi-netherlands-all", countryIso3: "NLD", countryName: "Netherlands", region: "Europe", pompeType: "ALL", estimateType: "BIRTH_PREVALENCE", estimateDisplay: "1 in 40,000", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: null, sampleSize: null, publicationYear: 1999, methodology: null, screeningBased: 0, evidenceQuality: "LIMITED", sourceId: "ausems-1999", notes: null },
      { id: "epi-pa-confirmed", countryIso3: "USA", countryName: "Pennsylvania", region: "North America", pompeType: "ALL", estimateType: "SCREENING_DETECTION_RATE", estimateDisplay: "1 in 16,095 confirmed", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: "Pennsylvania newborn screening", sampleSize: 531139, publicationYear: 2020, methodology: "Newborn screening", screeningBased: 1, evidenceQuality: "MODERATE", sourceId: "ficicioglu-2020", notes: null },
      { id: "epi-pa-suspected", countryIso3: "USA", countryName: "Pennsylvania", region: "North America", pompeType: "LOPD", estimateType: "SCREENING_DETECTION_RATE", estimateDisplay: "1 in 8,431 including suspected LOPD", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: "Pennsylvania newborn screening; includes suspected LOPD", sampleSize: 531139, publicationYear: 2020, methodology: "Newborn screening", screeningBased: 1, evidenceQuality: "MODERATE", sourceId: "ficicioglu-2020", notes: "Includes suspected LOPD, as specified in the supplied source summary." },
      { id: "epi-pa-lopd", countryIso3: "USA", countryName: "Pennsylvania", region: "North America", pompeType: "LOPD", estimateType: "SCREENING_DETECTION_RATE", estimateDisplay: "1 in 17,133 LOPD", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: "Pennsylvania newborn screening", sampleSize: 531139, publicationYear: 2020, methodology: "Newborn screening", screeningBased: 1, evidenceQuality: "MODERATE", sourceId: "ficicioglu-2020", notes: null },
      { id: "epi-ny", countryIso3: "USA", countryName: "New York State", region: "North America", pompeType: "ALL", estimateType: "SCREENING_DETECTION_RATE", estimateDisplay: "Approximately 1 in 17,000", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: "New York State newborn screening", sampleSize: null, publicationYear: null, methodology: "Newborn screening", screeningBased: 1, evidenceQuality: "LIMITED", sourceId: "ny-wadsworth", notes: "Approximate estimate as reported in supplied materials." },
      { id: "epi-tw-iopd", countryIso3: "TWN", countryName: "Taiwan", region: "Asia", pompeType: "IOPD", estimateType: "SCREENING_DETECTION_RATE", estimateDisplay: "1 in 62,186", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: "Taiwan newborn screening", sampleSize: 132538, publicationYear: 2008, methodology: "Newborn screening", screeningBased: 1, evidenceQuality: "MODERATE", sourceId: "chien-2008", notes: null },
      { id: "epi-tw-lopd", countryIso3: "TWN", countryName: "Taiwan", region: "Asia", pompeType: "LOPD", estimateType: "SCREENING_DETECTION_RATE", estimateDisplay: "1 in 82,914", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: "Taiwan newborn screening", sampleSize: 132538, publicationYear: 2008, methodology: "Newborn screening", screeningBased: 1, evidenceQuality: "MODERATE", sourceId: "chien-2008", notes: null },
      { id: "epi-japan-iopd", countryIso3: "JPN", countryName: "Japan", region: "Asia", pompeType: "IOPD", estimateType: "SCREENING_DETECTION_RATE", estimateDisplay: "1 in 297,387", ratePer100000: null, lowerConfidenceInterval: null, upperConfidenceInterval: null, populationDescription: "Japan newborn screening", sampleSize: null, publicationYear: 2024, methodology: "Newborn screening data", screeningBased: 1, evidenceQuality: "LIMITED", sourceId: "colburn-2024", notes: null },
    ];
    estimates.forEach((estimate) => insertEstimate.run(estimate));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function camelCaseRow(row) {
  if (!row) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    value,
  ]));
}

function requiredString(value, field, maxLength = 500) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new ApiError(400, `${field} must be ${maxLength} characters or fewer.`);
  return normalized;
}

function optionalString(value, field, maxLength = 2000) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ApiError(400, `${field} must be a string of ${maxLength} characters or fewer.`);
  }
  return value.trim() || null;
}

function optionalNumber(value, field, { integer = false, minimum = 0 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
    throw new ApiError(400, `${field} must be a ${integer ? "non-negative integer" : "non-negative number"} or null.`);
  }
  return value;
}

function enumValue(value, field, allowed, fallback) {
  const normalized = value === undefined ? fallback : value;
  if (!allowed.has(normalized)) throw new ApiError(400, `${field} has an unsupported value.`);
  return normalized;
}

function httpUrl(value, field) {
  const normalized = optionalString(value, field, 2000);
  if (!normalized) return null;
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ApiError(400, `${field} must be an absolute HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(400, `${field} must be an HTTP or HTTPS URL.`);
  }
  return parsed.toString();
}

function validateSource(body, existing = {}) {
  const merged = { ...existing, ...body };
  const publicationYear = optionalNumber(merged.publicationYear, "publicationYear", { integer: true });
  if (publicationYear !== null && (publicationYear < 1800 || publicationYear > 2200)) {
    throw new ApiError(400, "publicationYear must be between 1800 and 2200.");
  }
  return {
    title: requiredString(merged.title, "title"),
    authors: optionalString(merged.authors, "authors"),
    organization: optionalString(merged.organization, "organization"),
    journal: optionalString(merged.journal, "journal"),
    publicationYear,
    doi: optionalString(merged.doi, "doi", 300),
    url: httpUrl(merged.url, "url"),
    sourceType: enumValue(merged.sourceType, "sourceType", SOURCE_TYPES, "OTHER"),
    countryScope: optionalString(merged.countryScope, "countryScope"),
    topic: optionalString(merged.topic, "topic"),
    notes: optionalString(merged.notes, "notes"),
    reviewStatus: enumValue(merged.reviewStatus, "reviewStatus", REVIEW_STATUSES, "PENDING_REVIEW"),
  };
}

function validateProgram(body, existing = {}) {
  const merged = { ...existing, ...body };
  const startYear = optionalNumber(merged.startYear, "startYear", { integer: true });
  const endYear = optionalNumber(merged.endYear, "endYear", { integer: true });
  const sourceId = requiredString(merged.sourceId, "sourceId", 100);
  return {
    countryIso3: optionalString(merged.countryIso3, "countryIso3", 3)?.toUpperCase() ?? null,
    countryName: requiredString(merged.countryName, "countryName", 150),
    region: optionalString(merged.region, "region", 100),
    programName: requiredString(merged.programName, "programName", 250),
    programScope: optionalString(merged.programScope, "programScope", 250),
    screeningStatus: enumValue(merged.screeningStatus, "screeningStatus", SCREENING_STATUSES),
    startYear,
    endYear,
    numberScreened: optionalNumber(merged.numberScreened, "numberScreened", { integer: true }),
    confirmedCases: optionalNumber(merged.confirmedCases, "confirmedCases", { integer: true }),
    iopdCases: optionalNumber(merged.iopdCases, "iopdCases", { integer: true }),
    lopdCases: optionalNumber(merged.lopdCases, "lopdCases", { integer: true }),
    reportedBirthPrevalence: optionalString(merged.reportedBirthPrevalence, "reportedBirthPrevalence", 300),
    screeningMethod: optionalString(merged.screeningMethod, "screeningMethod"),
    gaaCutoffDescription: optionalString(merged.gaaCutoffDescription, "gaaCutoffDescription"),
    studyPeriod: optionalString(merged.studyPeriod, "studyPeriod", 300),
    sourceId,
    lastVerified: optionalString(merged.lastVerified, "lastVerified", 50),
    reviewStatus: enumValue(merged.reviewStatus, "reviewStatus", REVIEW_STATUSES, "PENDING_REVIEW"),
    notes: optionalString(merged.notes, "notes"),
  };
}

function validateEstimate(body, existing = {}) {
  const merged = { ...existing, ...body };
  const publicationYear = optionalNumber(merged.publicationYear, "publicationYear", { integer: true });
  if (publicationYear !== null && (publicationYear < 1800 || publicationYear > 2200)) {
    throw new ApiError(400, "publicationYear must be between 1800 and 2200.");
  }
  const quality = merged.evidenceQuality === undefined || merged.evidenceQuality === null
    ? null
    : enumValue(merged.evidenceQuality, "evidenceQuality", EVIDENCE_QUALITIES);
  if (typeof merged.screeningBased !== "boolean") {
    throw new ApiError(400, "screeningBased must be true or false.");
  }
  return {
    countryIso3: optionalString(merged.countryIso3, "countryIso3", 3)?.toUpperCase() ?? null,
    countryName: optionalString(merged.countryName, "countryName", 150),
    region: optionalString(merged.region, "region", 100),
    pompeType: enumValue(merged.pompeType, "pompeType", POMPE_TYPES),
    estimateType: enumValue(merged.estimateType, "estimateType", ESTIMATE_TYPES),
    estimateDisplay: requiredString(merged.estimateDisplay, "estimateDisplay", 500),
    estimateValue: optionalNumber(merged.estimateValue, "estimateValue"),
    numerator: optionalNumber(merged.numerator, "numerator", { integer: true }),
    denominator: optionalNumber(merged.denominator, "denominator", { integer: true }),
    ratePer100000: optionalNumber(merged.ratePer100000, "ratePer100000"),
    lowerConfidenceInterval: optionalNumber(merged.lowerConfidenceInterval, "lowerConfidenceInterval"),
    upperConfidenceInterval: optionalNumber(merged.upperConfidenceInterval, "upperConfidenceInterval"),
    populationDescription: optionalString(merged.populationDescription, "populationDescription"),
    sampleSize: optionalNumber(merged.sampleSize, "sampleSize", { integer: true }),
    studyStartYear: optionalNumber(merged.studyStartYear, "studyStartYear", { integer: true }),
    studyEndYear: optionalNumber(merged.studyEndYear, "studyEndYear", { integer: true }),
    publicationYear,
    methodology: optionalString(merged.methodology, "methodology"),
    screeningBased: merged.screeningBased ? 1 : 0,
    evidenceQuality: quality,
    sourceId: requiredString(merged.sourceId, "sourceId", 100),
    reviewStatus: enumValue(merged.reviewStatus, "reviewStatus", REVIEW_STATUSES, "PENDING_REVIEW"),
    notes: optionalString(merged.notes, "notes"),
  };
}

function hasApprovedSource(db, sourceId) {
  const source = db.prepare("SELECT review_status FROM evidence_sources WHERE id = ?").get(sourceId);
  if (!source) throw new ApiError(400, "sourceId must reference an existing evidence source.");
  return source.review_status === "APPROVED";
}

function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return next(new ApiError(503, "Admin writes are disabled until ADMIN_TOKEN is configured."));
  const authorization = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const providedHash = crypto.createHash("sha256").update(match?.[1] || "").digest();
  const expectedHash = crypto.createHash("sha256").update(token).digest();
  if (!crypto.timingSafeEqual(providedHash, expectedHash) || !match) {
    return next(new ApiError(401, "A valid Bearer admin token is required."));
  }
  next();
}

function createApp({ databasePath = process.env.DATABASE_PATH || DEFAULT_DB_PATH } = {}) {
  if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  seedDatabase(db);

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-store",
    });
    next();
  });
  app.use(express.json({ limit: "32kb", strict: true }));
  const dashboardHtml = fs.readFileSync(path.join(ROOT, "index.html"));
  const dashboardScript = fs.readFileSync(path.join(ROOT, "app.js"));
  const adminHtml = fs.readFileSync(path.join(ROOT, "admin.html"));
  const adminScript = fs.readFileSync(path.join(ROOT, "admin.js"));
  const contrastStyles = fs.readFileSync(path.join(ROOT, "contrast.css"));
  const adminStyles = fs.readFileSync(path.join(ROOT, "admin-theme.css"));
  app.get(["/", "/disease", "/numbers", "/screening", "/clinical", "/genetics", "/references"], (req, res) =>
    res.type("html").send(dashboardHtml));
  app.get("/admin", (req, res) => res.type("html").send(adminHtml));
  app.get("/index.html", (req, res) => res.type("html").send(dashboardHtml));
  app.get("/app.js", (req, res) => res.type("js").send(dashboardScript));
  app.get("/admin.js", (req, res) => res.type("js").send(adminScript));
  app.get("/contrast.css", (req, res) => res.type("css").send(contrastStyles));
  app.get("/admin-theme.css", (req, res) => res.type("css").send(adminStyles));
  app.get("/api", (req, res) => {
    res.json({
      name: "GlycoGuard Evidence API",
      version: "1.0",
      description: "Read approved evidence for the GlycoGuard educational dashboard.",
      dashboard: "/",
      health: "/api/health",
      publicEndpoints: [
        { method: "GET", path: "/api/sources", description: "Approved evidence sources." },
        { method: "GET", path: "/api/screening-programs", description: "Approved screening programmes.", filters: { status: [...SCREENING_STATUSES] } },
        { method: "GET", path: "/api/estimates", description: "Approved epidemiology estimates.", filters: { type: [...ESTIMATE_TYPES], country: "Country name or ISO3 code", pompeType: [...POMPE_TYPES] } },
      ],
      adminEndpoints: [
        { method: "GET", path: "/api/admin/sources" },
        { method: "POST", path: "/api/sources" },
        { method: "PATCH", path: "/api/sources/:id" },
        { method: "GET", path: "/api/admin/screening-programs" },
        { method: "POST", path: "/api/screening-programs" },
        { method: "PATCH", path: "/api/screening-programs/:id" },
        { method: "DELETE", path: "/api/screening-programs/:id" },
        { method: "GET", path: "/api/admin/estimates" },
        { method: "POST", path: "/api/estimates" },
        { method: "PATCH", path: "/api/estimates/:id" },
        { method: "DELETE", path: "/api/estimates/:id" },
      ].map((endpoint) => ({ ...endpoint, authentication: "Bearer ADMIN_TOKEN" })),
      notes: [
        "Public API routes include only approved records with approved linked sources.",
        "Admin write routes require ADMIN_TOKEN on the server and an Authorization: Bearer token header.",
        "This API stores educational evidence only; it is not a patient registry.",
      ],
    });
  });
  app.get("/api/health", (req, res) => {
    const result = db.prepare("SELECT 1 AS ok").get();
    res.json({ status: result.ok === 1 ? "ok" : "error", storage: "sqlite" });
  });

  app.get("/api/sources", (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM evidence_sources
      WHERE review_status = 'APPROVED'
      ORDER BY publication_year DESC, title COLLATE NOCASE
    `).all();
    res.json(rows.map(camelCaseRow));
  });

  app.get("/api/admin/sources", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM evidence_sources ORDER BY created_at DESC").all();
    res.json(rows.map(camelCaseRow));
  });

  app.get("/api/admin/screening-programs", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM screening_programs ORDER BY updated_at DESC").all();
    res.json(rows.map(camelCaseRow));
  });

  app.get("/api/admin/estimates", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM epi_estimates ORDER BY updated_at DESC").all();
    res.json(rows.map((row) => ({
      ...camelCaseRow(row),
      screeningBased: Boolean(row.screening_based),
    })));
  });

  app.get("/api/screening-programs", (req, res) => {
    const status = req.query.status;
    if (status && !SCREENING_STATUSES.has(status)) throw new ApiError(400, "status filter is unsupported.");
    const params = [];
    let where = "p.review_status = 'APPROVED' AND s.review_status = 'APPROVED'";
    if (status) {
      where += " AND p.screening_status = ?";
      params.push(status);
    }
    const rows = db.prepare(`
      SELECT p.*, s.title AS source_title, s.authors AS source_authors, s.organization AS source_organization,
        s.journal AS source_journal, s.publication_year AS source_publication_year, s.doi AS source_doi, s.url AS source_url
      FROM screening_programs p
      JOIN evidence_sources s ON s.id = p.source_id
      WHERE ${where}
      ORDER BY CASE p.screening_status WHEN 'UNIVERSAL' THEN 0 WHEN 'REGIONAL' THEN 1 WHEN 'PLANNED' THEN 2 ELSE 3 END,
        p.country_name COLLATE NOCASE, p.start_year
    `).all(...params);
    res.json(rows.map((row) => {
      const { source_title, source_authors, source_organization, source_journal, source_publication_year, source_doi, source_url, ...program } = row;
      return {
        ...camelCaseRow(program),
        source: {
          title: source_title,
          authors: source_authors,
          organization: source_organization,
          journal: source_journal,
          publicationYear: source_publication_year,
          doi: source_doi,
          url: source_url,
        },
      };
    }));
  });

  app.get("/api/estimates", (req, res) => {
    const { type, country, pompeType } = req.query;
    if (type && !ESTIMATE_TYPES.has(type)) throw new ApiError(400, "type filter is unsupported.");
    if (pompeType && !POMPE_TYPES.has(pompeType)) throw new ApiError(400, "pompeType filter is unsupported.");
    const clauses = ["e.review_status = 'APPROVED'", "s.review_status = 'APPROVED'"];
    const params = [];
    if (type) { clauses.push("e.estimate_type = ?"); params.push(type); }
    if (country) { clauses.push("(e.country_iso3 = ? OR e.country_name = ?)"); params.push(country.toUpperCase(), country); }
    if (pompeType) { clauses.push("e.pompe_type = ?"); params.push(pompeType); }
    const rows = db.prepare(`
      SELECT e.*, s.title AS source_title, s.authors AS source_authors, s.organization AS source_organization,
        s.journal AS source_journal, s.publication_year AS source_publication_year, s.doi AS source_doi, s.url AS source_url
      FROM epi_estimates e
      JOIN evidence_sources s ON s.id = e.source_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY e.publication_year DESC, e.country_name COLLATE NOCASE, e.pompe_type
    `).all(...params);
    res.json(rows.map((row) => {
      const { source_title, source_authors, source_organization, source_journal, source_publication_year, source_doi, source_url, ...estimate } = row;
      return {
        ...camelCaseRow(estimate),
        screeningBased: Boolean(estimate.screening_based),
        source: {
          title: source_title,
          authors: source_authors,
          organization: source_organization,
          journal: source_journal,
          publicationYear: source_publication_year,
          doi: source_doi,
          url: source_url,
        },
      };
    }));
  });

  app.post("/api/sources", requireAdmin, (req, res) => {
    const source = validateSource(req.body);
    const id = optionalString(req.body.id, "id", 100) || crypto.randomUUID();
    db.prepare(`
      INSERT INTO evidence_sources
        (id, title, authors, organization, journal, publication_year, doi, url, source_type,
         country_scope, topic, notes, review_status)
      VALUES
        (@id, @title, @authors, @organization, @journal, @publicationYear, @doi, @url, @sourceType,
         @countryScope, @topic, @notes, @reviewStatus)
    `).run({ id, ...source });
    res.status(201).json(camelCaseRow(db.prepare("SELECT * FROM evidence_sources WHERE id = ?").get(id)));
  });

  app.patch("/api/sources/:id", requireAdmin, (req, res) => {
    const current = db.prepare("SELECT * FROM evidence_sources WHERE id = ?").get(req.params.id);
    if (!current) throw new ApiError(404, "Evidence source not found.");
    const normalized = validateSource(req.body, camelCaseRow(current));
    db.prepare(`
      UPDATE evidence_sources SET title=@title, authors=@authors, organization=@organization, journal=@journal,
        publication_year=@publicationYear, doi=@doi, url=@url, source_type=@sourceType, country_scope=@countryScope,
        topic=@topic, notes=@notes, review_status=@reviewStatus, updated_at=CURRENT_TIMESTAMP WHERE id=@id
    `).run({ id: req.params.id, ...normalized });
    res.json(camelCaseRow(db.prepare("SELECT * FROM evidence_sources WHERE id = ?").get(req.params.id)));
  });

  app.post("/api/screening-programs", requireAdmin, (req, res) => {
    const program = validateProgram(req.body);
    const sourceIsApproved = hasApprovedSource(db, program.sourceId);
    if (program.reviewStatus === "APPROVED" && !sourceIsApproved) {
      throw new ApiError(400, "An approved evidence source is required to approve a public screening record.");
    }
    const id = optionalString(req.body.id, "id", 100) || crypto.randomUUID();
    db.prepare(`
      INSERT INTO screening_programs
        (id, country_iso3, country_name, region, program_name, program_scope, screening_status,
         start_year, end_year, number_screened, confirmed_cases, iopd_cases, lopd_cases,
         reported_birth_prevalence, screening_method, gaa_cutoff_description, study_period,
         source_id, last_verified, review_status, notes)
      VALUES
        (@id, @countryIso3, @countryName, @region, @programName, @programScope, @screeningStatus,
         @startYear, @endYear, @numberScreened, @confirmedCases, @iopdCases, @lopdCases,
         @reportedBirthPrevalence, @screeningMethod, @gaaCutoffDescription, @studyPeriod,
         @sourceId, @lastVerified, @reviewStatus, @notes)
    `).run({ id, ...program });
    res.status(201).json(camelCaseRow(db.prepare("SELECT * FROM screening_programs WHERE id = ?").get(id)));
  });

  app.patch("/api/screening-programs/:id", requireAdmin, (req, res) => {
    const current = db.prepare("SELECT * FROM screening_programs WHERE id = ?").get(req.params.id);
    if (!current) throw new ApiError(404, "Screening programme not found.");
    const program = validateProgram(req.body, camelCaseRow(current));
    const sourceIsApproved = hasApprovedSource(db, program.sourceId);
    if (program.reviewStatus === "APPROVED" && !sourceIsApproved) {
      throw new ApiError(400, "An approved evidence source is required to approve a public screening record.");
    }
    db.prepare(`
      UPDATE screening_programs SET country_iso3=@countryIso3, country_name=@countryName, region=@region,
        program_name=@programName, program_scope=@programScope, screening_status=@screeningStatus,
        start_year=@startYear, end_year=@endYear, number_screened=@numberScreened,
        confirmed_cases=@confirmedCases, iopd_cases=@iopdCases, lopd_cases=@lopdCases,
        reported_birth_prevalence=@reportedBirthPrevalence, screening_method=@screeningMethod,
        gaa_cutoff_description=@gaaCutoffDescription, study_period=@studyPeriod, source_id=@sourceId,
        last_verified=@lastVerified, review_status=@reviewStatus, notes=@notes,
        updated_at=CURRENT_TIMESTAMP WHERE id=@id
    `).run({ id: req.params.id, ...program });
    res.json(camelCaseRow(db.prepare("SELECT * FROM screening_programs WHERE id = ?").get(req.params.id)));
  });

  app.delete("/api/screening-programs/:id", requireAdmin, (req, res) => {
    const result = db.prepare("DELETE FROM screening_programs WHERE id = ?").run(req.params.id);
    if (result.changes === 0) throw new ApiError(404, "Screening programme not found.");
    res.status(204).end();
  });

  app.post("/api/estimates", requireAdmin, (req, res) => {
    const estimate = validateEstimate(req.body);
    const sourceIsApproved = hasApprovedSource(db, estimate.sourceId);
    if (estimate.reviewStatus === "APPROVED" && !sourceIsApproved) {
      throw new ApiError(400, "An approved evidence source is required to approve a public estimate.");
    }
    const id = optionalString(req.body.id, "id", 100) || crypto.randomUUID();
    db.prepare(`
      INSERT INTO epi_estimates
        (id, country_iso3, country_name, region, pompe_type, estimate_type, estimate_display,
         estimate_value, numerator, denominator, rate_per_100000, lower_confidence_interval,
         upper_confidence_interval, population_description, sample_size, study_start_year,
         study_end_year, publication_year, methodology, screening_based, evidence_quality,
         source_id, review_status, notes)
      VALUES
        (@id, @countryIso3, @countryName, @region, @pompeType, @estimateType, @estimateDisplay,
         @estimateValue, @numerator, @denominator, @ratePer100000, @lowerConfidenceInterval,
         @upperConfidenceInterval, @populationDescription, @sampleSize, @studyStartYear,
         @studyEndYear, @publicationYear, @methodology, @screeningBased, @evidenceQuality,
         @sourceId, @reviewStatus, @notes)
    `).run({ id, ...estimate });
    res.status(201).json(camelCaseRow(db.prepare("SELECT * FROM epi_estimates WHERE id = ?").get(id)));
  });

  app.patch("/api/estimates/:id", requireAdmin, (req, res) => {
    const current = db.prepare("SELECT * FROM epi_estimates WHERE id = ?").get(req.params.id);
    if (!current) throw new ApiError(404, "Epidemiology estimate not found.");
    const estimate = validateEstimate(req.body, {
      ...camelCaseRow(current),
      screeningBased: Boolean(current.screening_based),
    });
    const sourceIsApproved = hasApprovedSource(db, estimate.sourceId);
    if (estimate.reviewStatus === "APPROVED" && !sourceIsApproved) {
      throw new ApiError(400, "An approved evidence source is required to approve a public estimate.");
    }
    db.prepare(`
      UPDATE epi_estimates SET country_iso3=@countryIso3, country_name=@countryName, region=@region,
        pompe_type=@pompeType, estimate_type=@estimateType, estimate_display=@estimateDisplay,
        estimate_value=@estimateValue, numerator=@numerator, denominator=@denominator,
        rate_per_100000=@ratePer100000, lower_confidence_interval=@lowerConfidenceInterval,
        upper_confidence_interval=@upperConfidenceInterval, population_description=@populationDescription,
        sample_size=@sampleSize, study_start_year=@studyStartYear, study_end_year=@studyEndYear,
        publication_year=@publicationYear, methodology=@methodology, screening_based=@screeningBased,
        evidence_quality=@evidenceQuality, source_id=@sourceId, review_status=@reviewStatus,
        notes=@notes, updated_at=CURRENT_TIMESTAMP WHERE id=@id
    `).run({ id: req.params.id, ...estimate });
    res.json(camelCaseRow(db.prepare("SELECT * FROM epi_estimates WHERE id = ?").get(req.params.id)));
  });

  app.delete("/api/estimates/:id", requireAdmin, (req, res) => {
    const result = db.prepare("DELETE FROM epi_estimates WHERE id = ?").run(req.params.id);
    if (result.changes === 0) throw new ApiError(404, "Epidemiology estimate not found.");
    res.status(204).end();
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Route not found." });
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof ApiError ? error.status : (error.status || 500);
    if (status >= 500) console.error("Request failed:", error);
    res.status(status).json({
      error: status >= 500 ? "The server could not complete the request." : error.message,
    });
  });

  app.locals.database = db;
  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  app.listen(port, host, () => {
    console.log(`GlycoGuard running at http://${host}:${port}`);
    console.log(`SQLite database: ${process.env.DATABASE_PATH || DEFAULT_DB_PATH}`);
  });
}

module.exports = { createApp, ApiError, DEFAULT_DB_PATH };
