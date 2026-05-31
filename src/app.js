const DATA_URL = "/api/words";
const SESSION_SIZE = 50;
const NEW_WORDS_PER_SESSION = 25;
const MAX_ROWS = 200;
const STORAGE_KEY = "kotoba-engawa-state-v2";

const state = {
  words: [],
  levels: [],
  activeLevel: "all",
  query: "",
  mode: "flashcard",
  filterMode: "all",
  statsRange: "day",
  sessionOrder: "random",
  filteredWords: [],
  sessionWords: [],
  currentIndex: 0,
  selectedListExpression: "",
  learnedExpressions: new Set(),
  starredExpressions: new Set(),
  seenExpressions: new Set(),
  localActionLogs: [],
  exampleRequestId: 0,
  lastLoggedViewExpression: "",
  suppressNextViewLog: false,
};

const elements = {
  searchInput: document.querySelector("#search-input"),
  levelFilters: document.querySelector("#level-filters"),
  cardFilter: document.querySelector("#card-filter"),
  statsRange: document.querySelector("#stats-range"),
  studyMode: document.querySelector("#study-mode"),
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
  wordTable: document.querySelector("#word-table"),
  wordTableBody: document.querySelector("#word-table-body"),
  examplesList: document.querySelector("#examples-list"),
  studyStats: document.querySelector("#study-stats"),
  wordModal: document.querySelector("#word-modal"),
  modalTitle: document.querySelector("#modal-title"),
  modalReading: document.querySelector("#modal-reading"),
  modalMeaning: document.querySelector("#modal-meaning"),
  modalLevel: document.querySelector("#modal-level"),
  modalExamplesList: document.querySelector("#modal-examples-list"),
  statTotalWords: document.querySelector('[data-stat="totalWords"]'),
  statTotalLevels: document.querySelector('[data-stat="totalLevels"]'),
  statVisibleWords: document.querySelector('[data-stat="visibleWords"]'),
};

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }

    const payload = await response.json();
    state.words = payload.words;
    state.levels = payload.levels;

    restoreState();
    renderLevelFilters();
    bindEvents();
    updateFilterButtons();
    updateStatsRangeButtons();
    updateModeButtons();
    applyFilters({ preserveSession: true });
  } catch (error) {
    renderError(error);
  }
}

function bindEvents() {
  elements.searchInput.value = state.query;

  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    state.currentIndex = 0;
    applyFilters({ preserveSession: false });
  });

  elements.cardFilter.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) {
      return;
    }

    state.filterMode = button.dataset.filter;
    state.currentIndex = 0;
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

    state.statsRange = button.dataset.range;
    updateStatsRangeButtons();
    renderStats();
    persistState();
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
    if (event.target instanceof HTMLInputElement) {
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeWordModal();
    }
  });
}

function renderLevelFilters() {
  const counts = getLevelCounts();
  const levels = [
    { key: "all", label: "All", count: state.words.length },
    ...state.levels.map((level) => ({
      ...level,
      count: counts.get(level.key) || 0,
    })),
  ];

  elements.levelFilters.innerHTML = levels
    .map(
      (level) => `
        <tr>
          <td>
            <button
              type="button"
              class="level-chip ${level.key === state.activeLevel ? "is-active" : ""}"
              data-level="${level.key}"
            >
              ${level.label}
            </button>
          </td>
          <td>${formatNumber(level.count)}</td>
        </tr>
      `,
    )
    .join("");

  elements.levelFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-level]");
    if (!button) {
      return;
    }

    state.activeLevel = button.dataset.level;
    state.currentIndex = 0;
    for (const item of elements.levelFilters.querySelectorAll("[data-level]")) {
      item.classList.toggle("is-active", item === button);
    }

    applyFilters({ preserveSession: false });
  });
}

