import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(".");
const srcDir = resolve(rootDir, "src");
const wordListDir = resolve(rootDir, "word-list");
const grammarDir = resolve(rootDir, "grammar");
const distDir = resolve(rootDir, "dist");
const dataDir = resolve(distDir, "data");

build();

function build() {
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
  }

  cpSync(srcDir, distDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const payload = buildWordPayload();
  writeFileSync(
    resolve(dataDir, "words.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  buildGrammarPayload();

  console.log(`Built static site at: ${distDir}`);
}

function buildWordPayload() {
  const levels = [];
  const words = [];

  const csvFiles = readdirSync(wordListDir)
    .filter((fileName) => fileName.endsWith(".csv"))
    .sort();

  for (const fileName of csvFiles) {
    const levelKey = fileName.replace(/\.csv$/u, "").toLowerCase();
    const levelLabel = levelKey.toUpperCase();
    let sequenceNumber = 0;

    levels.push({
      key: levelKey,
      label: levelLabel,
    });

    const filePath = resolve(wordListDir, fileName);
    const rawContent = readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
    const rows = parseCsv(rawContent);

    for (const row of rows) {
      const expression = (row.expression || "").trim();
      const reading = (row.reading || "").trim();
      const meaning = (row.meaning || "").trim();
      const tags = splitTags(row.tags || "");
      const learned = parseBoolean(row.learned);

      if (!expression) {
        continue;
      }

      sequenceNumber += 1;
      const wordKey = `${levelKey}:${sequenceNumber}`;

      words.push({
        id: wordKey,
        wordKey,
        level: levelKey,
        levelLabel,
        sequenceNumber,
        learned,
        expression,
        reading,
        meaning,
        tags,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    levels,
    words,
  };
}

function buildGrammarPayload() {
  const grammarFile = resolve(grammarDir, "links.json");
  if (!existsSync(grammarFile)) {
    writeFileSync(resolve(dataDir, "grammar-links.json"), JSON.stringify({}, null, 2), "utf8");
    return;
  }

  const payload = JSON.parse(readFileSync(grammarFile, "utf8"));
  writeFileSync(
    resolve(dataDir, "grammar-links.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

function splitTags(rawTags) {
  return rawTags.split(/\s+/u).filter(Boolean);
}

function parseBoolean(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "y", "learned"].includes(normalized);
}

function parseCsv(content) {
  const lines = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(current);
      if (row.some((cell) => cell.length > 0)) {
        lines.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    lines.push(row);
  }

  if (!lines.length) {
    return [];
  }

  const [headers, ...records] = lines;
  return records.map((record) => {
    const entry = {};

    headers.forEach((header, index) => {
      entry[header] = record[index] || "";
    });

    return entry;
  });
}
