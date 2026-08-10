"use strict";
(() => {
  // src/webview/history-renderer.ts
  function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  function relativeTime(authoredAt, now = /* @__PURE__ */ new Date()) {
    const elapsed = Math.max(0, now.getTime() - Date.parse(authoredAt));
    const minutes = Math.floor(elapsed / 6e4);
    if (minutes < 1) {
      return "\u521A\u521A";
    }
    if (minutes < 60) {
      return `${String(minutes)} \u5206\u949F\u524D`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${String(hours)} \u5C0F\u65F6\u524D`;
    }
    const days = Math.floor(hours / 24);
    if (days < 30) {
      return `${String(days)} \u5929\u524D`;
    }
    return new Date(authoredAt).toLocaleDateString("zh-CN");
  }
  function laneX(lane, pitch) {
    return 8 + lane * pitch;
  }
  function edgePath(edge, pitch, height) {
    const from = laneX(edge.fromLane, pitch);
    const to = laneX(edge.toLane, pitch);
    return `M ${String(from)} 0 C ${String(from)} ${String(height * 0.35)} ${String(to)} ${String(height * 0.65)} ${String(to)} ${String(height)}`;
  }
  function renderGraphMarkup(commit, graphWidth, lanePitch) {
    const height = 28;
    const center = height / 2;
    const nodeX = laneX(commit.lane, lanePitch);
    const passing = commit.passingEdges.map(
      (edge) => `<path class="graph-line lane-color-${String(edge.color % 6)}" d="${edgePath(edge, lanePitch, height)}"></path>`
    ).join("");
    const incoming = commit.hasIncoming ? `<path class="graph-line lane-color-${String(commit.color % 6)}" d="M ${String(nodeX)} 0 L ${String(nodeX)} ${String(center)}"></path>` : "";
    const parents = commit.parentEdges.map((edge) => {
      const parentX = laneX(edge.toLane, lanePitch);
      return `<path class="graph-line lane-color-${String(edge.color % 6)}" d="M ${String(nodeX)} ${String(center)} C ${String(nodeX)} ${String(center + 7)} ${String(parentX)} ${String(height - 7)} ${String(parentX)} ${String(height)}"></path>`;
    }).join("");
    const current = commit.refs.some((ref) => ref.kind === "head");
    const merge = commit.parents.length > 1;
    return `<svg class="commit-graph" width="${String(graphWidth)}" height="${String(height)}" viewBox="0 0 ${String(graphWidth)} ${String(height)}" aria-hidden="true">` + passing + incoming + parents + `<circle class="graph-node lane-color-${String(commit.color % 6)}${current ? " current" : ""}${merge ? " merge" : ""}" cx="${String(nodeX)}" cy="${String(center)}" r="${merge ? "4" : "3.25"}"></circle></svg>`;
  }
  function refMarkup(commit) {
    return commit.refs.map((ref) => {
      const label = ref.name;
      const title = ref.kind === "head" ? `HEAD \xB7 ${ref.name}` : ref.name;
      const icon = ref.kind === "remote" ? "cloud" : "git-branch";
      return `<span class="commit-ref ${ref.kind}" title="${escapeHtml(title)}"><span class="codicon codicon-${icon}" aria-hidden="true"></span><span class="commit-ref-label">${escapeHtml(label)}</span></span>`;
    }).join("");
  }
  function splitFilePath(path) {
    const segments = path.split("/");
    return {
      name: segments.pop() ?? path,
      directory: segments.join("/")
    };
  }
  function fileMarkup(file) {
    const path = splitFilePath(file.path);
    return `<button class="history-file" type="button" data-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}"><span class="history-file-guide" aria-hidden="true"></span><span class="codicon codicon-file history-file-icon" aria-hidden="true"></span><span class="history-file-name">${escapeHtml(path.name)}</span>` + (path.directory.length === 0 ? "" : `<span class="history-file-directory">${escapeHtml(path.directory)}</span>`) + `<span class="history-file-status status-${escapeHtml(file.status.at(0) ?? "M")}">${escapeHtml(file.status)}</span></button>`;
  }
  function renderCommitRowMarkup(commit, options) {
    const expanded = options.expanded === true;
    const time = relativeTime(commit.authoredAt, options.now);
    const refs = commit.refs.map((ref) => ref.kind === "head" ? `HEAD \xB7 ${ref.name}` : ref.name).join(" \xB7 ");
    const title = [
      commit.subject,
      `${commit.author} \xB7 ${commit.authoredAt} \xB7 ${commit.hash}`,
      refs
    ].filter((value) => value.length > 0).join("\n");
    const files = expanded ? `<div class="history-files">${(options.files ?? []).map(fileMarkup).join("")}</div>` : "";
    const refsMarkup = commit.refs.length === 0 ? "" : `<span class="history-refs">${refMarkup(commit)}</span>`;
    return `<article class="history-entry${expanded ? " expanded" : ""}" role="listitem" data-hash="${commit.hash}"><button class="history-commit-row" type="button" aria-expanded="${String(expanded)}" title="${escapeHtml(title)}">` + renderGraphMarkup(commit, options.graphWidth, options.lanePitch) + `<span class="codicon codicon-chevron-${expanded ? "down" : "right"} history-chevron" aria-hidden="true"></span><span class="history-commit-copy"><span class="history-subject">${escapeHtml(commit.subject)}</span>` + refsMarkup + `<span class="history-meta"><span class="history-author">${escapeHtml(commit.author)}</span><span class="history-time">${escapeHtml(time)}</span><span class="history-hash">${escapeHtml(commit.shortHash)}</span></span></span></button>` + files + "</article>";
  }
  function graphMetrics(commits) {
    const laneCount = Math.max(1, ...commits.map((commit) => commit.laneCount));
    const width = Math.min(92, 16 + (laneCount - 1) * 12);
    return {
      width,
      pitch: laneCount === 1 ? 12 : (width - 16) / (laneCount - 1)
    };
  }
  function renderHistory(container, commits, expandedHashes, details, callbacks) {
    const metrics = graphMetrics(commits);
    container.innerHTML = commits.map((commit) => renderCommitRowMarkup(commit, {
      expanded: expandedHashes.has(commit.hash),
      graphWidth: metrics.width,
      lanePitch: metrics.pitch,
      ...details.get(commit.hash) === void 0 ? {} : { files: details.get(commit.hash) ?? [] }
    })).join("");
    for (const entry of container.querySelectorAll(".history-entry")) {
      const hash = entry.dataset.hash;
      if (hash === void 0) {
        continue;
      }
      entry.querySelector(".history-commit-row")?.addEventListener("click", () => {
        callbacks.toggleCommit(hash, !expandedHashes.has(hash));
      });
      for (const file of entry.querySelectorAll(".history-file")) {
        const path = file.dataset.path;
        if (path !== void 0) {
          file.addEventListener("click", () => {
            callbacks.openCommitDiff(hash, path);
          });
        }
      }
    }
  }

  // src/webview/history-client.ts
  function requiredElement(id) {
    const value = document.getElementById(id);
    if (value === null) {
      throw new Error(`\u7F3A\u5C11\u63D0\u4EA4\u5386\u53F2\u63A7\u4EF6\uFF1A${id}`);
    }
    return value;
  }
  var vscode = acquireVsCodeApi();
  var layoutElement = document.querySelector(".history-layout");
  if (layoutElement === null) {
    throw new Error("\u7F3A\u5C11\u63D0\u4EA4\u5386\u53F2\u4E3B\u5E03\u5C40");
  }
  var layout = layoutElement;
  var syncSummary = requiredElement("sync-summary");
  var historyStatus = requiredElement("history-status");
  var historyList = requiredElement("history-list");
  var expandedCommits = /* @__PURE__ */ new Set();
  var commitDetails = /* @__PURE__ */ new Map();
  var currentModel;
  var currentScope = "";
  var sequence = 0;
  function post(message) {
    vscode.postMessage(message);
  }
  function render(model) {
    const nextScope = `${model.currentRepositoryId ?? ""}:${String(model.version)}`;
    if (nextScope !== currentScope) {
      currentScope = nextScope;
      expandedCommits.clear();
      commitDetails.clear();
    }
    currentModel = model;
    layout.setAttribute("aria-busy", String(model.history.kind === "loading"));
    syncSummary.textContent = model.sync.kind === "ready" ? `${model.sync.upstream} \xB7 \u2191${String(model.sync.ahead)} \u2193${String(model.sync.behind)}` : model.sync.kind === "detached" ? "\u6E38\u79BB HEAD" : "\u672A\u8BBE\u7F6E\u4E0A\u6E38";
    const status = model.history.kind === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u63D0\u4EA4\u5386\u53F2\u2026" : model.history.kind === "failed" ? model.history.message : model.history.commits.length === 0 ? "\u6682\u65E0\u63D0\u4EA4\u8BB0\u5F55" : "";
    historyStatus.textContent = status;
    historyStatus.hidden = status.length === 0;
    historyStatus.classList.toggle("error-status", model.history.kind === "failed");
    renderHistory(historyList, model.history.commits, expandedCommits, commitDetails, {
      toggleCommit: (hash, expanded) => {
        if (expanded) {
          expandedCommits.add(hash);
          if (!commitDetails.has(hash) && model.currentRepositoryId !== void 0) {
            sequence += 1;
            post({
              type: "loadCommitDetails",
              repositoryId: model.currentRepositoryId,
              version: model.version,
              hash,
              requestId: `details-${String(sequence)}`
            });
          }
        } else {
          expandedCommits.delete(hash);
        }
        render(model);
      },
      openCommitDiff: (hash, path) => {
        if (model.currentRepositoryId === void 0) {
          return;
        }
        sequence += 1;
        post({
          type: "openCommitDiff",
          repositoryId: model.currentRepositoryId,
          version: model.version,
          hash,
          path,
          requestId: `history-diff-${String(sequence)}`
        });
      }
    });
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (typeof message !== "object" || message === null || !("type" in message)) {
      return;
    }
    if (message.type === "commitDetails") {
      const details = message;
      if (currentModel?.currentRepositoryId === details.repositoryId && currentModel.version === details.version) {
        commitDetails.set(details.details.hash, details.details.files);
        render(currentModel);
      }
      return;
    }
    if (message.type === "state" && "model" in message) {
      render(message.model);
    }
  });
  post({ type: "ready" });
})();
