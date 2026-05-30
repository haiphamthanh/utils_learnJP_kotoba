import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = express();
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = resolve(".");
const DIST_DIR = resolve(ROOT_DIR, "dist");
const DATA_FILE = resolve(DIST_DIR, "data", "words.json");

app.disable("x-powered-by");

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

app.use(express.static(DIST_DIR));

app.get("*", (_request, response) => {
  response.sendFile(resolve(DIST_DIR, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Learn JP Wordlist server running at http://${HOST}:${PORT}`);
});
