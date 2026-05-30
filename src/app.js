const DATA_URL = "/api/words";
const MAX_ROWS = 150;

const state = {
  words: [],
  levels: [],
  activeLevel: "all",
  query: "",
  mode: "flashcard",
  filteredWords: [],
  currentIndex: 0,
};

const elements = {
  searchInput: document.querySelector("#search-input"),
  levelFilters: document.querySelector("#level-filters"),
  studyMode: document.querySelector("#study-mode"),
  randomBtn: document.querySelector("#random-btn"),
  shuffleBtn: document.querySelector("#shuffle-btn"),
  prevBtn: document.querySelector("#prev-btn"),
  nextBtn: document.querySelector("#next-btn"),
  flipBtn: document.querySelector("#flip-btn"),
  flashcardPanel: document.querySelector("#flashcard-panel"),
  listPanel: document.querySelector("#list-panel"),
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

    renderLevelFilters();
    bindEvents();
    applyFilters();
  } catch (error) {
    renderError(error);
  }
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    state.currentIndex = 0;
    applyFilters();
  });

  elements.studyMode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) {
      return;
    }

    state.mode = button.dataset.mode;
    for (const item of elements.studyMode.querySelectorAll("button")) {
      item.classList.toggle("is-active", item === button);
    }
    updateModeVisibility();
  });

  elements.randomBtn.addEventListener("click", () => {
    if (!state.filteredWords.length) {
      return;
    }
    state.currentIndex = Math.floor(Math.random() * state.filteredWords.length);
    renderFlashcard();
    syncSelectedTableRow();
  });

  elements.shuffleBtn.addEventListener("click", () => {
    state.filteredWords = shuffle([...state.filteredWords]);
    state.currentIndex = 0;
    render();
  });

  elements.prevBtn.addEventListener("click", () => stepCard(-1));
  elements.nextBtn.addEventListener("click", () => stepCard(1));
  elements.flipBtn.addEventListener("click", toggleFlip);
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
    } else if (event.key.toLowerCase() === "f") {
      toggleFlip();
    }
  });
}

function renderLevelFilters() {
  const levels = [{ key: "all", label: "Tất cả" }, ...state.levels];

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

    applyFilters();
  });
}

function applyFilters() {
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

  if (state.currentIndex >= state.filteredWords.length) {
    state.currentIndex = 0;
  }

  render();
}

function render() {
  updateStats();
  renderFlashcard();
  renderTable();
  updateModeVisibility();
}

function updateStats() {
  elements.statTotalWords.textContent = formatNumber(state.words.length);
  elements.statTotalLevels.textContent = String(state.levels.length);
  elements.statVisibleWords.textContent = formatNumber(state.filteredWords.length);

  const levelLabel =
    state.activeLevel === "all"
      ? "Tất cả level"
      : state.levels.find((level) => level.key === state.activeLevel)?.label ??
        state.activeLevel.toUpperCase();

  elements.resultsSummary.textContent = `${levelLabel} • ${formatNumber(
    state.filteredWords.length,
  )} từ`;
}

function renderFlashcard() {
  const currentWord = state.filteredWords[state.currentIndex];
  elements.flashcard.classList.remove("is-flipped");

  if (!currentWord) {
    elements.cardExpression.textContent = "Không có dữ liệu";
    elements.cardReading.textContent = "Hãy đổi level hoặc từ khóa tìm kiếm.";
    elements.cardMeaning.textContent = "";
    elements.cardTags.innerHTML = "";
    elements.cardPosition.textContent = "0 / 0";
    return;
  }

  elements.cardExpression.textContent = currentWord.expression;
  elements.cardReading.textContent = currentWord.reading;
  elements.cardMeaning.textContent = currentWord.meaning;
  elements.cardTags.innerHTML = currentWord.tags
    .slice(0, 6)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  elements.cardPosition.textContent = `${state.currentIndex + 1} / ${state.filteredWords.length}`;
}

function renderTable() {
  elements.wordTableBody.innerHTML = "";
  elements.emptyState.hidden = state.filteredWords.length > 0;
  const rows = state.filteredWords.slice(0, MAX_ROWS);

  for (const [index, word] of rows.entries()) {
    const row = document.createElement("tr");
    row.dataset.index = String(index);
    row.innerHTML = `
      <td><strong>${escapeHtml(word.expression)}</strong></td>
      <td>${escapeHtml(word.reading)}</td>
      <td>${escapeHtml(word.meaning)}</td>
      <td><span class="level-badge">${escapeHtml(word.levelLabel)}</span></td>
    `;

    row.addEventListener("click", () => {
      state.currentIndex = index;
      state.mode = "flashcard";
      for (const item of elements.studyMode.querySelectorAll("button")) {
        item.classList.toggle("is-active", item.dataset.mode === "flashcard");
      }
      render();
    });

    elements.wordTableBody.appendChild(row);
  }

  syncSelectedTableRow();
}

function syncSelectedTableRow() {
  for (const row of elements.wordTableBody.querySelectorAll("tr")) {
    row.style.background =
      Number(row.dataset.index) === state.currentIndex
        ? "rgba(184, 92, 56, 0.12)"
        : "";
  }
}

function updateModeVisibility() {
  elements.flashcardPanel.hidden = state.mode !== "flashcard";
  elements.listPanel.hidden = state.mode !== "list";
}

function stepCard(direction) {
  if (!state.filteredWords.length) {
    return;
  }

  state.currentIndex =
    (state.currentIndex + direction + state.filteredWords.length) %
    state.filteredWords.length;

  renderFlashcard();
  syncSelectedTableRow();
}

function toggleFlip() {
  if (!state.filteredWords.length) {
    return;
  }
  elements.flashcard.classList.toggle("is-flipped");
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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
