const DATA_URL = "/api/words";
const USERS_URL = "/api/users";
const SESSION_SIZE = 50;
const NEW_WORDS_PER_SESSION = 25;
const MAX_ROWS = 200;
const STORAGE_KEY = "kotoba-engawa-state-v3";
const LEVEL_ORDER = ["n5", "n4", "n3", "n2", "n1"];

const state = {
  words: [],
  levels: [],
  users: [],
  activeUserId: "",
  mode: "flashcard",
  filteredWords: [],
  sessionWords: [],
  exampleRequestId: 0,
  saveTimers: new Map(),
  hydratingUsers: new Set(),
  userStatesById: {},
};

const elements = {
  searchInput: document.querySelector("#search-input"),
  userSelect: document.querySelector("#user-select"),
  roadmapSummary: document.querySelector("#roadmap-summary"),
  roadmapList: document.querySelector("#roadmap-list"),
  cardFilter: document.querySelector("#card-filter"),
  statsRange: document.querySelector("#stats-range"),
  prevBtn: document.querySelector("#prev-btn"),
  nextBtn: document.querySelector("#next-btn"),
  learnedBtn: document.querySelector("#learned-btn"),
  unlearnedBtn: document.querySelector("#unlearned-btn"),
  favoriteBtn: document.querySelector("#favorite-btn"),
  settingsBtn: document.querySelector("#settings-btn"),
  archiveResetBtn: document.querySelector("#archive-reset-btn"),
  cardSettingsPanel: document.querySelector("#card-settings-panel"),
  appShell: document.querySelector(".app-shell"),
  studyLayout: document.querySelector(".study-layout"),
  focusArea: document.querySelector("#focus-card"),
  wordBank: document.querySelector("#word-bank"),
  flashcard: document.querySelector("#flashcard"),
  cardExpression: document.querySelector("#card-expression"),
  cardReading: document.querySelector("#card-reading"),
  cardMeaning: document.querySelector("#card-meaning"),
  cardTags: document.querySelector("#card-tags"),
  cardPosition: document.querySelector("#card-position"),
  resultsSummary: document.querySelector("#results-summary"),
  emptyState: document.querySelector("#empty-state"),
  wordTableBody: document.querySelector("#word-table-body"),
  examplesList: document.querySelector("#examples-list"),
  studyStats: document.querySelector("#study-stats"),
  wordModal: document.querySelector("#word-modal"),
  modalTitle: document.querySelector("#modal-title"),
  modalReading: document.querySelector("#modal-reading"),
  modalMeaning: document.querySelector("#modal-meaning"),
  modalLevel: document.querySelector("#modal-level"),
  modalExamplesList: document.querySelector("#modal-examples-list"),
  overviewModal: document.querySelector("#overview-modal"),
  overviewContent: document.querySelector("#overview-content"),
  totalWordsButton: document.querySelector("#total-words-button"),
  statTotalWords: document.querySelector('[data-stat="totalWords"]'),
  statCurrentLevel: document.querySelector('[data-stat="currentLevel"]'),
  statVisibleWords: document.querySelector('[data-stat="visibleWords"]'),
};

init();

