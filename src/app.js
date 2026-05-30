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
  filteredWords: [],
  sessionWords: [],
  currentIndex: 0,
  selectedListExpression: "",
  learnedExpressions: new Set(),
  starredExpressions: new Set(),
  seenExpressions: new Set(),
  exampleRequestId: 0,
  lastLoggedViewExpression: "",
};

const elements = {
  searchInput: document.querySelector("#search-input"),
  levelFilters: document.querySelector("#level-filters"),
  cardFilter: document.querySelector("#card-filter"),
  statsRange: document.querySelector("#stats-range"),
  studyMode: document.querySelector("#study-mode"),
  randomBtn: document.querySelector("#random-btn"),
  newSessionBtn: document.querySelector("#new-session-btn"),
  prevBtn: document.querySelector("#prev-btn"),
  nextBtn: document.querySelector("#next-btn"),
  learnedBtn: document.querySelector("#learned-btn"),
  unlearnedBtn: document.querySelector("#unlearned-btn"),
  favoriteBtn: document.querySelector("#favorite-btn"),
  sessionActions: document.querySelector(".session-actions"),
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
    applyFilters({ preserveSession: false });
  });

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

  elements.randomBtn.addEventListener("click", () => {
    if (!state.sessionWords.length) {
      return;
    }
    state.currentIndex = Math.floor(Math.random() * state.sessionWords.length);
    render();
  });

  elements.newSessionBtn.addEventListener("click", () => {
    createSession();
    state.currentIndex = 0;
    render();
  });

  elements.prevBtn.addEventListener("click", () => stepCard(-1));
  elements.nextBtn.addEventListener("click", () => stepCard(1));
  elements.learnedBtn.addEventListener("click", markCurrentLearned);
  elements.unlearnedBtn.addEventListener("click", markCurrentUnlearned);
  elements.favoriteBtn.addEventListener("click", toggleFavorite);
  elements.flashcard.addEventListener("click", toggleFlip);
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

function createSession() {
  const availableWords =
    state.filterMode === "all"
      ? state.filteredWords.filter(
          (word) => !state.learnedExpressions.has(word.expression),
        )
      : state.filteredWords;

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

  state.seenExpressions.add(currentWord.expression);
  logView(currentWord);
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
  elements.sessionActions.hidden = state.mode !== "flashcard";
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
  elements.flashcard.classList.toggle("is-flipped");
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

    elements.examplesList.innerHTML = examples
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
  } catch (_error) {
    if (requestId !== state.exampleRequestId) {
      return;
    }

    elements.examplesList.innerHTML = getDefaultExamples(word)
      .map(
        (example) => `
          <article class="example-item">
            <p>${highlightExpression(example.sentence, word.expression)}</p>
          </article>
        `,
      )
      .join("");
  }
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
    state.currentIndex = Number(stored.currentIndex || 0);
    state.selectedListExpression = stored.selectedListExpression || "";
    state.learnedExpressions = new Set(stored.learnedExpressions || []);
    state.starredExpressions = new Set(stored.starredExpressions || []);
    state.seenExpressions = new Set(stored.seenExpressions || []);
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
    sessionExpressions: state.sessionWords.map((word) => word.expression),
    learnedExpressions: [...state.learnedExpressions],
    starredExpressions: [...state.starredExpressions],
    seenExpressions: [...state.seenExpressions],
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
  elements.wordModal.hidden = false;
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
  }).catch(() => {});
}

async function renderStats() {
  try {
    const response = await fetch(`/api/stats?range=${state.statsRange}`);
    if (!response.ok) {
      throw new Error("stats unavailable");
    }

    const payload = await response.json();
    const row = payload.rows?.[0];
    if (!row) {
      renderLocalStats();
      return;
    }

    elements.studyStats.innerHTML = `
      <dl>
        <div><dt>Views</dt><dd>${formatNumber(Number(row.view_count || 0))}</dd></div>
        <div><dt>Learned</dt><dd>${formatNumber(Number(row.learned_count || 0))}</dd></div>
        <div><dt>Not yet</dt><dd>${formatNumber(Number(row.unlearned_count || 0))}</dd></div>
        <div><dt>Stars</dt><dd>${formatNumber(Number(row.favorite_count || 0))}</dd></div>
        <div><dt>Unstars</dt><dd>${formatNumber(Number(row.unfavorite_count || 0))}</dd></div>
      </dl>
    `;
  } catch (_error) {
    renderLocalStats();
  }
}

function renderLocalStats() {
  elements.studyStats.innerHTML = `
    <dl>
      <div><dt>Learned</dt><dd>${formatNumber(state.learnedExpressions.size)}</dd></div>
      <div><dt>Starred</dt><dd>${formatNumber(state.starredExpressions.size)}</dd></div>
      <div><dt>Batch</dt><dd>${formatNumber(state.sessionWords.length)}</dd></div>
    </dl>
  `;
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
