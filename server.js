import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const app = express();
loadEnvFile();

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = resolve(".");
const DIST_DIR = resolve(ROOT_DIR, "dist");
const DATA_FILE = resolve(DIST_DIR, "data", "words.json");
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

let dbPool = null;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

await initDatabase();

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "learn-jp-wordlist",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/words", (_request, response) => {
  if (!existsSync(DATA_FILE)) {
    response.status(404).json({
      ok: false,
      message: "Data file not found. Run `yarn build` first.",
    });
    return;
  }

  try {
    const content = readFileSync(DATA_FILE, "utf8");
    response.type("application/json").send(content);
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Failed to load local wordlist data.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get("/api/examples/:expression", async (request, response) => {
  if (!dbPool) {
    response.json({
      expression: request.params.expression,
      examples: [],
      source: "default",
    });
    return;
  }

  try {
    const [rows] = await dbPool.execute(
      `SELECT id, expression, sentence, translation, note, position
       FROM vocabulary_examples
       WHERE expression = ?
       ORDER BY position ASC, id ASC
       LIMIT 3`,
      [request.params.expression],
    );

    response.json({
      expression: request.params.expression,
      examples: rows,
      source: rows.length ? "mysql" : "default",
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Failed to load vocabulary examples.",
      error: formatError(error),
    });
  }
});

app.post("/api/examples", async (request, response) => {
  await saveExamples(request, response, 201);
});

app.put("/api/examples/:expression", async (request, response) => {
  request.body.expression = request.params.expression;
  await saveExamples(request, response, 200);
});

app.delete("/api/examples/:expression", async (request, response) => {
  if (!dbPool) {
    response.status(503).json({ ok: false, message: "MySQL is not configured." });
    return;
  }

  try {
    const [result] = await dbPool.execute(
      "DELETE FROM vocabulary_examples WHERE expression = ?",
      [request.params.expression],
    );

    response.json({
      ok: true,
      expression: request.params.expression,
      deleted: result.affectedRows,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Failed to delete examples.",
      error: formatError(error),
    });
  }
});

app.post("/api/actions", async (request, response) => {
  const expression = String(request.body?.expression || "").trim();
  const action = String(request.body?.action || "").trim();
  const metadata = request.body?.metadata || {};

  if (!expression || !isValidAction(action)) {
    response.status(400).json({
      ok: false,
      message: "Body must include expression and a valid action.",
    });
    return;
  }

  if (!dbPool) {
    response.status(202).json({
      ok: true,
      stored: false,
      message: "MySQL is not configured.",
    });
    return;
  }

  try {
    await upsertVocabulary(expression);
    await dbPool.execute(
      `INSERT INTO vocabulary_action_logs (expression, action, metadata)
       VALUES (?, ?, ?)`,
      [expression, action, JSON.stringify(metadata)],
    );

    response.status(201).json({ ok: true, stored: true });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Failed to store action log.",
      error: formatError(error),
    });
  }
});

app.get("/api/stats", async (request, response) => {
  const range = String(request.query.range || "day");
  const safeRange = ["day", "week", "month"].includes(range) ? range : "day";

  if (!dbPool) {
    response.json({ range: safeRange, rows: [], source: "default" });
    return;
  }

  try {
    const bucketExpression = getBucketExpression(safeRange);
    const [rows] = await dbPool.execute(
      `SELECT
        ${bucketExpression} AS bucket,
        COUNT(*) AS total_actions,
        SUM(action = 'view') AS view_count,
        SUM(action = 'learned') AS learned_count,
        SUM(action = 'unlearned') AS unlearned_count,
        SUM(action = 'favorite') AS favorite_count,
        SUM(action = 'unfavorite') AS unfavorite_count
       FROM vocabulary_action_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       GROUP BY bucket
       ORDER BY bucket DESC
       LIMIT 12`,
    );

    response.json({ range: safeRange, rows, source: "mysql" });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Failed to load study stats.",
      error: formatError(error),
    });
  }
});

app.use(express.static(DIST_DIR));