async function init() {
  try {
    restoreAppState();

    const [wordsResponse, usersResponse] = await Promise.all([
      fetch(DATA_URL),
      fetch(USERS_URL),
    ]);

    if (!wordsResponse.ok) {
      throw new Error(`Failed to load data: ${wordsResponse.status}`);
    }

    if (!usersResponse.ok) {
      throw new Error(`Failed to load users: ${usersResponse.status}`);
    }

    const wordsPayload = await wordsResponse.json();
    const usersPayload = await usersResponse.json();

    state.words = wordsPayload.words || [];
    state.levels = sortLevels(wordsPayload.levels || []);
    state.users = Array.isArray(usersPayload.users) ? usersPayload.users : [];

    if (!state.users.length) {
      throw new Error("No test users available.");
    }

    ensureAllUserStates();
    if (!state.activeUserId || !state.users.some((user) => user.id === state.activeUserId)) {
      state.activeUserId = state.users[0].id;
    }

    renderUserSelect();
    bindEvents();
    await hydrateUserState(state.activeUserId);
    syncControlsFromUserState();
    updateFilterButtons();
    updateStatsRangeButtons();
    updateModeButtons();
    applyFilters({ preserveSession: true });
  } catch (error) {
    renderError(error);
  }
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    const studyState = getStudyState();
    studyState.query = event.target.value.trim().toLowerCase();
    studyState.currentIndex = 0;
    applyFilters({ preserveSession: false });
  });

  elements.userSelect.addEventListener("change", async (event) => {
    state.activeUserId = event.target.value;
    ensureUserState(state.activeUserId);
    await hydrateUserState(state.activeUserId);
    syncControlsFromUserState();
    updateFilterButtons();
    updateStatsRangeButtons();
    updateModeButtons();
    applyFilters({ preserveSession: true });
  });

  elements.cardFilter.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) {
      return;
    }

    const studyState = getStudyState();
    studyState.filterMode = button.dataset.filter;
    studyState.currentIndex = 0;
    updateFilterButtons();
    closeSettingsPanel();
    applyFilters({ preserveSession: false });
  });

  elements.cardSettingsPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-restart-session]");
    if (!button) {
      return;
    }

    restartSession(button.dataset.restartSession);
  });

  elements.archiveResetBtn.addEventListener("click", archiveAndResetStudy);

  elements.statsRange.addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) {
      return;
    }

    const studyState = getStudyState();
    studyState.statsRange = button.dataset.range;
    updateStatsRangeButtons();
    renderStats();
    persistAppState();
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) {
      return;
    }

    state.mode = button.dataset.mode;
    updateModeButtons();
    render();
  });

  elements.prevBtn.addEventListener("click", () => stepCard(-1));
  elements.nextBtn.addEventListener("click", () => stepCard(1));
  elements.learnedBtn.addEventListener("click", markCurrentLearned);
  elements.unlearnedBtn.addEventListener("click", markCurrentUnlearned);
  elements.favoriteBtn.addEventListener("click", toggleFavorite);
  elements.settingsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettingsPanel();
  });

  elements.cardSettingsPanel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  elements.flashcard.addEventListener("click", (event) => {
    if (event.target.closest("button, .card-settings-panel")) {
      return;
    }
    toggleFlip();
  });

  elements.flashcard.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleFlip();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    if (event.key === "ArrowLeft") {
      stepCard(-1);
    } else if (event.key === "ArrowRight") {
      stepCard(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      markCurrentLearned();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      markCurrentUnlearned();
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      toggleFavorite();
    } else if (event.key.toLowerCase() === "f") {
      toggleFlip();
    } else if (event.key === "Escape") {
      closeWordModal();
      closeOverviewModal();
      closeSettingsPanel();
    }
  });

  document.addEventListener("click", (event) => {
    if (
      elements.cardSettingsPanel.hidden ||
      event.target.closest("#settings-btn, #card-settings-panel")
    ) {
      return;
    }

    closeSettingsPanel();
  });

  elements.wordModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) {
      closeWordModal();
    }
  });

  elements.overviewModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-overview-close]")) {
      closeOverviewModal();
    }
  });

  elements.totalWordsButton.addEventListener("click", openOverviewModal);
}

