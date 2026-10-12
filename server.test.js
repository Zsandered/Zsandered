"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const { createApp } = require("./server");

const previousAdminToken = process.env.ADMIN_TOKEN;
const adminToken = "test-only-token-that-is-long-enough";
let server;
let database;
let baseUrl;

before(async () => {
  process.env.ADMIN_TOKEN = adminToken;
  const app = createApp({ databasePath: ":memory:" });
  database = app.locals.database;
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database?.close();
  if (previousAdminToken === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = previousAdminToken;
});

test("serves dashboard frontend only through the app route", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  const dashboardHtml = await page.text();
  assert.match(dashboardHtml, /GlycoGuard/);
  assert.match(dashboardHtml, /id="mutation-cause"/);
  assert.match(dashboardHtml, /"\/disease": \["disease", "mutation-cause", "types"\]/);

  for (const route of ["/disease", "/numbers", "/screening", "/clinical", "/genetics", "/references"]) {
    const topicPage = await fetch(`${baseUrl}${route}`);
    assert.equal(topicPage.status, 200, `${route} should load the dashboard shell`);
    assert.match(topicPage.headers.get("content-type"), /text\/html/);
    assert.match(await topicPage.text(), new RegExp(`href="${route}"`));
  }

  const unknownPage = await fetch(`${baseUrl}/not-a-topic`);
  assert.equal(unknownPage.status, 404);

  const script = await fetch(`${baseUrl}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);

  const serverSource = await fetch(`${baseUrl}/server.js`);
  assert.equal(serverSource.status, 404);

  const adminPage = await fetch(`${baseUrl}/admin`);
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.headers.get("content-type"), /text\/html/);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Evidence administration/);
  assert.match(adminHtml, /admin-theme\.css/);

  const adminScript = await fetch(`${baseUrl}/admin.js`);
  assert.equal(adminScript.status, 200);
  assert.match(adminScript.headers.get("content-type"), /javascript/);
  assert.match(await adminScript.text(), /sessionStorage/);

  const contrastStyles = await fetch(`${baseUrl}/contrast.css`);
  assert.equal(contrastStyles.status, 200);
  assert.match(contrastStyles.headers.get("content-type"), /text\/css/);

  const adminStyles = await fetch(`${baseUrl}/admin-theme.css`);
  assert.equal(adminStyles.status, 200);
  assert.match(adminStyles.headers.get("content-type"), /text\/css/);
});

test("exposes only approved and source-linked seed data publicly", async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.deepEqual(health, { status: "ok", storage: "sqlite" });

  const apiIndexResponse = await fetch(`${baseUrl}/api`);
  assert.equal(apiIndexResponse.status, 200);
  const apiIndex = await apiIndexResponse.json();
  assert.equal(apiIndex.name, "GlycoGuard Evidence API");
  assert.ok(apiIndex.publicEndpoints.some((endpoint) => endpoint.path === "/api/estimates"));
  assert.ok(apiIndex.adminEndpoints.some((endpoint) => endpoint.path === "/api/admin/estimates"));

  const estimates = await fetch(`${baseUrl}/api/estimates`).then((response) => response.json());
  assert.equal(estimates.length, 14);
  assert.ok(estimates.every((estimate) => estimate.reviewStatus === "APPROVED" && estimate.source.title));

  const screening = await fetch(`${baseUrl}/api/screening-programs`).then((response) => response.json());
  assert.equal(screening.length, 10);
  assert.ok(screening.every((program) => program.reviewStatus === "APPROVED" && program.source.url));
  assert.equal(screening.find((program) => program.id === "screen-pa").iopdCases, 2);
  assert.equal(screening.find((program) => program.id === "screen-pa").lopdCases, 31);
});

test("filters estimates by measure and screening programmes by status", async () => {
  const birthEstimates = await fetch(`${baseUrl}/api/estimates?type=BIRTH_PREVALENCE`).then((response) => response.json());
  assert.equal(birthEstimates.length, 6);
  assert.ok(birthEstimates.every((estimate) => estimate.estimateType === "BIRTH_PREVALENCE"));

  const pilots = await fetch(`${baseUrl}/api/screening-programs?status=PILOT`).then((response) => response.json());
  assert.equal(pilots.length, 5);
  assert.ok(pilots.every((program) => program.screeningStatus === "PILOT"));

  const invalidFilter = await fetch(`${baseUrl}/api/estimates?type=MADE_UP`);
  assert.equal(invalidFilter.status, 400);
});

test("requires an admin bearer token and keeps pending entries private", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/admin/estimates`);
  assert.equal(unauthorized.status, 401);

  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const draftResponse = await fetch(`${baseUrl}/api/estimates`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      countryName: "Test region",
      pompeType: "ALL",
      estimateType: "BIRTH_PREVALENCE",
      estimateDisplay: "1 in 100,000",
      screeningBased: false,
      sourceId: "kong-2024",
    }),
  });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal(draft.reviewStatus, "PENDING_REVIEW");

  const publicRecords = await fetch(`${baseUrl}/api/estimates`).then((response) => response.json());
  assert.ok(!publicRecords.some((estimate) => estimate.id === draft.id));

  const approvedResponse = await fetch(`${baseUrl}/api/estimates/${draft.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ reviewStatus: "APPROVED" }),
  });
  assert.equal(approvedResponse.status, 200);
  const approved = await approvedResponse.json();
  assert.equal(approved.reviewStatus, "APPROVED");

  const updatedPublicRecords = await fetch(`${baseUrl}/api/estimates`).then((response) => response.json());
  assert.ok(updatedPublicRecords.some((estimate) => estimate.id === draft.id));
});

test("validates provenance and required quantitative display values", async () => {
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(`${baseUrl}/api/estimates`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      countryName: "Test region",
      pompeType: "ALL",
      estimateType: "BIRTH_PREVALENCE",
      screeningBased: false,
      sourceId: "missing-source",
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /estimateDisplay is required/);

  const badSourceResponse = await fetch(`${baseUrl}/api/estimates`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      countryName: "Test region",
      pompeType: "ALL",
      estimateType: "BIRTH_PREVALENCE",
      estimateDisplay: "1 in 100,000",
      screeningBased: false,
      sourceId: "missing-source",
    }),
  });
  assert.equal(badSourceResponse.status, 400);
  assert.match((await badSourceResponse.json()).error, /existing evidence source/);
});
