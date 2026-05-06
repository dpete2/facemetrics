/**
 * moggednyc dev server: static files + Anthropic proxy for Clav (Claude).
 *
 * Setup:
 *   export ANTHROPIC_API_KEY="sk-ant-api03-..."
 *   npm start
 *
 * Opens http://localhost:8080 — same port as python -m http.server, but adds /api/marlon.
 * The API key never goes to the browser; only this process uses it.
 *
 * Model: Claude Sonnet 4.5 — id claude-sonnet-4-5 (see Anthropic model catalog).
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
/** Try 8081 before 8080 so `npm start` usually works even if Python is on 8080 */
const FALLBACK_PORTS = [8081, 8080, 8082, 8083, 8084, 8085];
let LISTEN_PORT = null;
let KEY_FINGERPRINT = null;
let keyValidationCache = { at: 0, ok: false, status: null, message: null };

function loadDotEnv() {
  try {
    const envPath = path.join(ROOT, ".env");
    if (!fs.existsSync(envPath)) {
      console.warn("No .env file next to server.mjs — expected:", envPath);
      return;
    }
    let txt = fs.readFileSync(envPath, "utf8");
    txt = txt.replace(/^\uFEFF/, "");
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^ANTHROPIC_API_KEY\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v.length > 0) {
        process.env.ANTHROPIC_API_KEY = v;
      }
    }
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.startsWith("sk-ant")) {
      const k = process.env.ANTHROPIC_API_KEY;
      KEY_FINGERPRINT = `len:${k.length}…${k.slice(-6)}`;
      console.log(`ANTHROPIC_API_KEY loaded from .env (${KEY_FINGERPRINT})`);
    } else {
      console.warn(
        "ANTHROPIC_API_KEY missing or invalid in .env — use: ANTHROPIC_API_KEY=sk-ant-api03-… (one line, no spaces around =)",
      );
    }
  } catch (e) {
    console.warn("Could not read .env:", e.message);
  }
}
loadDotEnv();

const CLAUDE_MODEL = "claude-sonnet-4-5";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildSystemPrompt(metrics) {
  const metricsBlock = metrics
    ? JSON.stringify(metrics, null, 2)
    : "null (user has not run an analysis yet — tell them to add a photo first.)";

  return `You are Clav, the friendly guide for the moggednyc web app (facial proportion scores from a 68-point face mesh — educational only, not medical).

Rules:
- Ground every factual claim about the user's numbers ONLY in the Metrics JSON below. If a value is missing, say you don't have it.
- Never claim to see their photo; you only have summary metrics when provided.
- Use plain English by default; explain math when asked (harmony is a weighted blend of index scores; each index uses smooth conformance vs classical ideals).
- Be concise but thorough. No moral judgments about attractiveness.
- If asked something unrelated to moggednyc, answer briefly then steer back to their scores or how the app works.

Metrics JSON (harmony, rows with match %, etc.):
${metricsBlock}`;
}

async function anthropicMessages({ system, messages }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !key.startsWith("sk-ant")) {
    const err = new Error("ANTHROPIC_API_KEY is not set or invalid in the server environment.");
    err.code = "NO_KEY";
    throw err;
  }

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });
  } catch (netErr) {
    console.error("[Anthropic] network error:", netErr);
    const err = new Error(
      netErr.message?.includes("fetch")
        ? "Could not reach Anthropic (check your internet / firewall / DNS)."
        : String(netErr.message || netErr),
    );
    err.code = "NETWORK";
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data.error?.type || res.statusText || "Anthropic API error";
    console.error("[Anthropic]", res.status, data.error || data);
    const err = new Error(`${res.status}: ${msg}`);
    err.code = "API_ERROR";
    err.status = res.status;
    err.detail = data.error;
    throw err;
  }

  const parts = data.content || [];
  const text = parts
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) {
    const err = new Error("Empty response from Claude.");
    err.code = "EMPTY";
    throw err;
  }

  return { text, model: data.model || CLAUDE_MODEL, id: data.id };
}