function applyFilters({ preserveSession }) {
  const studyState = getStudyState();
  const currentLevel = getCurrentRoadmapLevel();
  const allowedLevel = currentLevel?.key || state.levels[0]?.key || "";

  state.filteredWords = state.words.filter((word) => {
    if (word.level !== allowedLevel) {
      return false;
    }

    if (!matchesFilterMode(word)) {
      return false;
    }

    if (!studyState.query) {
      return true;
    }

    const haystack = [
      word.expression,
      word.reading,
      word.meaning,
      word.levelLabel,
      word.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(studyState.query);
  });

  if (!preserveSession || !restoreSessionFromStudyState()) {
    createSession();
  }

  if (studyState.currentIndex >= state.sessionWords.length) {
    studyState.currentIndex = Math.max(0, state.sessionWords.length - 1);
  }

  render();
}

function createSession(order = getStudyState().sessionOrder) {
  const studyState = getStudyState();
  const availableWords =
    studyState.filterMode === "all"
      ? state.filteredWords.filter(
          (word) => !studyState.learnedExpressions.includes(word.expression),
        )
      : state.filteredWords;

  if (order === "ordered") {
    state.sessionWords = availableWords.slice(0, SESSION_SIZE);
    studyState.sessionExpressions = state.sessionWords.map((word) => word.expression);
    return;
  }

  const seenSet = new Set(studyState.seenExpressions);
  const newWords = shuffle(
    availableWords.filter((word) => !seenSet.has(word.expression)),
  ).slice(0, NEW_WORDS_PER_SESSION);

  const oldWords = shuffle(
    availableWords.filter((word) => seenSet.has(word.expression)),
  ).slice(0, SESSION_SIZE - newWords.length);

  const fallbackWords = shuffle(
    availableWords.filter(
      (word) =>
        !newWords.some((item) => item.expression === word.expression) &&
        !oldWords.some((item) => item.expression === word.expression),
    ),
  ).slice(0, SESSION_SIZE - newWords.length - oldWords.length);

  state.sessionWords = shuffle([...newWords, ...oldWords, ...fallbackWords]).slice(
    0,
    SESSION_SIZE,
  );
  studyState.sessionExpressions = state.sessionWords.map((word) => word.expression);
}

function restartSession(order) {
  const studyState = getStudyState();
  studyState.sessionOrder = order === "ordered" ? "ordered" : "random";
  createSession(studyState.sessionOrder);
  studyState.currentIndex = 0;
  closeSettingsPanel();
  playCardMotion(studyState.sessionOrder === "ordered" ? "left" : "right");
  render();
}

async function archiveAndResetStudy() {
  const originalLabel = elements.archiveResetBtn.innerHTML;
  elements.archiveResetBtn.disabled = true;
  elements.archiveResetBtn.innerHTML =
    "<strong>Đang archive...</strong><small>Đang lưu lịch sử học hiện tại.</small>";

  try {
    const response = await fetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createArchiveSnapshot()),
    });

    if (!response.ok) {
      throw new Error(`Archive failed: ${response.status}`);
    }

    await fetch(`/api/user-state/${encodeURIComponent(state.activeUserId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: createDefaultStudyState() }),
    }).catch(() => {});

    resetStudyJourney();
    closeSettingsPanel();
    playArchiveResetEffect();
  } catch (error) {
    elements.archiveResetBtn.innerHTML =
      "<strong>Archive thất bại</strong><small>Kiểm tra server log rồi thử lại.</small>";
    window.setTimeout(() => {
      elements.archiveResetBtn.innerHTML = originalLabel;
      elements.archiveResetBtn.disabled = false;
    }, 1800);
    console.error(error);
    return;
  }

  window.setTimeout(() => {
    elements.archiveResetBtn.innerHTML = originalLabel;
    elements.archiveResetBtn.disabled = false;
  }, 500);
}

function createArchiveSnapshot() {
  const studyState = getStudyState();
  const startedAt =
    studyState.localActionLogs
      .map((log) => log.createdAt)
      .filter(Boolean)
      .sort()[0] || null;

  return {
    userId: state.activeUserId,
    startedAt,
    endedAt: new Date().toISOString(),
    mode: state.mode,
    currentLevel: getCurrentRoadmapLevel()?.key || null,
    query: studyState.query,
    filterMode: studyState.filterMode,
    statsRange: studyState.statsRange,
    sessionOrder: studyState.sessionOrder,
    currentIndex: studyState.currentIndex,
    sessionExpressions: state.sessionWords.map((word) => word.expression),
    learnedExpressions: [...studyState.learnedExpressions],
    starredExpressions: [...studyState.starredExpressions],
    seenExpressions: [...studyState.seenExpressions],
    currentWord: getCurrentWord() || null,
    localActionLogs: studyState.localActionLogs,
  };
}

function resetStudyJourney() {
  state.userStatesById[state.activeUserId] = createDefaultStudyState();
  syncControlsFromUserState();
  applyFilters({ preserveSession: false });
}

function playArchiveResetEffect() {
  elements.appShell.classList.remove("is-archive-reset");
  void elements.appShell.offsetWidth;
  elements.appShell.classList.add("is-archive-reset");
  window.setTimeout(() => {
    elements.appShell.classList.remove("is-archive-reset");
  }, 520);
}

function render() {
  updateStats();
  updateFilterButtons();
  updateStatsRangeButtons();
  updateModeButtons();
  updateModeVisibility();
  renderRoadmap();
  renderFlashcard();
  renderTable();
  renderStats();
  renderOverviewContent();
  persistAppState();
}

function updateStats() {
  const currentLevel = getCurrentRoadmapLevel();
  const studyState = getStudyState();

  elements.statTotalWords.textContent = formatNumber(state.words.length);
  elements.statCurrentLevel.textContent = currentLevel?.label || "-";
  elements.statVisibleWords.textContent = formatNumber(state.filteredWords.length);
  elements.resultsSummary.textContent = `${currentLevel?.label || "-"} • ${formatNumber(
    state.filteredWords.length,
  )} từ • ${formatNumber(studyState.learnedExpressions.length)} đã thuộc`;
}

function renderRoadmap() {
  const items = getRoadmapItems();
  const currentItem = items.find((item) => item.status === "current") || items.at(-1);
  const completedCount = items.filter((item) => item.status === "complete").length;

  elements.roadmapSummary.innerHTML = `
    <strong>${escapeHtml(currentItem?.label || "-")} đang học</strong>
    <p>${formatNumber(completedCount)} / ${formatNumber(items.length)} cấp độ đã hoàn thành. Chỉ mở cấp độ tiếp theo khi hoàn tất cấp độ hiện tại.</p>
  `;

  elements.roadmapList.innerHTML = items
    .map(
      (item, index) => `
        <article class="roadmap-item is-${item.status}">
          <div class="roadmap-item__head">
            <span class="roadmap-item__badge">${escapeHtml(item.label)}</span>
            <strong>${item.percent}%</strong>
          </div>
          <div class="roadmap-item__bar">
            <span style="width: ${item.percent}%"></span>
          </div>
          <p>${formatNumber(item.learned)} / ${formatNumber(item.total)} từ</p>
          ${
            index < items.length - 1
              ? `<div class="roadmap-item__connector is-${item.connectorStatus}"></div>`
              : ""
          }
        </article>
      `,
    )
    .join("");
}

function renderFlashcard() {
  const studyState = getStudyState();
  const currentWord = getCurrentWord();
  elements.flashcard.classList.remove("is-flipped");

  if (!currentWord) {
    elements.cardExpression.textContent = "Không có dữ liệu";
    elements.cardReading.textContent = "Cấp độ hiện tại đã hoàn thành hoặc không có từ khớp.";
    elements.cardMeaning.textContent = "";
    elements.cardTags.innerHTML = "";
    elements.cardPosition.textContent = "0 / 0";
    elements.examplesList.innerHTML =
      "<p>Không còn từ trong phiên học hiện tại.</p>";
    return;
  }

  if (studyState.suppressNextViewLog) {
    studyState.suppressNextViewLog = false;
  } else {
    addUniqueValue(studyState.seenExpressions, currentWord.expression);
    logView(currentWord);
  }

  elements.cardExpression.textContent = currentWord.expression;
  elements.cardReading.textContent = currentWord.reading;
  elements.cardMeaning.textContent = currentWord.meaning;
  elements.cardTags.innerHTML = currentWord.tags
    .slice(0, 6)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  elements.cardPosition.textContent = `${studyState.currentIndex + 1} / ${state.sessionWords.length}`;
  updateFavoriteButton(currentWord);
  renderExamples(currentWord);
}

function renderTable() {
  const studyState = getStudyState();
  elements.wordTableBody.innerHTML = "";
  elements.emptyState.hidden = state.filteredWords.length > 0;
  const rows = state.filteredWords.slice(0, MAX_ROWS);

  for (const word of rows) {
    const row = document.createElement("tr");
    const sessionIndex = state.sessionWords.findIndex(
      (item) => item.expression === word.expression,
    );
    row.dataset.expression = word.expression;
    row.classList.toggle("is-selected", studyState.selectedListExpression === word.expression);
    row.innerHTML = `
      <td><strong>${renderStar(word)}${escapeHtml(word.expression)}</strong></td>
      <td>${escapeHtml(word.reading)}</td>
      <td>${escapeHtml(word.meaning)}</td>
      <td><span class="level-badge">${escapeHtml(word.levelLabel)}</span></td>
    `;

    row.addEventListener("click", () => {
      studyState.selectedListExpression = word.expression;
      syncSelectedTableRow();
      persistAppState();
    });

    row.addEventListener("dblclick", () => {
      studyState.selectedListExpression = word.expression;
      if (sessionIndex >= 0) {
        studyState.currentIndex = sessionIndex;
      }
      syncSelectedTableRow();
      openWordModal(word);
    });

    elements.wordTableBody.appendChild(row);
  }

  syncSelectedTableRow();
}

function syncSelectedTableRow() {
  const studyState = getStudyState();
  const currentWord = getCurrentWord();
  for (const row of elements.wordTableBody.querySelectorAll("tr")) {
    row.classList.toggle(
      "is-current",
      currentWord && row.dataset.expression === currentWord.expression,
    );
    row.classList.toggle(
      "is-selected",
      row.dataset.expression === studyState.selectedListExpression,
    );
  }
}

function updateModeVisibility() {
  elements.studyLayout.classList.toggle("is-list-mode", state.mode === "list");
  elements.focusArea.hidden = state.mode !== "flashcard";
  elements.wordBank.hidden = state.mode !== "list";
}

function updateModeButtons() {
  for (const item of document.querySelectorAll("[data-mode]")) {
    item.classList.toggle("is-active", item.dataset.mode === state.mode);
  }
}

function stepCard(direction) {
  const studyState = getStudyState();
  if (!state.sessionWords.length) {
    return;
  }

  playCardMotion(direction < 0 ? "left" : "right");
  studyState.currentIndex =
    (studyState.currentIndex + direction + state.sessionWords.length) %
    state.sessionWords.length;

  render();
}

function markCurrentLearned() {
  const studyState = getStudyState();
  const currentWord = getCurrentWord();
  if (!currentWord) {
    return;
  }

  addUniqueValue(studyState.learnedExpressions, currentWord.expression);
  addUniqueValue(studyState.seenExpressions, currentWord.expression);
  logAction("learned", currentWord);
  playCardMotion("up");
  state.sessionWords = state.sessionWords.filter(
    (word) => word.expression !== currentWord.expression,
  );
  studyState.sessionExpressions = state.sessionWords.map((word) => word.expression);

  if (studyState.currentIndex >= state.sessionWords.length) {
    studyState.currentIndex = Math.max(0, state.sessionWords.length - 1);
  }

  applyFilters({ preserveSession: false });
}

function markCurrentUnlearned() {
  const studyState = getStudyState();
  const currentWord = getCurrentWord();
  if (!currentWord) {
    return;
  }

  removeValue(studyState.learnedExpressions, currentWord.expression);
  addUniqueValue(studyState.seenExpressions, currentWord.expression);
  logAction("unlearned", currentWord);
  playCardMotion("down");
  state.sessionWords.splice(studyState.currentIndex, 1);
  state.sessionWords.push(currentWord);
  studyState.sessionExpressions = state.sessionWords.map((word) => word.expression);

  if (studyState.currentIndex >= state.sessionWords.length) {
    studyState.currentIndex = 0;
  }

  applyFilters({ preserveSession: false });
}

function toggleFlip() {
  if (!state.sessionWords.length) {
    return;
  }
  playCardMotion("flip");
  elements.flashcard.classList.toggle("is-flipped");
}

function toggleSettingsPanel() {
  const willOpen = elements.cardSettingsPanel.hidden;
  elements.cardSettingsPanel.hidden = !willOpen;
  elements.settingsBtn.setAttribute("aria-expanded", String(willOpen));
}

function closeSettingsPanel() {
  elements.cardSettingsPanel.hidden = true;
  elements.settingsBtn.setAttribute("aria-expanded", "false");
}

function playCardMotion(type) {
  const className = `is-motion-${type}`;
  elements.flashcard.classList.remove(
    "is-motion-flip",
    "is-motion-left",
    "is-motion-right",
    "is-motion-up",
    "is-motion-down",
  );
  void elements.flashcard.offsetWidth;
  elements.flashcard.classList.add(className);
  window.setTimeout(() => {
    elements.flashcard.classList.remove(className);
  }, 540);
}

function toggleFavorite() {
  const studyState = getStudyState();
  const currentWord = getCurrentWord();
  if (!currentWord) {
    return;
  }

  const isStarred = studyState.starredExpressions.includes(currentWord.expression);
  if (isStarred) {
    removeValue(studyState.starredExpressions, currentWord.expression);
    logAction("unfavorite", currentWord);
  } else {
    addUniqueValue(studyState.starredExpressions, currentWord.expression);
    logAction("favorite", currentWord);
  }

  updateFavoriteButton(currentWord);
  renderTable();
  persistAppState();
}

function updateFavoriteButton(word) {
  const studyState = getStudyState();
  const isStarred = studyState.starredExpressions.includes(word.expression);
  elements.favoriteBtn.classList.toggle("is-starred", isStarred);
  elements.favoriteBtn.textContent = isStarred ? "★" : "☆";
}

async function renderExamples(word) {
  const requestId = (state.exampleRequestId += 1);
  elements.examplesList.innerHTML = "<p>Loading examples...</p>";

  try {
    const response = await fetch(
      `/api/examples/${encodeURIComponent(word.expression)}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to load examples: ${response.status}`);
    }

    const payload = await response.json();
    if (requestId !== state.exampleRequestId) {
      return;
    }

    const examples = payload.examples?.length
      ? payload.examples
      : getDefaultExamples(word);

    elements.examplesList.innerHTML = renderExampleItems(examples, word);
  } catch (_error) {
    if (requestId !== state.exampleRequestId) {
      return;
    }

    elements.examplesList.innerHTML = renderExampleItems(
      getDefaultExamples(word),
      word,
    );
  }
}

function renderExampleItems(examples, word) {
  return examples
    .slice(0, 3)
    .map(
      (example) => `
        <article class="example-item">
          <p>${highlightExpression(example.sentence, word.expression)}</p>
          ${
            example.translation
              ? `<small>${escapeHtml(example.translation)}</small>`
              : ""
          }
        </article>
      `,
    )
    .join("");
}

function getDefaultExamples(word) {
  return [
    {
      sentence: `${word.expression} の例文はまだ登録されていません。`,
    },
    {
      sentence: `${word.expression} を使った短い文を追加できます。`,
    },
    {
      sentence: `${word.expression} の自然な使い方を後で保存してください。`,
    },
  ];
}

function restoreAppState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.activeUserId = stored.activeUserId || "";
    state.mode = stored.mode || "flashcard";
    state.userStatesById = normalizeStoredUserStates(stored.userStatesById || {});
  } catch (_error) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function renderUserSelect() {
  elements.userSelect.innerHTML = state.users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`,
    )
    .join("");
  elements.userSelect.value = state.activeUserId;
}

