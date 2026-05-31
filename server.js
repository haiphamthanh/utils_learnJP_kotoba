import express from "express";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const app = express();
loadEnvFile();

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = resolve(".");
const DIST_DIR = resolve(ROOT_DIR, "dist");
const DATA_FILE = resolve(DIST_DIR, "data", "words.json");
const ARCHIVE_DIR = resolve(ROOT_DIR, "archives");
const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || "";
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

let dbPool = null;
const CRC32_TABLE = createCrc32Table();

app.disable("x-powered-by");
app.set("trust proxy", parseBoolean(process.env.TRUST_PROXY));
app.use(applySecurityHeaders);
app.use(requireBasicAuth);
app.use(express.json({ limit: "25mb" }));
app.use((error, _request, response, next) => {
  if (error?.type === "entity.too.large") {
    response.status(413).json({
      ok: false,
      message: "Request payload is too large.",
      error: formatError(error),
    });
    return;
  }

  next(error);
});

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
  const viewName = getStatsViewName(safeRange);

  if (!dbPool) {
    response.json({ range: safeRange, rows: [], source: "default" });
    return;
  }

  try {
    const rows = await loadStatsRows(safeRange, viewName);
    const totals = rows.reduce(
      (summary, row) => ({
        total_actions: summary.total_actions + Number(row.total_actions || 0),
        view_count: summary.view_count + Number(row.view_count || 0),
        learned_count: summary.learned_count + Number(row.learned_count || 0),
        unlearned_count:
          summary.unlearned_count + Number(row.unlearned_count || 0),
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

    response.json({ range: safeRange, rows, totals, source: "mysql" });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Failed to load study stats.",
      error: formatError(error),
    });
  }
});