async function validateAnthropicKey() {
  const now = Date.now();
  if (now - keyValidationCache.at < 30_000) return keyValidationCache;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !key.startsWith("sk-ant")) {
    keyValidationCache = { at: now, ok: false, status: 0, message: "missing_key" };
    return keyValidationCache;
  }

  try {
    const r = await fetch(`https://api.anthropic.com/v1/models/${CLAUDE_MODEL}`, {
      method: "GET",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = j?.error?.message || j?.error?.type || r.statusText || "error";
      keyValidationCache = { at: now, ok: false, status: r.status, message: m };
      return keyValidationCache;
    }
    keyValidationCache = { at: now, ok: true, status: 200, message: "ok" };
    return keyValidationCache;
  } catch (e) {
    keyValidationCache = { at: now, ok: false, status: 0, message: e.message || "network" };
    return keyValidationCache;
  }
}

function serveStatic(req, res, urlPath) {
  let file = urlPath === "/" ? "/index.html" : urlPath;
  const unsafe = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");
  let abs = path.join(ROOT, unsafe);

  if (!abs.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    abs = path.join(abs, "index.html");
  }

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    send(res, 404, "Not found");
    return;
  }

  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(abs).pipe(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    const v = await validateAnthropicKey();
    sendJson(res, 200, {
      ok: true,
      claude: !!v.ok,
      model: CLAUDE_MODEL,
      listenPort: LISTEN_PORT,
      keyFingerprint: KEY_FINGERPRINT,
      keyStatus: v.status,
      keyMessage: v.message,
      hint: v.ok
        ? null
        : v.status === 401
          ? "Anthropic rejected the key (401). Create a NEW key in Anthropic Console, replace .env, then restart npm start."
          : v.status === 0
            ? "Server could not reach api.anthropic.com (network/VPN/firewall) or key missing."
            : "Key check failed — see keyStatus/keyMessage.",
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/marlon") {
    try {
      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const metrics = body.metrics !== undefined ? body.metrics : null;

      if (!messages.length || messages[messages.length - 1]?.role !== "user") {
        sendJson(res, 400, { error: "messages must be a non-empty array ending with a user turn" });
        return;
      }

      const system = buildSystemPrompt(metrics);
      const { text, model, id } = await anthropicMessages({ system, messages });
      sendJson(res, 200, { text, model, id });
    } catch (e) {
      const msg = e.message || "Unknown error";
      const status = e.code === "NO_KEY" ? 503 : 500;
      sendJson(res, status, {
        error: msg,
        code: e.code || "ERR",
        hint:
          e.code === "API_ERROR" && e.status === 401
            ? "Invalid or expired API key — check ANTHROPIC_API_KEY and create a new key in the Anthropic console if needed."
            : e.code === "NETWORK"
              ? "Your Mac could not reach api.anthropic.com (Wi‑Fi, VPN, or firewall)."
              : null,
      });
    }
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, decodeURIComponent(url.pathname));
    return;
  }

  send(res, 405, "Method not allowed");
}

function startListening(portIndex) {
  const forced = process.env.PORT ? Number(process.env.PORT) : null;
  const port =
    forced && !Number.isNaN(forced) ? forced : FALLBACK_PORTS[portIndex];

  if (port == null || Number.isNaN(port)) {
    console.error("No available port.");
    process.exit(1);
    return;
  }

  const server = http.createServer(handleRequest);

  server.once("error", (err) => {
    if (err.code !== "EADDRINUSE") {
      console.error(err);
      process.exit(1);
      return;
    }
    if (forced != null) {
      console.error(`Port ${forced} is already in use. Stop the other app or use a different PORT=...`);
      process.exit(1);
      return;
    }
    if (portIndex + 1 < FALLBACK_PORTS.length) {
      startListening(portIndex + 1);
    } else {
      console.error("All candidate ports are in use:", FALLBACK_PORTS.join(", "));
      process.exit(1);
    }
  });

  // Listen on IPv6 any-address so localhost works for both ::1 and 127.0.0.1
  server.listen(port, "::", () => {
    LISTEN_PORT = port;
    console.log("");
    console.log(`moggednyc → http://localhost:${port}`);
    console.log(`Claude Clav model: ${CLAUDE_MODEL}`);
    console.log("Open that exact URL in your browser (Claude needs this server, not Python-only).");
    console.log("");
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("Warning: ANTHROPIC_API_KEY not set — add it to .env or Claude mode will fail.");
    }
  });
}

startListening(0);
