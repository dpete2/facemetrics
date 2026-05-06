function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: { message: "Method not allowed" } });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key || !key.startsWith("sk-ant")) {
    json(res, 401, {
      error: {
        message:
          "Missing ANTHROPIC_API_KEY on server. Set it in Vercel Environment Variables and redeploy.",
      },
    });
    return;
  }

  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    json(res, 400, { error: { message: "Invalid JSON body" } });
    return;
  }

  const {
    messages = [],
    metrics = null,
    appeal = null,
    mode = "claude",
  } = payload || {};

  if (mode !== "claude") {
    json(res, 400, { error: { message: "This endpoint is for Claude mode only." } });
    return;
  }

  const model = "claude-sonnet-4-5";
  const system = [
    "You are Marlon, FaceMetrics' assistant.",
    "Be plain-English first, then optionally math detail.",
    "Be respectful and non-diagnostic; this is not medical advice.",
    "Never claim certainty from a single photo; mention confidence if low.",
    "The user metrics are computed client-side; you are only given numbers + descriptions.",
  ].join("\n");

  const userContext = {
    metrics,
    appeal,
  };

  const apiBody = {
    model,
    max_tokens: 700,
    temperature: 0.4,
    system,
    messages: [
      {
        role: "user",
        content:
          "Context JSON (computed client-side):\n" + JSON.stringify(userContext, null, 2),
      },
      ...messages,
    ],
  };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(apiBody),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      json(res, r.status, {
        error: {
          message: j?.error?.message || j?.error?.type || "Anthropic API error",
          type: j?.error?.type,
          status: r.status,
        },
      });
      return;
    }

    const text =
      Array.isArray(j?.content) ? j.content.map((c) => c?.text || "").join("") : "";

    json(res, 200, {
      ok: true,
      model,
      text: text.trim(),
      raw: { id: j?.id, usage: j?.usage || null },
    });
  } catch (e) {
    json(res, 502, { error: { message: e?.message || "Network error to Anthropic" } });
  }
}