app.get("*", (_request, response) => {
  response.sendFile(resolve(DIST_DIR, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Learn JP Wordlist server running at http://${HOST}:${PORT}`);
});

async function initDatabase() {
  if (!MYSQL_CONFIG.host || !MYSQL_CONFIG.user || !MYSQL_CONFIG.database) {
    console.log("MySQL is not configured. Example API will use default placeholders.");
    return;
  }

  try {
    dbPool = mysql.createPool({
      ...MYSQL_CONFIG,
      waitForConnections: true,
      connectionLimit: 5,
      namedPlaceholders: false,
      charset: "utf8mb4",
    });

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS vocabulary (
        expression VARCHAR(255) NOT NULL PRIMARY KEY,
        reading VARCHAR(255) NULL,
        meaning TEXT NULL,
        level VARCHAR(20) NULL,
        tags JSON NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS vocabulary_examples (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        expression VARCHAR(255) NOT NULL,
        sentence TEXT NOT NULL,
        translation TEXT NULL,
        note TEXT NULL,
        position TINYINT UNSIGNED NOT NULL DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_vocabulary_examples_expression
          FOREIGN KEY (expression) REFERENCES vocabulary(expression)
          ON DELETE CASCADE,
        INDEX idx_vocabulary_examples_expression (expression)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS vocabulary_action_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        expression VARCHAR(255) NOT NULL,
        action ENUM('view', 'learned', 'unlearned', 'favorite', 'unfavorite') NOT NULL,
        metadata JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_vocabulary_action_logs_expression
          FOREIGN KEY (expression) REFERENCES vocabulary(expression)
          ON DELETE CASCADE,
        INDEX idx_vocabulary_action_logs_expression (expression),
        INDEX idx_vocabulary_action_logs_created_at (created_at),
        INDEX idx_vocabulary_action_logs_action (action)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await syncVocabulary();
    console.log("MySQL vocabulary tables are ready.");
  } catch (error) {
    dbPool = null;
    console.warn(`MySQL disabled: ${formatError(error)}`);
  }
}

async function syncVocabulary() {
  if (!dbPool || !existsSync(DATA_FILE)) {
    return;
  }

  const payload = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  for (const word of payload.words || []) {
    await dbPool.execute(
      `INSERT INTO vocabulary (expression, reading, meaning, level, tags)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        reading = VALUES(reading),
        meaning = VALUES(meaning),
        level = VALUES(level),
        tags = VALUES(tags)`,
      [
        word.expression,
        word.reading,
        word.meaning,
        word.level,
        JSON.stringify(word.tags || []),
      ],
    );
  }
}

async function upsertVocabulary(expression) {
  await dbPool.execute(
    `INSERT INTO vocabulary (expression)
     VALUES (?)
     ON DUPLICATE KEY UPDATE expression = VALUES(expression)`,
    [expression],
  );
}

function normalizeExamplePayload(body) {
  const expression = String(body?.expression || "").trim();
  const examples = Array.isArray(body?.examples) ? body.examples : [];

  if (!expression || !examples.length || examples.length > 3) {
    return null;
  }

  const normalizedExamples = examples
    .map((example, index) => ({
      sentence: String(example?.sentence || "").trim(),
      translation: String(example?.translation || "").trim() || null,
      note: String(example?.note || "").trim() || null,
      position: Number(example?.position || index + 1),
    }))
    .filter((example) => example.sentence);

  if (!normalizedExamples.length) {
    return null;
  }

  return {
    expression,
    examples: normalizedExamples.slice(0, 3),
  };
}

async function saveExamples(request, response, statusCode) {
  if (!dbPool) {
    response.status(503).json({ ok: false, message: "MySQL is not configured." });
    return;
  }

  const payload = normalizeExamplePayload(request.body);
  if (!payload) {
    response.status(400).json({
      ok: false,
      message: "Body must include expression and examples[1..3].sentence.",
    });
    return;
  }

  try {
    await upsertVocabulary(payload.expression);
    await dbPool.execute("DELETE FROM vocabulary_examples WHERE expression = ?", [
      payload.expression,
    ]);

    for (const example of payload.examples) {
      await dbPool.execute(
        `INSERT INTO vocabulary_examples
          (expression, sentence, translation, note, position)
         VALUES (?, ?, ?, ?, ?)`,
        [
          payload.expression,
          example.sentence,
          example.translation,
          example.note,
          example.position,
        ],
      );
    }

    response.status(statusCode).json({ ok: true, ...payload });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Failed to save examples.",
      error: formatError(error),
    });
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isValidAction(action) {
  return ["view", "learned", "unlearned", "favorite", "unfavorite"].includes(
    action,
  );
}

function getBucketExpression(range) {
  if (range === "week") {
    return "DATE_FORMAT(created_at, '%x-W%v')";
  }

  if (range === "month") {
    return "DATE_FORMAT(created_at, '%Y-%m')";
  }

  return "DATE(created_at)";
}

function loadEnvFile() {
  const envPath = resolve(".", ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}
