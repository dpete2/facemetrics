/**
 * Clav — on-device guide for moggednyc.
 * Local mode only: answers use the metrics object computed in app.js (no servers).
 */
(function (global) {
  "use strict";

  function norm(q) {
    return String(q || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function hasMathIntent(q) {
    return /formula|equat|math|calculate|computed|deriv|weight|tolerance|how.*score|how.*number/i.test(q);
  }

  function plainSummary(metrics) {
    const H = Math.round(metrics.harmony);
    const rows = metrics.rows || [];
    const sorted = rows.slice().sort((a, b) => (b.match || 0) - (a.match || 0));
    const top = sorted.slice(0, 3).map((r) => `${r.title} (${Math.round(r.match)}%)`);
    const low = sorted.slice(-2).map((r) => `${r.title} (${Math.round(r.match)}%)`);
    return (
      `Harmony is ${H}/100. That’s a blend of multiple ratio checks — not medical advice.\n\n` +
      `Closest-to-reference checks: ${top.join(", ") || "n/a"}.\n` +
      `Furthest-from-reference checks: ${low.join(", ") || "n/a"}.\n\n` +
      `Ask me about any card by name (symmetry, thirds, golden ratio, etc.) and I’ll explain it in plain English or show the math.`
    );
  }

  function appealPlain(metrics) {
    const a = metrics.appeal;
    if (!a) return "I don’t have an appeal score for this run. Run the analysis again.";
    const s = Math.round(a.score);
    const c = a.confidence?.confidence ?? null;
    const conf = c == null ? "unknown" : c >= 80 ? `high (${c}%)` : c >= 55 ? `medium (${c}%)` : `low (${c}%)`;
    const helped = (a.pros || []).map((x) => `${x.key} (${x.score}%)`).join(", ") || "(none)";
    const hurt = (a.cons || []).map((x) => `${x.key} (${x.score}%)`).join(", ") || "(none)";
    return (
      `Appeal (experimental) is ${s}/100 with ${conf} confidence.\n\n` +
      `What helped: ${helped}.\n` +
      `What pulled it down: ${hurt}.\n\n` +
      `This is a heuristic proxy from symmetry + proportion cues (not a fact about how people will treat you).`
    );
  }

  function appealMath(metrics) {
    const a = metrics.appeal;
    if (!a) return "I don’t have an appeal score for this run.";
    return (
      `Appeal math:\n\n` +
      `We compute subscores (0–100) for symmetry, averageness (distance-to-reference ratios), thirds, Phi (length/width), eye spacing, nose–lip, jaw angle, cheek vs jaw.\n` +
      `Then: AppealScore = Σ(weight × subscore).\n\n` +
      `${a.weightsText}`
    );
  }

  function answer(question, metrics) {
    const q = norm(question);
    if (!q) return "Ask me something about your harmony, appeal, or any dossier line.";

    if (!metrics || typeof metrics.harmony !== "number") {
      if (/who are you|what is marlon|what is clav|who is clav/.test(q)) {
        return "I’m Clav — an on-device helper for moggednyc. Run an analysis, then ask me about your scores.";
      }
      return "Run an analysis first (add a photo). Then ask me about harmony, appeal, symmetry, thirds, or the heatmap.";
    }

    if (/appeal|attract|beauty|hot|pretty|ugly|rate me/.test(q)) {
      if (hasMathIntent(q) || /how.*work|weights/i.test(q)) return appealMath(metrics);
      return appealPlain(metrics);
    }

    if (/plain english|simple|summary|overview|tldr/.test(q)) return plainSummary(metrics);

    if (/harmony|overall|total/.test(q)) {
      const H = Math.round(metrics.harmony);
      return `Your harmony score is ${H}/100. Ask “explain the math for harmony” if you want the formula/weights, or ask about a specific card.`;
    }

    const rows = metrics.rows || [];
    for (const r of rows) {
      const key = norm(r.title);
      if (q.includes(key.split(" ")[0]) || q.includes(r.id?.replace("-", " "))) {
        return `${r.title}: ${r.explain}\n\nMeasured ${r.measured}; reference ${r.ideal}; conformance ${Math.round(r.match)}%.`;
      }
    }

    return "Try: “Explain my results in plain English”, “What is my appeal score?”, or ask about a specific card like “symmetry” or “golden ratio”.";
  }

  global.Clav = { answer };
})(typeof window !== "undefined" ? window : globalThis);

