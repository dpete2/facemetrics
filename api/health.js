export default async function handler(req, res) {
  const model = "claude-sonnet-4-5";
  const key = process.env.ANTHROPIC_API_KEY || "";
  const keyOk = key.startsWith("sk-ant");

  // Fast check: if key missing, report immediately.
  if (!keyOk) {
    res.status(200).json({
      ok: true,
      claude: false,
      model,
      hint: "Set ANTHROPIC_API_KEY in Vercel Environment Variables and redeploy.",
    });
    return;
  }

  // Validate key without spending tokens by calling models endpoint.
  try {
    const r = await fetch(`https://api.anthropic.com/v1/models/${model}`, {
      method: "GET",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(200).json({
        ok: true,
        claude: false,
        model,
        keyStatus: r.status,
        keyMessage: j?.error?.message || j?.error?.type || r.statusText,
        hint: "Anthropic rejected the key. Create a new key and update Vercel env vars.",
      });
      return;
    }

    res.status(200).json({ ok: true, claude: true, model });
  } catch (e) {
    res.status(200).json({
      ok: true,
      claude: false,
      model,
      keyStatus: 0,
      keyMessage: e?.message || "network_error",
      hint: "Vercel could not reach api.anthropic.com (network/firewall).",
    });
  }
}

