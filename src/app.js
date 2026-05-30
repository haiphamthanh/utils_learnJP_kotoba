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
  filteredWords: [],
  sessionWords: [],
  currentIndex: 0,
  learnedExpressions: new Set(),
  seenExpressions: new Set(),
  exampleRequestId: 0,
};

const elements = {
  searchInput: document.querySelector("#search-input"),
  levelFilters: document.querySelector("#level-filters"),
  studyMode: document.querySelector("#study-mode"),
  randomBtn: document.querySelector("#random-btn"),
  newSessionBtn: document.querySelector("#new-session-btn"),
  prevBtn: document.querySelector("#prev-btn"),
  nextBtn: document.querySelector("#next-btn"),
  flipBtn: document.querySelector("#flip-btn"),
  learnedBtn: document.querySelector("#learned-btn"),
  unlearnedBtn: document.querySelector("#unlearned-btn"),
  studyLayout: document.querySelector(".study-layout"),
  focusArea: document.querySelector("#focus-card"),
  wordBank: document.querySelector("#word-bank"),
  sidePanel: document.querySelector(".side-panel"),
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

  elements.studyMode.addEventListener("click", (event) => {
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
  elements.flipBtn.addEventListener("click", toggleFlip);
  elements.learnedBtn.addEventListener("click", markCurrentLearned);
  elements.unlearnedBtn.addEventListener("click", markCurrentUnlearned);
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
    } else if (event.key.toLowerCase() === "f") {
      toggleFlip();
    }
  });
}

function renderLevelFilters() {
  const levels = [{ key: "all", label: "All" }, ...state.levels];

  elements.levelFilters.innerHTML = levels
    .map(
      (level) => `
        <button
          type="button"
          class="level-chip ${level.key === state.activeLevel ? "is-active" : ""}"
          data-level="${level.key}"
        >
          ${level.label}
        </button>
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
  const availableWords = state.filteredWords.filter(
    (word) => !state.learnedExpressions.has(word.expression),
  );

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
  updateModeVisibility();
  renderFlashcard();
  renderTable();
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
    state.sessionWords.length,
  )}/${SESSION_SIZE} in this batch`;
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
  elements.cardExpression.textContent = currentWord.expression;
  elements.cardReading.textContent = currentWord.reading;
  elements.cardMeaning.textContent = currentWord.meaning;
  elements.cardTags.innerHTML = currentWord.tags
    .slice(0, 6)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  elements.cardPosition.textContent = `${state.currentIndex + 1} / ${state.sessionWords.length}`;
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
    row.innerHTML = `
      <td><strong>${escapeHtml(word.expression)}</strong></td>
      <td>${escapeHtml(word.reading)}</td>
      <td>${escapeHtml(word.meaning)}</td>
      <td><span class="level-badge">${escapeHtml(word.levelLabel)}</span></td>
    `;

    row.addEventListener("click", () => {
      if (sessionIndex >= 0) {
        state.currentIndex = sessionIndex;
      } else {
        state.sessionWords.unshift(word);
        state.sessionWords = state.sessionWords.slice(0, SESSION_SIZE);
        state.currentIndex = 0;
      }
      state.mode = "flashcard";
      updateModeButtons();
      render();
    });

    elements.wordTableBody.appendChild(row);
  }

  syncSelectedTableRow();
}

function syncSelectedTableRow() {
  const currentWord = getCurrentWord();
  for (const row of elements.wordTableBody.querySelectorAll("tr")) {
    row.style.background =
      currentWord && row.dataset.expression === currentWord.expression
        ? "rgba(38, 58, 99, 0.08)"
        : "";
  }
}

function updateModeVisibility() {
  elements.studyLayout.classList.toggle("is-list-mode", state.mode === "list");
  elements.focusArea.hidden = state.mode !== "flashcard";
  elements.wordBank.hidden = state.mode !== "list";
  elements.sidePanel.hidden = state.mode !== "flashcard";
}

function updateModeButtons() {
  for (const item of elements.studyMode.querySelectorAll("button")) {
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
    state.currentIndex = Number(stored.currentIndex || 0);
    state.learnedExpressions = new Set(stored.learnedExpressions || []);
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
    sessionExpressions: state.sessionWords.map((word) => word.expression),
    learnedExpressions: [...state.learnedExpressions],
    seenExpressions: [...state.seenExpressions],
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function getCurrentWord() {
  return state.sessionWords[state.currentIndex];
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