app.post("/api/archive", async (request, response) => {
  const archivedAt = new Date();

  try {
    const mysqlArchive = dbPool ? await collectMysqlArchiveData() : null;
    const clientSnapshot = normalizeArchiveSnapshot(request.body);
    const startedAt =
      mysqlArchive?.startedAt ||
      clientSnapshot.startedAt ||
      archivedAt.toISOString();
    const endedAt = archivedAt.toISOString();
    const archivePayload = {
      archiveVersion: 1,
      startedAt,
      endedAt,
      archivedAt: endedAt,
      clientSnapshot,
      mysqlArchive,
    };
    const filename = `${formatArchiveDate(archivedAt)}.zip`;
    const archivePath = resolve(ARCHIVE_DIR, filename);

    mkdirSync(ARCHIVE_DIR, { recursive: true });
    writeFileSync(
      archivePath,
      createZipBuffer("archive.json", JSON.stringify(archivePayload, null, 2)),
    );

    if (dbPool) {
      await resetMysqlStudyHistory();
    }

    response.status(201).json({
      ok: true,
      filename,
      path: archivePath,
      startedAt,
      endedAt,
      mysqlStored: Boolean(dbPool),
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Failed to archive and reset study history.",
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

    await createStatsViews().catch((error) => {
      console.warn(`MySQL stats views disabled: ${formatError(error)}`);
    });
    await syncVocabulary();
    console.log("MySQL vocabulary tables are ready.");
  } catch (error) {
    dbPool = null;
    console.warn(`MySQL disabled: ${formatError(error)}`);
  }
}

async function createStatsViews() {
  await dbPool.execute(`
    CREATE OR REPLACE VIEW vocabulary_action_stats_daily AS
    SELECT
      DATE(created_at) AS bucket_start,
      DATE_FORMAT(created_at, '%Y-%m-%d') AS bucket,
      COUNT(*) AS total_actions,
      SUM(action = 'view') AS view_count,
      SUM(action = 'learned') AS learned_count,
      SUM(action = 'unlearned') AS unlearned_count,
      SUM(action = 'favorite') AS favorite_count,
      SUM(action = 'unfavorite') AS unfavorite_count
    FROM vocabulary_action_logs
    GROUP BY DATE(created_at), DATE_FORMAT(created_at, '%Y-%m-%d')
  `);

  await dbPool.execute(`
    CREATE OR REPLACE VIEW vocabulary_action_stats_weekly AS
    SELECT
      STR_TO_DATE(CONCAT(YEARWEEK(created_at, 3), ' Monday'), '%X%V %W') AS bucket_start,
      DATE_FORMAT(created_at, '%x-W%v') AS bucket,
      COUNT(*) AS total_actions,
      SUM(action = 'view') AS view_count,
      SUM(action = 'learned') AS learned_count,
      SUM(action = 'unlearned') AS unlearned_count,
      SUM(action = 'favorite') AS favorite_count,
      SUM(action = 'unfavorite') AS unfavorite_count
    FROM vocabulary_action_logs
    GROUP BY YEARWEEK(created_at, 3), DATE_FORMAT(created_at, '%x-W%v')
  `);

  await dbPool.execute(`
    CREATE OR REPLACE VIEW vocabulary_action_stats_monthly AS
    SELECT
      DATE_FORMAT(created_at, '%Y-%m-01') AS bucket_start,
      DATE_FORMAT(created_at, '%Y-%m') AS bucket,
      COUNT(*) AS total_actions,
      SUM(action = 'view') AS view_count,
      SUM(action = 'learned') AS learned_count,
      SUM(action = 'unlearned') AS unlearned_count,
      SUM(action = 'favorite') AS favorite_count,
      SUM(action = 'unfavorite') AS unfavorite_count
    FROM vocabulary_action_logs
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-01'), DATE_FORMAT(created_at, '%Y-%m')
  `);
}

async function loadStatsRows(range, viewName) {
  try {
    const [rows] = await dbPool.execute(
      `SELECT
        bucket,
        bucket_start,
        total_actions,
        view_count,
        learned_count,
        unlearned_count,
        favorite_count,
        unfavorite_count
       FROM ${viewName}
       WHERE bucket_start >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       ORDER BY bucket_start DESC
       LIMIT 12`,
    );
    return rows;
  } catch (_error) {
    const bucketExpression = getBucketExpression(range);
    const bucketStartExpression = getBucketStartExpression(range);
    const [rows] = await dbPool.execute(
      `SELECT
        ${bucketExpression} AS bucket,
        ${bucketStartExpression} AS bucket_start,
        COUNT(*) AS total_actions,
        SUM(action = 'view') AS view_count,
        SUM(action = 'learned') AS learned_count,
        SUM(action = 'unlearned') AS unlearned_count,
        SUM(action = 'favorite') AS favorite_count,
        SUM(action = 'unfavorite') AS unfavorite_count
       FROM vocabulary_action_logs
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       GROUP BY bucket, bucket_start
       ORDER BY bucket_start DESC
       LIMIT 12`,
    );
    return rows;
  }
}

async function collectMysqlArchiveData() {
  const [[period]] = await dbPool.execute(
    `SELECT
      MIN(created_at) AS startedAt,
      MAX(created_at) AS endedAt,
      COUNT(*) AS totalActions
     FROM vocabulary_action_logs`,
  );
  const [actionLogs] = await dbPool.execute(
    `SELECT
      logs.id,
      logs.expression,
      logs.action,
      logs.metadata,
      logs.created_at,
      vocabulary.reading,
      vocabulary.meaning,
      vocabulary.level,
      vocabulary.tags
     FROM vocabulary_action_logs AS logs
     LEFT JOIN vocabulary ON vocabulary.expression = logs.expression
     ORDER BY logs.created_at ASC, logs.id ASC`,
  );
  const statsDaily = await loadArchiveStatsRows(
    "day",
    "vocabulary_action_stats_daily",
  );
  const statsWeekly = await loadArchiveStatsRows(
    "week",
    "vocabulary_action_stats_weekly",
  );
  const statsMonthly = await loadArchiveStatsRows(
    "month",
    "vocabulary_action_stats_monthly",
  );
  const [actionSummary] = await dbPool.execute(
    `SELECT action, COUNT(*) AS count
     FROM vocabulary_action_logs
     GROUP BY action
     ORDER BY action ASC`,
  );

  return {
    startedAt: period?.startedAt ? new Date(period.startedAt).toISOString() : null,
    endedAt: period?.endedAt ? new Date(period.endedAt).toISOString() : null,
    totalActions: Number(period?.totalActions || 0),
    actionLogs,
    actionSummary,
    stats: {
      daily: statsDaily,
      weekly: statsWeekly,
      monthly: statsMonthly,
    },
  };
}

async function loadArchiveStatsRows(range, viewName) {
  try {
    const [rows] = await dbPool.execute(
      `SELECT
        bucket,
        bucket_start,
        total_actions,
        view_count,
        learned_count,
        unlearned_count,
        favorite_count,
        unfavorite_count
       FROM ${viewName}
       ORDER BY bucket_start ASC`,
    );
    return rows;
  } catch (_error) {
    const bucketExpression = getBucketExpression(range);
    const bucketStartExpression = getBucketStartExpression(range);
    const [rows] = await dbPool.execute(
      `SELECT
        ${bucketExpression} AS bucket,
        ${bucketStartExpression} AS bucket_start,
        COUNT(*) AS total_actions,
        SUM(action = 'view') AS view_count,
        SUM(action = 'learned') AS learned_count,
        SUM(action = 'unlearned') AS unlearned_count,
        SUM(action = 'favorite') AS favorite_count,
        SUM(action = 'unfavorite') AS unfavorite_count
       FROM vocabulary_action_logs
       GROUP BY bucket, bucket_start
       ORDER BY bucket_start ASC`,
    );
    return rows;
  }
}

async function resetMysqlStudyHistory() {
  await dbPool.execute("DELETE FROM vocabulary_action_logs");
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

function applySecurityHeaders(_request, response, next) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  if (IS_PRODUCTION) {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'",
    );
  }

  next();
}

function requireBasicAuth(request, response, next) {
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASSWORD) {
    next();
    return;
  }

  if (request.path === "/api/health") {
    next();
    return;
  }

  const authorization = request.headers.authorization || "";
  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) {
    rejectBasicAuth(response);
    return;
  }

  const credentials = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = credentials.indexOf(":");
  const user = credentials.slice(0, separatorIndex);
  const password = credentials.slice(separatorIndex + 1);

  if (
    safeEqual(user, BASIC_AUTH_USER) &&
    safeEqual(password, BASIC_AUTH_PASSWORD)
  ) {
    next();
    return;
  }

  rejectBasicAuth(response);
}