async function hydrateUserState(userId) {
  if (!userId) {
    return;
  }

  state.hydratingUsers.add(userId);
  ensureUserState(userId);

  try {
    const response = await fetch(`/api/user-state/${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error(`Failed to load user state: ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.state) {
      state.userStatesById[userId] = normalizeStudyState(payload.state);
    }
  } catch (_error) {
    // Keep local fallback when API persistence is unavailable.
  } finally {
    state.hydratingUsers.delete(userId);
  }
}

function syncControlsFromUserState() {
  const studyState = getStudyState();
  elements.searchInput.value = studyState.query || "";
  elements.userSelect.value = state.activeUserId;
}

function restoreSessionFromStudyState() {
  const studyState = getStudyState();
  if (!Array.isArray(studyState.sessionExpressions)) {
    return false;
  }

  const filteredExpressionSet = new Set(
    state.filteredWords.map((word) => word.expression),
  );
  const wordsByExpression = new Map(
    state.words.map((word) => [word.expression, word]),
  );

  state.sessionWords = studyState.sessionExpressions
    .filter((expression) => filteredExpressionSet.has(expression))
    .map((expression) => wordsByExpression.get(expression))
    .filter(Boolean)
    .slice(0, SESSION_SIZE);

  return state.sessionWords.length > 0;
}

