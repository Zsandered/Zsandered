"use strict";

(() => {
  const TOKEN_KEY = "glycoguard-admin-token";
  const kinds = {
    sources: {
      label: "sources",
      endpoint: "/api/admin/sources",
      updateEndpoint: (record) => `/api/sources/${encodeURIComponent(record.id)}`,
      title: (record) => record.title || record.organization || record.id,
      details: [
        ["Authors", "authors"],
        ["Organization", "organization"],
        ["Type", "sourceType"],
        ["Year", "publicationYear"],
        ["Topic", "topic"],
        ["URL", "url"],
      ],
    },
    programs: {
      label: "screening programmes",
      endpoint: "/api/admin/screening-programs",
      updateEndpoint: (record) => `/api/screening-programs/${encodeURIComponent(record.id)}`,
      title: (record) => record.programName || record.countryName || record.id,
      details: [
        ["Country", "countryName"],
        ["Region", "region"],
        ["Screening status", "screeningStatus"],
        ["Scope", "programScope"],
        ["Study period", "studyPeriod"],
        ["Source ID", "sourceId"],
      ],
    },
    estimates: {
      label: "estimates",
      endpoint: "/api/admin/estimates",
      updateEndpoint: (record) => `/api/estimates/${encodeURIComponent(record.id)}`,
      title: (record) => `${record.countryName || "Unspecified location"} · ${record.estimateDisplay || record.id}`,
      details: [
        ["Measure", "estimateType"],
        ["Pompe type", "pompeType"],
        ["Region", "region"],
        ["Publication year", "publicationYear"],
        ["Evidence quality", "evidenceQuality"],
        ["Source ID", "sourceId"],
      ],
    },
  };
  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || "",
    kind: "sources",
    status: "ALL",
    search: "",
    records: { sources: [], programs: [], estimates: [] },
  };
  const authCard = document.querySelector("#auth-card");
  const authForm = document.querySelector("#auth-form");
  const tokenInput = document.querySelector("#admin-token");
  const dashboard = document.querySelector("#dashboard");
  const notice = document.querySelector("#notice");
  const logoutButton = document.querySelector("#logout");
  const recordList = document.querySelector("#record-list");
  const stats = document.querySelector("#stats");

  function setNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.hidden = !message;
  }

  async function apiRequest(endpoint, options = {}) {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${state.token}`,
        ...options.headers,
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const message = payload && typeof payload === "object" ? payload.error : payload;
      const error = new Error(message || `Request failed with HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function signOut(message = "") {
    state.token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    dashboard.hidden = true;
    logoutButton.hidden = true;
    authCard.hidden = false;
    tokenInput.value = "";
    if (message) setNotice(message, true);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null && text !== "") element.textContent = String(text);
    return element;
  }

  function detailValue(record, field) {
    const value = record[field];
    if (value === null || value === undefined || value === "") return "";
    if (field === "url") return value;
    return String(value);
  }

  function renderRecord(record, config) {
    const article = createElement("article", "record");
    const header = createElement("div", "record-head");
    const title = createElement("h3", "", config.title(record));
    const badge = createElement("span", "badge", record.reviewStatus || "UNKNOWN");
    badge.dataset.status = record.reviewStatus || "UNKNOWN";
    header.append(title, badge);
    article.append(header);

    const meta = createElement("div", "record-meta");
    meta.append(
      createElement("span", "", `ID: ${record.id}`),
      createElement("span", "", `Updated: ${record.updatedAt || "unknown"}`),
    );
    article.append(meta);

    const detailGrid = createElement("div", "record-details");
    config.details.forEach(([label, field]) => {
      const value = detailValue(record, field);
      if (!value) return;
      const detail = createElement("div", "detail");
      const strong = createElement("strong", "", `${label}: `);
      detail.append(strong, document.createTextNode(value));
      detailGrid.append(detail);
    });
    if (detailGrid.childElementCount) article.append(detailGrid);

    if (record.notes) article.append(createElement("div", "detail", `Notes: ${record.notes}`));
    const actions = createElement("div", "record-actions");
    actions.append(createElement("span", "push"));
    const actionList = [
      ["APPROVED", "Approve", "button approve"],
      ["PENDING_REVIEW", "Needs review", "button"],
      ["REJECTED", "Reject", "button reject"],
      ["ARCHIVED", "Archive", "button"],
    ];
    actionList.forEach(([status, label, className]) => {
      if (record.reviewStatus === status) return;
      const button = createElement("button", className, label);
      button.type = "button";
      button.addEventListener("click", () => updateStatus(record, status, button));
      actions.append(button);
    });
    article.append(actions);
    return article;
  }

  function render() {
    const config = kinds[state.kind];
    const search = state.search.trim().toLowerCase();
    const records = state.records[state.kind].filter((record) => {
      const statusMatches = state.status === "ALL" || record.reviewStatus === state.status;
      const searchMatches = !search || Object.values(record).some((value) =>
        value !== null && value !== undefined && String(value).toLowerCase().includes(search));
      return statusMatches && searchMatches;
    });
    recordList.replaceChildren();
    if (!records.length) {
      const empty = createElement("div", "empty");
      empty.append(
        createElement("strong", "", "No matching records"),
        document.createTextNode(`There are no ${config.label} for the selected search and review status.`),
      );
      recordList.append(empty);
    } else {
      records.forEach((record) => recordList.append(renderRecord(record, config)));
    }
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.kind === state.kind));
    });
  }

  function renderStats() {
    const allRecords = Object.values(state.records).flat();
    const summaries = [
      ["Total records", allRecords.length],
      ["Pending review", allRecords.filter((record) => ["DRAFT", "PENDING_REVIEW"].includes(record.reviewStatus)).length],
      ["Approved", allRecords.filter((record) => record.reviewStatus === "APPROVED").length],
      ["Rejected / archived", allRecords.filter((record) => ["REJECTED", "ARCHIVED"].includes(record.reviewStatus)).length],
    ];
    stats.replaceChildren(...summaries.map(([label, value]) => {
      const card = createElement("div", "stat");
      card.append(createElement("span", "", label), createElement("strong", "", value));
      return card;
    }));
  }

  async function loadRecords() {
    try {
      const [sources, programs, estimates] = await Promise.all([
        apiRequest(kinds.sources.endpoint),
        apiRequest(kinds.programs.endpoint),
        apiRequest(kinds.estimates.endpoint),
      ]);
      state.records = { sources, programs, estimates };
      renderStats();
      render();
      authCard.hidden = true;
      dashboard.hidden = false;
      logoutButton.hidden = false;
      setNotice(`Loaded ${sources.length} sources, ${programs.length} screening programmes, and ${estimates.length} estimates.`);
    } catch (error) {
      if (error.status === 401 || error.status === 503) {
        signOut(error.message);
        return;
      }
      setNotice(`Could not load evidence records: ${error.message}`, true);
    }
  }

  async function updateStatus(record, reviewStatus, button) {
    if (["REJECTED", "ARCHIVED"].includes(reviewStatus)
      && !window.confirm(`${reviewStatus === "REJECTED" ? "Reject" : "Archive"} this record?`)) return;
    button.disabled = true;
    try {
      const config = kinds[state.kind];
      await apiRequest(config.updateEndpoint(record), {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus }),
      });
      setNotice(`Record ${record.id} updated to ${reviewStatus}.`);
      await loadRecords();
    } catch (error) {
      if (error.status === 401 || error.status === 503) {
        signOut(error.message);
        return;
      }
      button.disabled = false;
      setNotice(`Could not update ${record.id}: ${error.message}`, true);
    }
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.token = tokenInput.value.trim();
    if (!state.token) return;
    setNotice("Checking authorization…");
    try {
      await apiRequest(kinds.sources.endpoint);
      sessionStorage.setItem(TOKEN_KEY, state.token);
      await loadRecords();
    } catch (error) {
      signOut(error.message || "Sign-in failed.");
    }
  });

  logoutButton.addEventListener("click", () => signOut("Signed out."));
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.kind = tab.dataset.kind;
      render();
    });
  });
  document.querySelector("#status-filter").addEventListener("change", (event) => {
    state.status = event.target.value;
    render();
  });
  document.querySelector("#search").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });
  if (state.token) loadRecords();
})();