function applyFilters({ preserveSession }) {
  state.filteredWords = state.words.filter((word) => {
    const matchesLevel =
      state.activeLevel === "all" || word.level === state.activeLevel;
    if (!matchesLevel) {
      return false;
    }

    if (!matchesFilterMode(word)) {
      return false;
    }

    if (!state.query) {
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

    return haystack.includes(state.query);
  });

  if (!preserveSession || !restoreSessionFromStorage()) {
    createSession();
  }

  if (state.currentIndex >= state.sessionWords.length) {
    state.currentIndex = Math.max(0, state.sessionWords.length - 1);
  }

  render();
}

function createSession(order = state.sessionOrder) {
  const availableWords =
    state.filterMode === "all"
      ? state.filteredWords.filter(
          (word) => !state.learnedExpressions.has(word.expression),
        )
      : state.filteredWords;

  if (order === "ordered") {
    state.sessionWords = availableWords.slice(0, SESSION_SIZE);
    return;
  }

  const newWords = shuffle(
    availableWords.filter((word) => !state.seenExpressions.has(word.expression)),
  ).slice(0, NEW_WORDS_PER_SESSION);

  const oldWords = shuffle(
    availableWords.filter((word) => state.seenExpressions.has(word.expression)),
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
}

function restartSession(order) {
  state.sessionOrder = order === "ordered" ? "ordered" : "random";
  createSession(state.sessionOrder);
  state.currentIndex = 0;
  closeSettingsPanel();
  playCardMotion(state.sessionOrder === "ordered" ? "left" : "right");
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
  const startedAt =
    state.localActionLogs
      .map((log) => log.createdAt)
      .filter(Boolean)
      .sort()[0] || null;

  return {
    startedAt,
    endedAt: new Date().toISOString(),
    activeLevel: state.activeLevel,
    query: state.query,
    mode: state.mode,
    filterMode: state.filterMode,
    statsRange: state.statsRange,
    sessionOrder: state.sessionOrder,
    currentIndex: state.currentIndex,
    sessionExpressions: state.sessionWords.map((word) => word.expression),
    learnedExpressions: [...state.learnedExpressions],
    starredExpressions: [...state.starredExpressions],
    seenExpressions: [...state.seenExpressions],
    currentWord: getCurrentWord() || null,
    localActionLogs: state.localActionLogs,
  };
}

function resetStudyJourney() {
  state.activeLevel = "all";
  state.query = "";
  state.mode = "flashcard";
  state.filterMode = "all";
  state.statsRange = "day";
  state.sessionOrder = "random";
  state.currentIndex = 0;
  state.selectedListExpression = "";
  state.learnedExpressions = new Set();
  state.starredExpressions = new Set();
  state.seenExpressions = new Set();
  state.localActionLogs = [];
  state.lastLoggedViewExpression = "";
  state.suppressNextViewLog = true;

  elements.searchInput.value = "";
  for (const item of elements.levelFilters.querySelectorAll("[data-level]")) {
    item.classList.toggle("is-active", item.dataset.level === "all");
  }
  updateStatsRangeButtons();
  updateFilterButtons();
  updateModeButtons();
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
  updateModeButtons();
  updateModeVisibility();
  renderFlashcard();
  renderTable();
  renderStats();
  persistState();
}

function updateStats() {
  elements.statTotalWords.textContent = formatNumber(state.words.length);
  elements.statTotalLevels.textContent = String(state.levels.length);
  elements.statVisibleWords.textContent = formatNumber(state.sessionWords.length);

  const levelLabel =
    state.activeLevel === "all"
      ? "All levels"
      : state.levels.find((level) => level.key === state.activeLevel)?.label ??
        state.activeLevel.toUpperCase();

  elements.resultsSummary.textContent = `${levelLabel} • ${formatNumber(
    state.filteredWords.length,
  )} matching words`;
}

function renderFlashcard() {
  const currentWord = getCurrentWord();
  elements.flashcard.classList.remove("is-flipped");

  if (!currentWord) {
    elements.cardExpression.textContent = "Không có dữ liệu";
    elements.cardReading.textContent = "Tạo đợt học mới hoặc đổi bộ lọc.";
    elements.cardMeaning.textContent = "";
    elements.cardTags.innerHTML = "";
    elements.cardPosition.textContent = "0 / 0";
    elements.examplesList.innerHTML =
      "<p>Chưa có từ vựng trong đợt học hiện tại.</p>";
    return;
  }

  if (state.suppressNextViewLog) {
    state.suppressNextViewLog = false;
  } else {
    state.seenExpressions.add(currentWord.expression);
    logView(currentWord);
  }
  elements.cardExpression.textContent = currentWord.expression;
  elements.cardReading.textContent = currentWord.reading;
  elements.cardMeaning.textContent = currentWord.meaning;
  elements.cardTags.innerHTML = currentWord.tags
    .slice(0, 6)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  elements.cardPosition.textContent = `${state.currentIndex + 1} / ${state.sessionWords.length}`;
  updateFavoriteButton(currentWord);
  renderExamples(currentWord);
}

function renderTable() {
  elements.wordTableBody.innerHTML = "";
  elements.emptyState.hidden = state.filteredWords.length > 0;
  const rows = state.filteredWords.slice(0, MAX_ROWS);

  for (const word of rows) {
    const row = document.createElement("tr");
    const sessionIndex = state.sessionWords.findIndex(
      (item) => item.expression === word.expression,
    );
    row.dataset.expression = word.expression;
    row.classList.toggle(
      "is-selected",
      state.selectedListExpression === word.expression,
    );
    row.innerHTML = `
      <td><strong>${renderStar(word)}${escapeHtml(word.expression)}</strong></td>
      <td>${escapeHtml(word.reading)}</td>
      <td>${escapeHtml(word.meaning)}</td>
      <td><span class="level-badge">${escapeHtml(word.levelLabel)}</span></td>
    `;

    row.addEventListener("click", () => {
      state.selectedListExpression = word.expression;
      syncSelectedTableRow();
      persistState();
    });

    row.addEventListener("dblclick", () => {
      state.selectedListExpression = word.expression;
      if (sessionIndex >= 0) {
        state.currentIndex = sessionIndex;
      }
      syncSelectedTableRow();
      openWordModal(word);
    });

    elements.wordTableBody.appendChild(row);
  }

  syncSelectedTableRow();
}

function syncSelectedTableRow() {
  const currentWord = getCurrentWord();
  for (const row of elements.wordTableBody.querySelectorAll("tr")) {
    row.classList.toggle(
      "is-current",
      currentWord && row.dataset.expression === currentWord.expression,
    );
    row.classList.toggle(
      "is-selected",
      row.dataset.expression === state.selectedListExpression,
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
  if (!state.sessionWords.length) {
    return;
  }

  playCardMotion(direction < 0 ? "left" : "right");
  state.currentIndex =
    (state.currentIndex + direction + state.sessionWords.length) %
    state.sessionWords.length;

  render();
}

function markCurrentLearned() {
  const currentWord = getCurrentWord();
  if (!currentWord) {
    return;
  }

  state.learnedExpressions.add(currentWord.expression);
  state.seenExpressions.add(currentWord.expression);
  logAction("learned", currentWord);
  playCardMotion("up");
  state.sessionWords = state.sessionWords.filter(
    (word) => word.expression !== currentWord.expression,
  );

  if (state.currentIndex >= state.sessionWords.length) {
    state.currentIndex = Math.max(0, state.sessionWords.length - 1);
  }

  render();
}

function markCurrentUnlearned() {
  const currentWord = getCurrentWord();
  if (!currentWord) {
    return;
  }

  state.learnedExpressions.delete(currentWord.expression);
  state.seenExpressions.add(currentWord.expression);
  logAction("unlearned", currentWord);
  playCardMotion("down");
  state.sessionWords.splice(state.currentIndex, 1);
  state.sessionWords.push(currentWord);

  if (state.currentIndex >= state.sessionWords.length) {
    state.currentIndex = 0;
  }

  render();
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
  const currentWord = getCurrentWord();
  if (!currentWord) {
    return;
  }

  const isStarred = state.starredExpressions.has(currentWord.expression);
  if (isStarred) {
    state.starredExpressions.delete(currentWord.expression);
    logAction("unfavorite", currentWord);
  } else {
    state.starredExpressions.add(currentWord.expression);
    logAction("favorite", currentWord);
  }

  updateFavoriteButton(currentWord);
  renderTable();
  persistState();
}

function updateFavoriteButton(word) {
  const isStarred = state.starredExpressions.has(word.expression);
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

function restoreState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.activeLevel = stored.activeLevel || state.activeLevel;
    state.query = stored.query || "";
    state.mode = stored.mode || state.mode;
    state.filterMode = stored.filterMode || state.filterMode;
    state.statsRange = stored.statsRange || state.statsRange;
    state.sessionOrder = stored.sessionOrder || state.sessionOrder;
    state.currentIndex = Number(stored.currentIndex || 0);
    state.selectedListExpression = stored.selectedListExpression || "";
    state.learnedExpressions = new Set(stored.learnedExpressions || []);
    state.starredExpressions = new Set(stored.starredExpressions || []);
    state.seenExpressions = new Set(stored.seenExpressions || []);
    state.localActionLogs = Array.isArray(stored.localActionLogs)
      ? stored.localActionLogs
      : [];
  } catch (_error) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function restoreSessionFromStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!Array.isArray(stored.sessionExpressions)) {
      return false;
    }

    const filteredExpressionSet = new Set(
      state.filteredWords.map((word) => word.expression),
    );
    const wordsByExpression = new Map(
      state.words.map((word) => [word.expression, word]),
    );
    state.sessionWords = stored.sessionExpressions
      .filter((expression) => filteredExpressionSet.has(expression))
      .map((expression) => wordsByExpression.get(expression))
      .filter(Boolean)
      .slice(0, SESSION_SIZE);

    return state.sessionWords.length > 0;
  } catch (_error) {
    return false;
  }
}

function persistState() {
  const payload = {
    activeLevel: state.activeLevel,
    query: state.query,
    mode: state.mode,
    currentIndex: state.currentIndex,
    selectedListExpression: state.selectedListExpression,
    filterMode: state.filterMode,
    statsRange: state.statsRange,
    sessionOrder: state.sessionOrder,
    sessionExpressions: state.sessionWords.map((word) => word.expression),
    learnedExpressions: [...state.learnedExpressions],
    starredExpressions: [...state.starredExpressions],
    seenExpressions: [...state.seenExpressions],
    localActionLogs: state.localActionLogs,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function getCurrentWord() {
  return state.sessionWords[state.currentIndex];
}

function updateFilterButtons() {
  for (const item of elements.cardFilter.querySelectorAll("[data-filter]")) {
    item.classList.toggle("is-active", item.dataset.filter === state.filterMode);
  }
}

function updateStatsRangeButtons() {
  for (const item of elements.statsRange.querySelectorAll("[data-range]")) {
    item.classList.toggle("is-active", item.dataset.range === state.statsRange);
  }
}

function matchesFilterMode(word) {
  if (state.filterMode === "starred") {
    return state.starredExpressions.has(word.expression);
  }

  if (state.filterMode === "unstarred") {
    return !state.starredExpressions.has(word.expression);
  }

  if (state.filterMode === "learned") {
    return state.learnedExpressions.has(word.expression);
  }

  if (state.filterMode === "unlearned") {
    return !state.learnedExpressions.has(word.expression);
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

function renderStar(word) {
  return state.starredExpressions.has(word.expression)
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

function logView(word) {
  if (state.lastLoggedViewExpression === word.expression) {
    return;
  }

  state.lastLoggedViewExpression = word.expression;
  logAction("view", word);
}

function logAction(action, word) {
  state.localActionLogs.push({
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
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
      level: word.level,
      mode: state.mode,
      filterMode: state.filterMode,
      activeLevel: state.activeLevel,
      statsRange: state.statsRange,
      sessionOrder: state.sessionOrder,
      currentIndex: state.currentIndex,
      sessionSize: state.sessionWords.length,
      isLearned: state.learnedExpressions.has(word.expression),
      isStarred: state.starredExpressions.has(word.expression),
    },
    createdAt: new Date().toISOString(),
  });
  persistState();

  fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expression: word.expression,
      action,
      metadata: {
        level: word.level,
        mode: state.mode,
        filterMode: state.filterMode,
      },
    }),
  })
    .then(() => renderStats())
    .catch(() => renderLocalStats());
}

async function renderStats() {
  try {
    const response = await fetch(`/api/stats?range=${state.statsRange}`);
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
  const rows = summarizeLocalActionRows();
  const totals = summarizeActionRows(rows);
  if (!rows.length) {
    elements.studyStats.innerHTML = `
      <dl>
        <div><dt>Learned now</dt><dd>${formatNumber(state.learnedExpressions.size)}</dd></div>
        <div><dt>Starred now</dt><dd>${formatNumber(state.starredExpressions.size)}</dd></div>
        <div><dt>Batch</dt><dd>${formatNumber(state.sessionWords.length)}</dd></div>
      </dl>
      <p class="stats-note">Chưa có action log trong trình duyệt hiện tại.</p>
    `;
    return;
  }

  renderStatsPayload(rows, totals, "Local logs");
}

function renderStatsPayload(rows, totals, sourceLabel = "MySQL logs") {
  elements.studyStats.innerHTML = `
    <div class="stats-source">${sourceLabel}</div>
    <section class="stats-current">
      <p>Thông tin hiện trạng</p>
      <dl>
        <div><dt>Learned hiện tại</dt><dd>${formatNumber(state.learnedExpressions.size)}</dd></div>
        <div><dt>Đang đánh sao</dt><dd>${formatNumber(state.starredExpressions.size)}</dd></div>
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
  const rowsByBucket = new Map();
  for (const log of state.localActionLogs) {
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
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (state.statsRange === "month") {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return {
      key: `${year}-${month}`,
      label: `${year}-${month}`,
      start: `${year}-${month}-01`,
    };
  }

  if (state.statsRange === "week") {
    const weekStart = getWeekStart(date);
    const year = weekStart.getFullYear();
    const week = getIsoWeek(weekStart);
    const label = `${year}-W${String(week).padStart(2, "0")}`;
    return {
      key: label,
      label,
      start: formatDateKey(weekStart),
    };
  }

  const day = formatDateKey(date);
  return { key: day, label: day, start: day };
}

function getWeekStart(date) {
  const value = new Date(date);
  const day = value.getDay() || 7;
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - day + 1);
  return value;
}

function getIsoWeek(date) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil(((value - yearStart) / 86400000 + 1) / 7);
}

function formatDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function renderError(error) {
  elements.cardExpression.textContent = "Không tải được dữ liệu";
  elements.cardReading.textContent =
    "Hãy chạy `yarn build` và khởi động local server Express.";
  elements.cardMeaning.textContent = String(error.message || error);
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
  return items;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function highlightExpression(sentence, expression) {
  const escapedSentence = escapeHtml(sentence);
  const escapedExpression = escapeHtml(expression);
  return escapedSentence.replaceAll(
    escapedExpression,
    `<strong>${escapedExpression}</strong>`,
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