function persistAppState() {
  const payload = {
    activeUserId: state.activeUserId,
    mode: state.mode,
    userStatesById: state.userStatesById,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  scheduleUserStateSync(state.activeUserId);
}

function scheduleUserStateSync(userId) {
  if (!userId || state.hydratingUsers.has(userId)) {
    return;
  }

  window.clearTimeout(state.saveTimers.get(userId));
  const timer = window.setTimeout(() => {
    saveUserState(userId);
  }, 350);
  state.saveTimers.set(userId, timer);
}

async function saveUserState(userId) {
  const studyState = state.userStatesById[userId];
  if (!studyState) {
    return;
  }

  try {
    await fetch(`/api/user-state/${encodeURIComponent(userId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: studyState }),
    });
  } catch (_error) {
    // Local state remains available even if remote persistence fails.
  }
}

function getCurrentWord() {
  return state.sessionWords[getStudyState().currentIndex];
}

function updateFilterButtons() {
  const studyState = getStudyState();
  for (const item of elements.cardFilter.querySelectorAll("[data-filter]")) {
    item.classList.toggle("is-active", item.dataset.filter === studyState.filterMode);
  }
}

function updateStatsRangeButtons() {
  const studyState = getStudyState();
  for (const item of elements.statsRange.querySelectorAll("[data-range]")) {
    item.classList.toggle("is-active", item.dataset.range === studyState.statsRange);
  }
}

function matchesFilterMode(word) {
  const studyState = getStudyState();
  if (studyState.filterMode === "starred") {
    return studyState.starredExpressions.includes(word.expression);
  }

  if (studyState.filterMode === "unstarred") {
    return !studyState.starredExpressions.includes(word.expression);
  }

  if (studyState.filterMode === "learned") {
    return studyState.learnedExpressions.includes(word.expression);
  }

  if (studyState.filterMode === "unlearned") {
    return !studyState.learnedExpressions.includes(word.expression);
  }

  return true;
}

function getLevelCounts() {
  const counts = new Map();
  for (const word of state.words) {
    counts.set(word.level, (counts.get(word.level) || 0) + 1);
  }
  return counts;
}

function getRoadmapItems() {
  const studyState = getStudyState();
  const counts = getLevelCounts();
  const currentLevel = getCurrentRoadmapLevel();

  return state.levels.map((level) => {
    const total = counts.get(level.key) || 0;
    const learned = state.words.filter(
      (word) =>
        word.level === level.key &&
        studyState.learnedExpressions.includes(word.expression),
    ).length;
    const percent = total ? Math.round((learned / total) * 100) : 0;
    const status =
      percent >= 100
        ? "complete"
        : currentLevel?.key === level.key
          ? "current"
          : LEVEL_ORDER.indexOf(level.key) > LEVEL_ORDER.indexOf(currentLevel?.key || level.key)
            ? "locked"
            : "upcoming";

    return {
      ...level,
      total,
      learned,
      percent,
      status,
      connectorStatus: percent >= 100 ? "complete" : status === "current" ? "current" : "locked",
    };
  });
}

function getCurrentRoadmapLevel() {
  const studyState = getStudyState();

  for (const level of state.levels) {
    const total = state.words.filter((word) => word.level === level.key).length;
    const learned = state.words.filter(
      (word) =>
        word.level === level.key &&
        studyState.learnedExpressions.includes(word.expression),
    ).length;

    if (learned < total) {
      return level;
    }
  }

  return state.levels.at(-1) || null;
}

function renderStar(word) {
  const studyState = getStudyState();
  return studyState.starredExpressions.includes(word.expression)
    ? '<span class="inline-star">★</span>'
    : "";
}

function openWordModal(word) {
  elements.modalTitle.textContent = word.expression;
  elements.modalReading.textContent = word.reading || "-";
  elements.modalMeaning.textContent = word.meaning || "-";
  elements.modalLevel.textContent = word.levelLabel || "-";
  renderModalExamples(word);
  elements.wordModal.hidden = false;
}

async function renderModalExamples(word) {
  elements.modalExamplesList.innerHTML = "<p>Loading examples...</p>";

  try {
    const response = await fetch(
      `/api/examples/${encodeURIComponent(word.expression)}`,
    );
    if (!response.ok) {
      throw new Error("examples unavailable");
    }

    const payload = await response.json();
    const examples = payload.examples?.length
      ? payload.examples
      : getDefaultExamples(word);
    elements.modalExamplesList.innerHTML = renderExampleItems(examples, word);
  } catch (_error) {
    elements.modalExamplesList.innerHTML = renderExampleItems(
      getDefaultExamples(word),
      word,
    );
  }
}

function closeWordModal() {
  elements.wordModal.hidden = true;
}

function openOverviewModal() {
  renderOverviewContent();
  elements.overviewModal.hidden = false;
}

function closeOverviewModal() {
  elements.overviewModal.hidden = true;
}

function renderOverviewContent() {
  const studyState = getStudyState();
  const counts = getLevelCounts();
  const rows = state.levels
    .map((level) => {
      const total = counts.get(level.key) || 0;
      const learned = state.words.filter(
        (word) =>
          word.level === level.key &&
          studyState.learnedExpressions.includes(word.expression),
      ).length;
      const percent = total ? Math.round((learned / total) * 100) : 0;

      return `
        <div class="overview-row">
          <div>
            <strong>${escapeHtml(level.label)}</strong>
            <p>${formatNumber(learned)} / ${formatNumber(total)} từ</p>
          </div>
          <div class="overview-row__bar">
            <span style="width: ${percent}%"></span>
          </div>
          <b>${percent}%</b>
        </div>
      `;
    })
    .join("");

  elements.overviewContent.innerHTML = `
    <p class="overview-note">Tổng số từ hiện có: ${formatNumber(state.words.length)}. Popup này thay cho việc click trực tiếp vào bảng JLPT Level cũ.</p>
    <div class="overview-grid">${rows}</div>
  `;
}

function logView(word) {
  const studyState = getStudyState();
  if (studyState.lastLoggedViewExpression === word.expression) {
    return;
  }

  studyState.lastLoggedViewExpression = word.expression;
  logAction("view", word);
}

function logAction(action, word) {
  const studyState = getStudyState();
  studyState.localActionLogs.push({
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    userId: state.activeUserId,
    expression: word.expression,
    action,
    word: {
      expression: word.expression,
      reading: word.reading,
      meaning: word.meaning,
      level: word.level,
      levelLabel: word.levelLabel,
      tags: word.tags,
    },
    metadata: {
      userId: state.activeUserId,
      level: word.level,
      mode: state.mode,
      filterMode: studyState.filterMode,
      currentLevel: getCurrentRoadmapLevel()?.key || null,
      statsRange: studyState.statsRange,
      sessionOrder: studyState.sessionOrder,
      currentIndex: studyState.currentIndex,
      sessionSize: state.sessionWords.length,
      isLearned: studyState.learnedExpressions.includes(word.expression),
      isStarred: studyState.starredExpressions.includes(word.expression),
    },
    createdAt: new Date().toISOString(),
  });
  persistAppState();

  fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: state.activeUserId,
      expression: word.expression,
      action,
      metadata: {
        userId: state.activeUserId,
        level: word.level,
        mode: state.mode,
        filterMode: studyState.filterMode,
      },
    }),
  })
    .then(() => renderStats())
    .catch(() => renderLocalStats());
}

async function renderStats() {
  const studyState = getStudyState();

  try {
    const response = await fetch(
      `/api/stats?range=${encodeURIComponent(studyState.statsRange)}&user_id=${encodeURIComponent(state.activeUserId)}`,
    );
    if (!response.ok) {
      throw new Error("stats unavailable");
    }

    const payload = await response.json();
    const rows = payload.rows || [];
    if (!rows.length) {
      renderLocalStats();
      return;
    }

    renderStatsPayload(rows, payload.totals || summarizeActionRows(rows));
  } catch (_error) {
    renderLocalStats();
  }
}

function renderLocalStats() {
  const studyState = getStudyState();
  const rows = summarizeLocalActionRows();
  const totals = summarizeActionRows(rows);
  if (!rows.length) {
    elements.studyStats.innerHTML = `
      <dl>
        <div><dt>Learned now</dt><dd>${formatNumber(studyState.learnedExpressions.length)}</dd></div>
        <div><dt>Starred now</dt><dd>${formatNumber(studyState.starredExpressions.length)}</dd></div>
        <div><dt>Batch</dt><dd>${formatNumber(state.sessionWords.length)}</dd></div>
      </dl>
      <p class="stats-note">Chưa có action log cho user hiện tại.</p>
    `;
    return;
  }

  renderStatsPayload(rows, totals, "Local logs");
}

function renderStatsPayload(rows, totals, sourceLabel = "MySQL logs") {
  const studyState = getStudyState();
  elements.studyStats.innerHTML = `
    <div class="stats-source">${sourceLabel}</div>
    <section class="stats-current">
      <p>Thông tin hiện trạng</p>
      <dl>
        <div><dt>User</dt><dd>${escapeHtml(getActiveUser()?.name || "-")}</dd></div>
        <div><dt>Learned hiện tại</dt><dd>${formatNumber(studyState.learnedExpressions.length)}</dd></div>
        <div><dt>Đang đánh sao</dt><dd>${formatNumber(studyState.starredExpressions.length)}</dd></div>
      </dl>
    </section>
    <dl class="stats-summary-grid">
      <div><dt>Total actions</dt><dd>${formatNumber(Number(totals.total_actions || 0))}</dd></div>
      <div><dt>Views</dt><dd>${formatNumber(Number(totals.view_count || 0))}</dd></div>
      <div><dt>Learned</dt><dd>${formatNumber(Number(totals.learned_count || 0))}</dd></div>
      <div><dt>Not yet</dt><dd>${formatNumber(Number(totals.unlearned_count || 0))}</dd></div>
      <div><dt>Stars</dt><dd>${formatNumber(Number(totals.favorite_count || 0))}</dd></div>
      <div><dt>Unstars</dt><dd>${formatNumber(Number(totals.unfavorite_count || 0))}</dd></div>
    </dl>
  `;
}

function summarizeActionRows(rows) {
  return rows.reduce(
    (summary, row) => ({
      total_actions: summary.total_actions + Number(row.total_actions || 0),
      view_count: summary.view_count + Number(row.view_count || 0),
      learned_count: summary.learned_count + Number(row.learned_count || 0),
      unlearned_count: summary.unlearned_count + Number(row.unlearned_count || 0),
      favorite_count: summary.favorite_count + Number(row.favorite_count || 0),
      unfavorite_count:
        summary.unfavorite_count + Number(row.unfavorite_count || 0),
    }),
    {
      total_actions: 0,
      view_count: 0,
      learned_count: 0,
      unlearned_count: 0,
      favorite_count: 0,
      unfavorite_count: 0,
    },
  );
}

function summarizeLocalActionRows() {
  const studyState = getStudyState();
  const rowsByBucket = new Map();
  for (const log of studyState.localActionLogs) {
    const bucket = getLocalStatsBucket(log.createdAt);
    if (!bucket) {
      continue;
    }

    if (!rowsByBucket.has(bucket.key)) {
      rowsByBucket.set(bucket.key, {
        bucket: bucket.label,
        bucket_start: bucket.start,
        total_actions: 0,
        view_count: 0,
        learned_count: 0,
        unlearned_count: 0,
        favorite_count: 0,
        unfavorite_count: 0,
      });
    }

    const row = rowsByBucket.get(bucket.key);
    row.total_actions += 1;
    if (log.action === "view") row.view_count += 1;
    if (log.action === "learned") row.learned_count += 1;
    if (log.action === "unlearned") row.unlearned_count += 1;
    if (log.action === "favorite") row.favorite_count += 1;
    if (log.action === "unfavorite") row.unfavorite_count += 1;
  }

  return [...rowsByBucket.values()]
    .sort((a, b) => String(b.bucket_start).localeCompare(String(a.bucket_start)))
    .slice(0, 12);
}

function getLocalStatsBucket(createdAt) {
  const studyState = getStudyState();
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (studyState.statsRange === "month") {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return {
      key: `${year}-${month}`,
      label: `${year}-${month}`,
      start: `${year}-${month}-01`,
    };
  }

  if (studyState.statsRange === "week") {
    const weekStart = new Date(date);
    const day = weekStart.getDay() || 7;
    weekStart.setDate(weekStart.getDate() - day + 1);
    const year = weekStart.getFullYear();
    const month = String(weekStart.getMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(weekStart.getDate()).padStart(2, "0");
    return {
      key: `${year}-${month}-${dayOfMonth}`,
      label: `${year}-${month}-${dayOfMonth}`,
      start: `${year}-${month}-${dayOfMonth}`,
    };
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    key: `${year}-${month}-${day}`,
    label: `${year}-${month}-${day}`,
    start: `${year}-${month}-${day}`,
  };
}

function getStudyState() {
  ensureUserState(state.activeUserId);
  return state.userStatesById[state.activeUserId];
}

function getActiveUser() {
  return state.users.find((user) => user.id === state.activeUserId) || null;
}

function ensureAllUserStates() {
  for (const user of state.users) {
    ensureUserState(user.id);
  }
}

function ensureUserState(userId) {
  if (!userId) {
    return;
  }

  if (!state.userStatesById[userId]) {
    state.userStatesById[userId] = createDefaultStudyState();
  } else {
    state.userStatesById[userId] = normalizeStudyState(state.userStatesById[userId]);
  }
}

function createDefaultStudyState() {
  return {
    query: "",
    filterMode: "all",
    statsRange: "day",
    sessionOrder: "random",
    currentIndex: 0,
    selectedListExpression: "",
    sessionExpressions: [],
    learnedExpressions: [],
    starredExpressions: [],
    seenExpressions: [],
    localActionLogs: [],
    lastLoggedViewExpression: "",
    suppressNextViewLog: false,
  };
}

function normalizeStoredUserStates(value) {
  const normalized = {};
  if (!value || typeof value !== "object") {
    return normalized;
  }

  for (const [userId, studyState] of Object.entries(value)) {
    normalized[userId] = normalizeStudyState(studyState);
  }

  return normalized;
}

function normalizeStudyState(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    query: String(raw.query || ""),
    filterMode: ["all", "starred", "unstarred", "learned", "unlearned"].includes(raw.filterMode)
      ? raw.filterMode
      : "all",
    statsRange: ["day", "week", "month"].includes(raw.statsRange)
      ? raw.statsRange
      : "day",
    sessionOrder: raw.sessionOrder === "ordered" ? "ordered" : "random",
    currentIndex: Number(raw.currentIndex || 0),
    selectedListExpression: String(raw.selectedListExpression || ""),
    sessionExpressions: normalizeStringArray(raw.sessionExpressions),
    learnedExpressions: normalizeStringArray(raw.learnedExpressions),
    starredExpressions: normalizeStringArray(raw.starredExpressions),
    seenExpressions: normalizeStringArray(raw.seenExpressions),
    localActionLogs: Array.isArray(raw.localActionLogs) ? raw.localActionLogs : [],
    lastLoggedViewExpression: String(raw.lastLoggedViewExpression || ""),
    suppressNextViewLog: Boolean(raw.suppressNextViewLog),
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item)).filter(Boolean))]
    : [];
}

function addUniqueValue(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function removeValue(list, value) {
  const index = list.indexOf(value);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

function sortLevels(levels) {
  return [...levels].sort((left, right) => {
    return LEVEL_ORDER.indexOf(left.key) - LEVEL_ORDER.indexOf(right.key);
  });
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightExpression(sentence, expression) {
  const safeSentence = escapeHtml(sentence);
  const safeExpression = escapeHtml(expression);
  if (!safeExpression) {
    return safeSentence;
  }

  return safeSentence.replaceAll(safeExpression, `<strong>${safeExpression}</strong>`);
}

function renderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `
    <main style="padding: 32px; font-family: sans-serif;">
      <h1>Application error</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  `;
}