function rejectBasicAuth(response) {
  response.setHeader("WWW-Authenticate", 'Basic realm="Learn JP Wordlist"');
  response.status(401).json({ ok: false, message: "Authentication required." });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
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

function normalizeArchiveSnapshot(body) {
  const snapshot = body && typeof body === "object" ? body : {};
  const localActionLogs = Array.isArray(snapshot.localActionLogs)
    ? snapshot.localActionLogs
    : [];
  const wordSnapshot = getArchiveWordSnapshot(snapshot, localActionLogs);
  const startedAt =
    snapshot.startedAt ||
    localActionLogs
      .map((log) => log?.createdAt)
      .filter(Boolean)
      .sort()[0] ||
    null;

  return {
    startedAt,
    endedAt: snapshot.endedAt || new Date().toISOString(),
    activeLevel: String(snapshot.activeLevel || "all"),
    query: String(snapshot.query || ""),
    mode: String(snapshot.mode || "flashcard"),
    filterMode: String(snapshot.filterMode || "all"),
    statsRange: String(snapshot.statsRange || "day"),
    sessionOrder: String(snapshot.sessionOrder || "random"),
    currentIndex: Number(snapshot.currentIndex || 0),
    currentWord: snapshot.currentWord || null,
    learnedExpressions: normalizeStringArray(snapshot.learnedExpressions),
    starredExpressions: normalizeStringArray(snapshot.starredExpressions),
    seenExpressions: normalizeStringArray(snapshot.seenExpressions),
    sessionExpressions: normalizeStringArray(snapshot.sessionExpressions),
    words: wordSnapshot.words,
    wordlist: wordSnapshot.summary,
    actionSummary: summarizeArchiveActions(localActionLogs),
    localActionLogs,
  };
}

function getArchiveWordSnapshot(snapshot, localActionLogs) {
  const expressions = new Set([
    ...normalizeStringArray(snapshot.learnedExpressions),
    ...normalizeStringArray(snapshot.starredExpressions),
    ...normalizeStringArray(snapshot.seenExpressions),
    ...normalizeStringArray(snapshot.sessionExpressions),
    ...localActionLogs
      .map((log) => log?.expression)
      .filter(Boolean)
      .map(String),
  ]);

  if (snapshot.currentWord?.expression) {
    expressions.add(String(snapshot.currentWord.expression));
  }

  const wordsFromData = loadWordlistWords();
  const wordsByExpression = new Map(
    wordsFromData.map((word) => [word.expression, word]),
  );
  const words = [...expressions]
    .map((expression) => wordsByExpression.get(expression))
    .filter(Boolean);

  return {
    words,
    summary: {
      source: existsSync(DATA_FILE) ? "dist/data/words.json" : "unavailable",
      totalWords: wordsFromData.length,
      archivedWords: words.length,
    },
  };
}

function loadWordlistWords() {
  if (!existsSync(DATA_FILE)) {
    return [];
  }

  try {
    const payload = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(payload.words) ? payload.words : [];
  } catch (_error) {
    return [];
  }
}

function summarizeArchiveActions(actionLogs) {
  return actionLogs.reduce((summary, log) => {
    const action = String(log?.action || "unknown");
    summary[action] = (summary[action] || 0) + 1;
    summary.total = (summary.total || 0) + 1;
    return summary;
  }, {});
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function createZipBuffer(filename, content) {
  const filenameBuffer = Buffer.from(filename, "utf8");
  const contentBuffer = Buffer.from(content, "utf8");
  const crc = crc32(contentBuffer);
  const { dosDate, dosTime } = getDosDateTime(new Date());
  const localHeader = Buffer.alloc(30);

  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(contentBuffer.length, 18);
  localHeader.writeUInt32LE(contentBuffer.length, 22);
  localHeader.writeUInt16LE(filenameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  const centralDirectoryOffset =
    localHeader.length + filenameBuffer.length + contentBuffer.length;

  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(dosTime, 12);
  centralHeader.writeUInt16LE(dosDate, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(contentBuffer.length, 20);
  centralHeader.writeUInt32LE(contentBuffer.length, 24);
  centralHeader.writeUInt16LE(filenameBuffer.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralDirectorySize = centralHeader.length + filenameBuffer.length;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralDirectorySize, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([
    localHeader,
    filenameBuffer,
    contentBuffer,
    centralHeader,
    filenameBuffer,
    endRecord,
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function getDosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    dosTime:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    dosDate:
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

function formatArchiveDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
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

  return "DATE_FORMAT(created_at, '%Y-%m-%d')";
}

function getBucketStartExpression(range) {
  if (range === "week") {
    return "STR_TO_DATE(CONCAT(YEARWEEK(created_at, 3), ' Monday'), '%X%V %W')";
  }

  if (range === "month") {
    return "DATE_FORMAT(created_at, '%Y-%m-01')";
  }

  return "DATE(created_at)";
}

function getStatsViewName(range) {
  if (range === "week") {
    return "vocabulary_action_stats_weekly";
  }

  if (range === "month") {
    return "vocabulary_action_stats_monthly";
  }

  return "vocabulary_action_stats_daily";
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
