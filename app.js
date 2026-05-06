/* moggednyc — client-side facial proportion analysis using face-api.js */

(function () {
  "use strict";

  const MODEL_URL =
    "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    dropzone: $("#dropzone"),
    fileInput: $("#file-input"),
    cameraCaptureInput: $("#camera-capture-input"),
    btnBegin: $("#btn-begin"),
    btnUploadPhoto: $("#btn-upload-photo"),
    btnViewDossier: $("#btn-view-dossier"),
    btnCorpusHeatmap: $("#btn-corpus-heatmap"),
    sectionDossier: $("#section-dossier"),
    sectionHeatmap: $("#section-heatmap"),
    btnTakePhoto: $("#btn-take-photo"),
    btnWebcam: $("#btn-webcam"),
    btnClear: $("#btn-clear"),
    btnCapture: $("#btn-capture"),
    btnWebcamCancel: $("#btn-webcam-cancel"),
    webcamWrap: $("#webcam-wrap"),
    webcam: $("#webcam"),
    status: $("#status"),
    placeholder: $("#placeholder"),
    resultWrap: $("#result-wrap"),
    preview: $("#preview"),
    overlay: $("#overlay"),
    harmonyValue: $("#harmony-value"),
    harmonyTier: $("#harmony-tier"),
    harmonyTierAcronym: $("#harmony-tier-acronym"),
    harmonyTierTitle: $("#harmony-tier-title"),
    harmonyTierNote: $("#harmony-tier-note"),
    headerTierPill: $("#header-tier-pill"),
    headerTierAcronym: $("#header-tier-acronym"),
    ringProgress: $("#ring-progress"),
    metricsGrid: $("#metrics-grid"),
    heatmapCanvas: $("#heatmap-canvas"),
    radarChart: $("#radar-chart"),
    // AI assistant removed
    harmonyPanel: $("#harmony-panel"),
    mobileDock: $("#mobile-dock"),
    btnAppeal: $("#btn-appeal"),
    sectionAppeal: $("#section-appeal"),
    appealScore: $("#appeal-score"),
    appealTier: $("#appeal-tier"),
    appealConfidence: $("#appeal-confidence"),
    appealWarnings: $("#appeal-warnings"),
    appealTips: $("#appeal-tips"),
    appealPros: $("#appeal-pros"),
    appealCons: $("#appeal-cons"),
    appealWeights: $("#appeal-weights"),
    appealCites: $("#appeal-cites"),
    scanScreen: $("#scan-screen"),
    scanSub: $("#scan-sub"),
    scanFill: $("#scan-fill"),
    scanPct: $("#scan-pct"),
    scanLeft: $("#scan-left"),
  };

  const TAB_ORDER = ["overview", "scan", "results", "appeal"];

  function setActiveTab(name) {
    if (!TAB_ORDER.includes(name)) return;
    TAB_ORDER.forEach((t) => {
      const on = t === name;
      const tabBtn = document.querySelector(`button.tab-btn[data-tab="${t}"]`);
      if (tabBtn) {
        tabBtn.classList.toggle("is-active", on);
        tabBtn.setAttribute("aria-selected", String(on));
      }
      const panel = document.getElementById(`tab-panel-${t}`);
      if (panel) {
        panel.classList.toggle("is-active", on);
        if (on) {
          panel.removeAttribute("hidden");
          panel.setAttribute("aria-hidden", "false");
        } else {
          panel.setAttribute("hidden", "");
          panel.setAttribute("aria-hidden", "true");
        }
      }
      const dockBtn = els.mobileDock && els.mobileDock.querySelector(`button[data-tab="${t}"]`);
      if (dockBtn) dockBtn.classList.toggle("is-active", on);
    });
    window.scrollTo(0, 0);
  }

  // AI assistant removed

  let modelsLoaded = false;
  let streamRef = null;
  let radarChartInstance = null;
  let lastMetrics = null;
  // AI assistant removed
  let scanTimer = null;
  let scanPct = 0;

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  function angleDeg(a, b) {
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  }

  function computeLumaStats(imageData) {
    const d = imageData.data;
    const n = Math.max(1, d.length / 4);
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y;
      sum2 += y * y;
    }
    const mean = sum / n;
    const varY = Math.max(0, sum2 / n - mean * mean);
    return { mean, std: Math.sqrt(varY) };
  }

  function computeLaplacianVariance(imageData) {
    // Simple 3x3 Laplacian on luma; higher variance ≈ sharper (less blur)
    const w = imageData.width;
    const h = imageData.height;
    const d = imageData.data;
    if (w < 3 || h < 3) return 0;
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        lum[y * w + x] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      }
    }
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const c = lum[y * w + x];
        const lap =
          -4 * c +
          lum[y * w + (x - 1)] +
          lum[y * w + (x + 1)] +
          lum[(y - 1) * w + x] +
          lum[(y + 1) * w + x];
        sum += lap;
        sum2 += lap * lap;
        n++;
      }
    }
    const mean = sum / Math.max(1, n);
    return Math.max(0, sum2 / Math.max(1, n) - mean * mean);
  }

  function computeConfidence(positions, box, img) {
    const p = positions;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const faceArea = Math.max(1, box.width * box.height);
    const imgArea = Math.max(1, imgW * imgH);
    const sizeRatio = faceArea / imgArea;

    // Roll: angle between eyes should be near 0°
    const roll = angleDeg(p[36], p[45]);
    const rollScore = scoreFromIdeal(Math.abs(roll), 0, 10);

    // Yaw proxy: nose should sit near midline
    const jawXs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((i) => p[i].x);
    const faceWidth = Math.max(...jawXs) - Math.min(...jawXs);
    const midX = (p[27].x + (p[39].x + p[42].x) / 2) / 2;
    const noseOffset = Math.abs(p[33].x - midX) / Math.max(faceWidth, 1);
    const yawScore = scoreFromIdeal(noseOffset, 0, 0.16); // absolute tolerance (ideal=0)

    // Face size in frame
    const sizeScore = scoreFromIdeal(sizeRatio, 0.14, 55);

    // Blur/contrast on face region (downsampled)
    const c = document.createElement("canvas");
    const scale = Math.min(1, 220 / Math.max(box.width, box.height));
    const rw = Math.max(24, Math.round(box.width * scale));
    const rh = Math.max(24, Math.round(box.height * scale));
    c.width = rw;
    c.height = rh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(
      img,
      Math.max(0, box.x),
      Math.max(0, box.y),
      box.width,
      box.height,
      0,
      0,
      rw,
      rh,
    );
    const id = ctx.getImageData(0, 0, rw, rh);
    const { std } = computeLumaStats(id);
    const lapVar = computeLaplacianVariance(id);

    // Heuristic mappings → 0–100
    const contrastScore = scoreFromIdeal(std, 42, 80);
    const blurScore = scoreFromIdeal(lapVar, 380, 120);

    const confidence =
      0.22 * rollScore +
      0.22 * yawScore +
      0.2 * sizeScore +
      0.18 * contrastScore +
      0.18 * blurScore;

    const warnings = [];
    const tips = [];
    if (sizeRatio < 0.07) {
      warnings.push("Face is small in the frame — measurements are less stable.");
      tips.push("Move closer / crop tighter so your face fills more of the frame.");
    }
    if (Math.abs(roll) > 6) {
      warnings.push("Head tilt detected — can distort left/right ratios.");
      tips.push("Level your head; keep eyes horizontal.");
    }
    if (noseOffset > 0.05) {
      warnings.push("You may be slightly turned (yaw) — frontal measurements assume straight-on.");
      tips.push("Face the camera straight-on (no 3/4 angle).");
    }
    if (std < 18) {
      warnings.push("Low contrast / dim lighting — landmark detection can drift.");
      tips.push("Use brighter, even lighting from the front.");
    }
    if (lapVar < 140) {
      warnings.push("Image looks a bit blurry — small ratios can shift.");
      tips.push("Hold still or use a sharper photo.");
    }

    return {
      confidence: Math.round(confidence),
      rollDeg: roll,
      noseOffset,
      sizeRatio,
      blurVar: lapVar,
      contrastStd: std,
      warnings,
      tips,
    };
  }

  function showScan(stageLabel, subText) {
    if (!els.scanScreen) return;
    els.scanScreen.classList.remove("hidden");
    scanPct = 0;
    if (els.scanLeft) els.scanLeft.textContent = stageLabel || "SCANNING";
    if (els.scanSub) els.scanSub.textContent = subText || "Initializing…";
    if (els.scanPct) els.scanPct.textContent = "0";
    if (els.scanFill) els.scanFill.style.width = "0%";

    if (scanTimer) window.clearInterval(scanTimer);
    scanTimer = window.setInterval(() => {
      scanPct = Math.min(96, scanPct + (scanPct < 60 ? 4 : 2));
      if (els.scanPct) els.scanPct.textContent = String(scanPct);
      if (els.scanFill) els.scanFill.style.width = `${scanPct}%`;
    }, 120);
  }

  function setScanStage(stageLabel, subText) {
    if (els.scanLeft && stageLabel) els.scanLeft.textContent = stageLabel;
    if (els.scanSub && subText) els.scanSub.textContent = subText;
  }

  function hideScan(success = true) {
    if (scanTimer) window.clearInterval(scanTimer);
    scanTimer = null;
    if (!els.scanScreen) return;
    if (success) {
      if (els.scanPct) els.scanPct.textContent = "100";
      if (els.scanFill) els.scanFill.style.width = "100%";
      setTimeout(() => els.scanScreen.classList.add("hidden"), 220);
    } else {
      els.scanScreen.classList.add("hidden");
    }
  }

  const RING_C = 2 * Math.PI * 52;

  function setStatus(msg, isError = false) {
    els.status.textContent = msg;
    els.status.classList.toggle("error", isError);
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Map deviation to 0–100; tighter tolerance = stricter */
  function scoreFromIdeal(measured, ideal, tolerancePercent) {
    // If ideal is 0, interpret tolerancePercent as an absolute tolerance (not % of 0).
    // This matters for "distance-from-ideal" metrics like thirdsVariance where ideal is 0.
    const t =
      ideal === 0
        ? Math.max(tolerancePercent, 1e-3)
        : Math.max(ideal * (tolerancePercent / 100), 1e-6);
    const diff = Math.abs(measured - ideal);
    return Math.min(100, 100 * Math.exp(-Math.pow(diff / t, 2)));
  }

  function scoreFromRatio(measuredRatio, idealRatio, tolerancePercent) {
    return scoreFromIdeal(measuredRatio, idealRatio, tolerancePercent);
  }

  function avgPairSymmetry(positions, pairs, midX) {
    let sum = 0;
    let n = 0;
    for (const [ia, ib] of pairs) {
      const a = positions[ia];
      const b = positions[ib];
      const leftPt = a.x <= b.x ? a : b;
      const rightPt = a.x <= b.x ? b : a;
      const dL = midX - leftPt.x;
      const dR = rightPt.x - midX;
      const err = Math.abs(dL - dR) / Math.max(Math.abs(dL), Math.abs(dR), 1);
      sum += 1 - Math.min(1, err * 2);
      n++;
    }
    return n ? (sum / n) * 100 : 50;
  }

  /**
   * @param {{ x: number; y: number }[]} positions
   */
  function computeMetrics(positions) {
    const p = positions;

    const browYs = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26].map((i) => p[i].y);
    const browTopY = Math.min(...browYs);
    const chinY = p[8].y;
    const glabellaY = p[27].y;
    const subnasaleY = p[33].y;

    const faceLenApprox = chinY - browTopY;
    const hairlineY = browTopY - 0.32 * Math.max(faceLenApprox, 1);

    const faceHeight = chinY - hairlineY;
    const upperH = glabellaY - hairlineY;
    const midH = subnasaleY - glabellaY;
    const lowerH = chinY - subnasaleY;

    const uPct = faceHeight > 0 ? (upperH / faceHeight) * 100 : 33.3;
    const mPct = faceHeight > 0 ? (midH / faceHeight) * 100 : 33.3;
    const lPct = faceHeight > 0 ? (lowerH / faceHeight) * 100 : 33.3;
    const idealThird = 33.33;
    const thirdsVariance =
      (Math.abs(uPct - idealThird) + Math.abs(mPct - idealThird) + Math.abs(lPct - idealThird)) / 3;
    // absolute tolerance for thirdsVariance (ideal=0): higher = less harsh
    const thirdsMatch = scoreFromIdeal(thirdsVariance, 0, 4.5);

    const jawXs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((i) => p[i].x);
    const faceWidth = Math.max(...jawXs) - Math.min(...jawXs);
    const phiIdeal = 1.618;
    const phiMeasured = faceHeight / Math.max(faceWidth, 1);
    const goldenMatch = scoreFromRatio(phiMeasured, phiIdeal, 20);

    const eyeLOuter = p[36];
    const eyeLInner = p[39];
    const eyeROuter = p[45];
    const eyeRInner = p[42];
    const wLeft = dist(eyeLOuter, eyeLInner);
    const wRight = dist(eyeROuter, eyeRInner);
    const avgEyeW = (wLeft + wRight) / 2;
    const interocular = dist(eyeLInner, eyeRInner);
    const eyeSpacingRatio = avgEyeW > 0 ? interocular / avgEyeW : 1;
    const idealSpacingRatio = 1;
    const eyeMatch = scoreFromRatio(eyeSpacingRatio, idealSpacingRatio, 34);

    const lipTopY = p[51].y;
    const dNoseLip = Math.max(lipTopY - subnasaleY, 0.01);
    const dLipChin = Math.max(chinY - lipTopY, 0.01);
    const nlRatio = dNoseLip / dLipChin;
    const idealNl = 0.55;
    const nlMatch = scoreFromRatio(nlRatio, idealNl, 38);

    const vL = { x: p[4].x - p[8].x, y: p[4].y - p[8].y };
    const vR = { x: p[12].x - p[8].x, y: p[12].y - p[8].y };
    const dot = vL.x * vR.x + vL.y * vR.y;
    const mL = Math.hypot(vL.x, vL.y);
    const mR = Math.hypot(vR.x, vR.y);
    let jawAngleDeg = 110;
    if (mL > 0 && mR > 0) {
      const cos = Math.max(-1, Math.min(1, dot / (mL * mR)));
      jawAngleDeg = (Math.acos(cos) * 180) / Math.PI;
    }
    const idealJaw = 114;
    const jawMatch = scoreFromIdeal(jawAngleDeg, idealJaw, 17);

    const midX = (p[27].x + (eyeLInner.x + eyeRInner.x) / 2) / 2;
    const symPairs = [
      [0, 16],
      [1, 15],
      [2, 14],
      [3, 13],
      [4, 12],
      [5, 11],
      [6, 10],
      [7, 9],
      [36, 45],
      [37, 44],
      [38, 43],
      [39, 42],
      [40, 47],
      [41, 46],
      [17, 26],
      [18, 25],
      [19, 24],
      [20, 23],
      [21, 22],
    ];
    const symmetryMatch = avgPairSymmetry(p, symPairs, midX);

    const cheekSpread = Math.abs(p[14].x - p[2].x);
    const jawGonial = Math.abs(p[12].x - p[4].x);
    const cjRatio = jawGonial > 0 ? cheekSpread / jawGonial : 1;
    const idealCj = 1.08;
    const cheekJawMatch = scoreFromRatio(cjRatio, idealCj, 26);

    const weights = {
      thirds: 0.15,
      golden: 0.15,
      eyes: 0.15,
      noseLip: 0.12,
      jaw: 0.12,
      symmetry: 0.18,
      cheekJaw: 0.13,
    };

    const harmony =
      thirdsMatch * weights.thirds +
      goldenMatch * weights.golden +
      eyeMatch * weights.eyes +
      nlMatch * weights.noseLip +
      jawMatch * weights.jaw +
      symmetryMatch * weights.symmetry +
      cheekJawMatch * weights.cheekJaw;

    return {
      harmony,
      raw: {
        phiMeasured,
        eyeSpacingRatio,
        nlRatio,
        jawAngleDeg,
        cjRatio,
        thirdsVariance,
      },
      rows: [
        {
          id: "thirds",
          title: "Facial thirds",
          measured: `${uPct.toFixed(1)}% / ${mPct.toFixed(1)}% / ${lPct.toFixed(1)}% (upper / mid / lower)`,
          ideal: "~33% each",
          match: thirdsMatch,
          explain:
            "Classical balance divides the face into three equal vertical bands from hairline to brow, brow to nose base, and nose base to chin. Deviation is common and often stylistically neutral.",
        },
        {
          id: "golden",
          title: "Height × Phi (Golden ratio)",
          measured: phiMeasured.toFixed(3),
          ideal: `${phiIdeal} (length ÷ width)`,
          match: goldenMatch,
          explain:
            "Face length divided by bizygomatic-style width is often compared to the golden ratio Φ ≈ 1.618. Lighting and pose affect this strongly.",
        },
        {
          id: "eyes",
          title: "Eye spacing (1:1:1)",
          measured: eyeSpacingRatio.toFixed(3),
          ideal: "~1.0 (interocular ÷ mean eye width)",
          match: eyeMatch,
          explain:
            "One stylized ideal spaces eyes so inner-eye distance equals about one eye width—the ‘one eye apart’ rule of thumb.",
        },
        {
          id: "nose-lip",
          title: "Nose-to-lip vs lip-to-chin",
          measured: nlRatio.toFixed(3),
          ideal: `~${idealNl} (upper ÷ lower segment)`,
          match: nlMatch,
          explain:
            "Lower-face balance compares the vertical segment from nose base to upper lip against upper lip to chin. Many faces cluster near a ~55/45 style split.",
        },
        {
          id: "jaw",
          title: "Jaw angle",
          measured: `${jawAngleDeg.toFixed(1)}°`,
          ideal: "~110–118° (at chin between gonial vectors)",
          match: jawMatch,
          explain:
            "The angle between left and right jaw vectors at the menton summarizes jaw taper. Interpretation varies by sex, age, and ethnicity.",
        },
        {
          id: "symmetry",
          title: "Landmark symmetry",
          measured: `${symmetryMatch.toFixed(1)}%`,
          ideal: "100% (perfect mirror)",
          match: symmetryMatch,
          explain:
            "Left–right distances from the midline are compared at paired landmarks. Real faces are never perfectly symmetric; slight asymmetry is normal.",
        },
        {
          id: "cheek-jaw",
          title: "Cheekbone vs jaw width",
          measured: cjRatio.toFixed(3),
          ideal: `~${idealCj} (wider mid-face than jaw hinge)`,
          match: cheekJawMatch,
          explain:
            "A slightly wider mid-face than the lower jaw line can read as youthful or ‘heart-shaped’ in frontal view—pose and expression matter.",
        },
      ],
      debug: {
        hairlineY,
        faceHeight,
        faceWidth,
        midX,
        uPct,
        mPct,
        lPct,
      },
    };
  }

  function computeAppeal(metrics, confidence) {
    // Appeal is an *approximation* of perceived attractiveness cues from literature:
    // symmetry + averageness + proportion balance. It is NOT a social fact.
    const refs = {
      phi: 1.618,
      eyes: 1.0,
      nl: 0.55,
      jawDeg: 114,
      cj: 1.08,
      thirdsVar: 0,
    };

    const r = metrics.raw;
    // Subscores (0–100). Tolerances tuned to avoid collapsing to zero.
    const sSym = Math.round(metrics.rows.find((x) => x.id === "symmetry")?.match ?? 50);
    const sPhi = Math.round(scoreFromRatio(r.phiMeasured, refs.phi, 24));
    const sEyes = Math.round(scoreFromRatio(r.eyeSpacingRatio, refs.eyes, 42));
    const sNl = Math.round(scoreFromRatio(r.nlRatio, refs.nl, 46));
    const sJaw = Math.round(scoreFromIdeal(r.jawAngleDeg, refs.jawDeg, 18));
    const sCj = Math.round(scoreFromRatio(r.cjRatio, refs.cj, 34));
    const sThirds = Math.round(scoreFromIdeal(r.thirdsVariance, refs.thirdsVar, 5));

    // Averageness proxy: distance from reference ratio vector (normalized).
    const v = [
      (r.phiMeasured - refs.phi) / 0.35,
      (r.eyeSpacingRatio - refs.eyes) / 0.55,
      (r.nlRatio - refs.nl) / 0.28,
      (r.cjRatio - refs.cj) / 0.22,
      (r.jawAngleDeg - refs.jawDeg) / 16,
      (r.thirdsVariance - refs.thirdsVar) / 5,
    ];
    const distNorm = Math.sqrt(v.reduce((a, x) => a + x * x, 0) / v.length);
    const sAvg = Math.round(scoreFromIdeal(distNorm, 0, 0.95)); // absolute tolerance (ideal=0)

    // Weights: aligned with “symmetry + averageness + proportions” framing.
    // (Rhodes 2006 for symmetry/averageness; UNL paper combines canons + symmetry + golden ratio.)
    const W = {
      symmetry: 0.22,
      averageness: 0.22,
      thirds: 0.1,
      phi: 0.12,
      eyes: 0.12,
      nl: 0.08,
      jaw: 0.07,
      cj: 0.07,
    };

    const appeal =
      sSym * W.symmetry +
      sAvg * W.averageness +
      sThirds * W.thirds +
      sPhi * W.phi +
      sEyes * W.eyes +
      sNl * W.nl +
      sJaw * W.jaw +
      sCj * W.cj;

    const factors = [
      { key: "Symmetry", score: sSym, weight: W.symmetry, note: "More left–right balance tends to be rated more appealing in many studies." },
      { key: "Averageness", score: sAvg, weight: W.averageness, note: "Closer-to-average facial proportions are often rated as more appealing." },
      { key: "Facial thirds", score: sThirds, weight: W.thirds, note: "How balanced the upper/mid/lower vertical bands are in this photo." },
      { key: "Length/width (Phi)", score: sPhi, weight: W.phi, note: "How your length-to-width ratio compares to a classic reference." },
      { key: "Eye spacing", score: sEyes, weight: W.eyes, note: "Compares inner-eye distance to eye width (rule-of-thumb spacing)." },
      { key: "Nose–lip vs lip–chin", score: sNl, weight: W.nl, note: "Lower-face segment balance cue." },
      { key: "Jaw angle", score: sJaw, weight: W.jaw, note: "Coarse jaw taper signal from a frontal view." },
      { key: "Cheek vs jaw", score: sCj, weight: W.cj, note: "Mid-face width relative to jaw hinge width." },
    ];

    factors.sort((a, b) => b.score - a.score);
    const pros = factors.slice(0, 3);
    const cons = factors.slice(-3).reverse();

    const weightsText =
      `AppealScore = Σ(weight × subscore)\\n\\n` +
      `Symmetry: ${W.symmetry}\\n` +
      `Averageness: ${W.averageness}\\n` +
      `Facial thirds: ${W.thirds}\\n` +
      `Length/width (Phi): ${W.phi}\\n` +
      `Eye spacing: ${W.eyes}\\n` +
      `Nose–lip vs lip–chin: ${W.nl}\\n` +
      `Jaw angle: ${W.jaw}\\n` +
      `Cheek vs jaw: ${W.cj}\\n\\n` +
      `Each subscore is a smooth distance-to-reference function (not a pass/fail).`;

    const citations = [
      { label: "Rhodes (2006) — evolutionary psychology of facial beauty (symmetry/averageness)", url: "https://www2.psych.ubc.ca//~schaller/Psyc591Readings/Rhodes2006.pdf" },
      { label: "Face attractiveness index (neoclassical canons + symmetry + golden ratios)", url: "https://digitalcommons.unl.edu/cgi/viewcontent.cgi?article=1098&context=csearticles" },
      { label: "Neoclassical canons validity / variation across populations", url: "https://head-face-med.biomedcentral.com/counter/pdf/10.1186/s13005-015-0064-y.pdf" },
      { label: "Proportions-based facial attractiveness framework (Symmetry journal)", url: "https://www.mdpi.com/2073-8994/9/12/294" },
      { label: "“New Golden Ratios for Facial Beauty” (PMC)", url: "https://ncbi.nlm.nih.gov/pmc/articles/PMC2814183/" },
    ];

    return {
      score: Math.round(appeal),
      confidence,
      subscores: { sSym, sAvg, sThirds, sPhi, sEyes, sNl, sJaw, sCj },
      pros,
      cons,
      weightsText,
      citations,
    };
  }

  function drawOverlay(canvas, img, positions, metrics) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    const p = positions;
    const browYs = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26].map((i) => p[i].y);
    const browTopY = Math.min(...browYs);
    const chinY = p[8].y;
    const glabellaY = p[27].y;
    const subnasaleY = p[33].y;
    const hairlineY = metrics.debug.hairlineY;
    const midX = metrics.debug.midX;

    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(1, Math.round(w / 520));

    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    for (let i = 0; i < p.length; i++) {
      ctx.beginPath();
      ctx.arc(p[i].x, p[i].y, Math.max(1.5, w / 350), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(229, 45, 45, 0.85)";
    ctx.lineWidth = Math.max(1.5, w / 400);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(midX, hairlineY);
    ctx.lineTo(midX, chinY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(200, 200, 200, 0.75)";
    ctx.lineWidth = Math.max(1, w / 500);
    [[hairlineY], [glabellaY], [subnasaleY]].forEach(([y]) => {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    const j0 = p[0].x;
    const j1 = p[16].x;
    const jawY = chinY;
    ctx.beginPath();
    ctx.moveTo(j0, jawY);
    ctx.lineTo(j1, jawY);
    ctx.stroke();

    const le = p[36];
    const ri = p[39];
    const ri2 = p[42];
    const ro = p[45];
    ctx.strokeStyle = "rgba(180, 180, 180, 0.95)";
    ctx.beginPath();
    ctx.moveTo(le.x, le.y);
    ctx.lineTo(ri.x, ri.y);
    ctx.moveTo(ri2.x, ri2.y);
    ctx.lineTo(ro.x, ro.y);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.moveTo(p[27].x, p[27].y);
    ctx.lineTo(p[33].x, p[33].y);
    ctx.lineTo(p[51].x, p[51].y);
    ctx.lineTo(p[8].x, p[8].y);
    ctx.stroke();
  }

  function buildSymmetryHeatmap(canvas, img, faceBox, midX) {
    const maxW = 320;
    const scale = Math.min(1, maxW / img.naturalWidth);
    const rw = Math.round(img.naturalWidth * scale);
    const rh = Math.round(img.naturalHeight * scale);

    const off = document.createElement("canvas");
    off.width = rw;
    off.height = rh;
    const octx = off.getContext("2d");
    octx.drawImage(img, 0, 0, rw, rh);
    const imgData = octx.getImageData(0, 0, rw, rh);
    const d = imgData.data;

    const sx = faceBox.x * scale;
    const sy = faceBox.y * scale;
    const sw = faceBox.width * scale;
    const sh = faceBox.height * scale;
    const mxx = midX * scale;

    const out = octx.createImageData(rw, rh);
    const od = out.data;

    let maxDiff = 0;
    const diffs = new Float32Array(rw * rh);

    for (let y = Math.max(0, Math.floor(sy)); y < Math.min(rh, Math.ceil(sy + sh)); y++) {
      for (let x = Math.max(0, Math.floor(sx)); x < Math.min(rw, Math.ceil(sx + sw)); x++) {
        const xm = 2 * mxx - x;
        if (xm < 0 || xm >= rw - 1) continue;
        const xi = Math.floor(xm);
        const xf = xm - xi;
        const i0 = (y * rw + x) * 4;
        const i1 = (y * rw + xi) * 4;
        const i2 = (y * rw + xi + 1) * 4;
        for (let c = 0; c < 3; c++) {
          const v1 = d[i1 + c] * (1 - xf) + d[i2 + c] * xf;
          const diff = Math.abs(d[i0 + c] - v1);
          const idx = y * rw + x;
          diffs[idx] += diff;
        }
      }
    }

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const idx = y * rw + x;
        maxDiff = Math.max(maxDiff, diffs[idx]);
      }
    }

    const gamma = 0.85;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const idx = y * rw + x;
        const t = maxDiff > 0 ? diffs[idx] / maxDiff : 0;
        const e = Math.pow(t, gamma);
        const oi = idx * 4;
        const lum = Math.round(28 + (1 - e) * 120);
        const rCh = Math.round(e * 210);
        od[oi] = Math.min(255, lum + rCh * 0.4);
        od[oi + 1] = lum;
        od[oi + 2] = lum;
        od[oi + 3] = 255;
      }
    }

    canvas.width = rw;
    canvas.height = rh;
    const cctx = canvas.getContext("2d");
    cctx.putImageData(out, 0, 0);

    cctx.strokeStyle = "rgba(255,255,255,0.25)";
    cctx.setLineDash([4, 4]);
    cctx.beginPath();
    cctx.moveTo(mxx, 0);
    cctx.lineTo(mxx, rh);
    cctx.stroke();
  }

  function updateRadar(metrics) {
    const short = {
      thirds: "Facial thirds",
      golden: "Golden Φ",
      eyes: "Eye spacing",
      "nose-lip": "Nose / lip / chin",
      jaw: "Jaw angle",
      symmetry: "Symmetry",
      "cheek-jaw": "Cheek vs jaw",
    };
    const labels = metrics.rows.map((r) => short[r.id] || r.title.slice(0, 14));
    const data = metrics.rows.map((r) => Math.round(r.match));

    if (radarChartInstance) {
      radarChartInstance.destroy();
    }

    const ctx = els.radarChart.getContext("2d");
    radarChartInstance = new Chart(ctx, {
      type: "radar",
      data: {
        labels,
        datasets: [
          {
            label: "Subject match %",
            data,
            backgroundColor: "rgba(255, 255, 255, 0.08)",
            borderColor: "rgba(255, 255, 255, 0.95)",
            pointBackgroundColor: "#ffffff",
            pointBorderColor: "#000000",
            borderWidth: 1.5,
            fill: true,
          },
          {
            label: "Ideal baseline (100)",
            data: new Array(labels.length).fill(100),
            backgroundColor: "transparent",
            borderColor: "rgba(122, 122, 122, 0.55)",
            borderDash: [5, 5],
            pointRadius: 0,
            borderWidth: 1,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { stepSize: 20, color: "#7a7a7a" },
            grid: { color: "rgba(255,255,255,0.07)" },
            angleLines: { color: "rgba(255,255,255,0.07)" },
            pointLabels: { color: "#ececec", font: { size: 9, family: "JetBrains Mono, monospace" } },
          },
        },
        plugins: {
          legend: {
            labels: { color: "#7a7a7a", font: { size: 10, family: "JetBrains Mono, monospace" } },
          },
        },
      },
    });
  }

  function renderMetricCards(metrics) {
    els.metricsGrid.innerHTML = "";
    metrics.rows.forEach((row, idx) => {
      const card = document.createElement("article");
      card.className = "metric-card";
      card.style.animationDelay = `${idx * 0.05}s`;
      card.innerHTML = `
        <h3>${row.title}</h3>
        <div class="metric-values">
          <span>MEAS <strong>${row.measured}</strong></span>
          <span>REF <strong>${row.ideal}</strong></span>
        </div>
        <div class="metric-bar-wrap" aria-hidden="true">
          <div class="metric-bar" style="width:0%"></div>
        </div>
        <span class="match-pill">Δ CONFORMANCE ${Math.round(row.match)}%</span>
        <p class="metric-desc">${row.explain}</p>
      `;
      els.metricsGrid.appendChild(card);
      requestAnimationFrame(() => {
        const bar = card.querySelector(".metric-bar");
        if (bar) bar.style.width = `${Math.round(row.match)}%`;
      });
    });
  }

  function renderAppeal(metrics) {
    if (!metrics || !metrics.appeal) return;
    const a = metrics.appeal;
    if (els.appealScore) els.appealScore.textContent = String(a.score);
    if (els.appealTier) {
      const t = tierFromHarmonyScore(metrics.harmony);
      if (t) {
        els.appealTier.hidden = false;
        els.appealTier.textContent = `Tier (${t.acronym}): ${t.title}.`;
      } else {
        els.appealTier.hidden = true;
      }
    }
    if (els.appealConfidence) {
      const c = a.confidence.confidence;
      const label = c >= 80 ? `High (${c}%)` : c >= 55 ? `Medium (${c}%)` : `Low (${c}%)`;
      els.appealConfidence.textContent = label;
      els.appealConfidence.style.color = c >= 80 ? "var(--ok)" : c >= 55 ? "#fff" : "#f0c4bc";
    }

    if (els.appealWarnings) {
      els.appealWarnings.innerHTML = "";
      (a.confidence.warnings || []).slice(0, 4).forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t;
        els.appealWarnings.appendChild(li);
      });
    }

    if (els.appealTips) {
      els.appealTips.innerHTML = "";
      const tips = (a.confidence.tips || []).slice(0, 4);
      (tips.length ? tips : ["Use even front lighting and a straight-on, neutral expression."]).forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t;
        els.appealTips.appendChild(li);
      });
    }

    if (els.appealPros) {
      els.appealPros.innerHTML = "";
      a.pros.forEach((f) => {
        const li = document.createElement("li");
        li.textContent = `${f.key}: ${f.score}% — ${f.note}`;
        els.appealPros.appendChild(li);
      });
    }
    if (els.appealCons) {
      els.appealCons.innerHTML = "";
      a.cons.forEach((f) => {
        const li = document.createElement("li");
        li.textContent = `${f.key}: ${f.score}% — ${f.note}`;
        els.appealCons.appendChild(li);
      });
    }

    if (els.appealWeights) els.appealWeights.textContent = a.weightsText;

    if (els.appealCites) {
      els.appealCites.innerHTML = "";
      a.citations.forEach((c) => {
        const li = document.createElement("li");
        const aEl = document.createElement("a");
        aEl.href = c.url;
        aEl.target = "_blank";
        aEl.rel = "noreferrer";
        aEl.textContent = c.label;
        li.appendChild(aEl);
        els.appealCites.appendChild(li);
      });
    }
  }

  function setHarmonyScore(score) {
    els.harmonyValue.textContent = "—";
    els.ringProgress.style.strokeDashoffset = String(RING_C);
    els.harmonyValue.classList.remove("reveal");

    requestAnimationFrame(() => {
      const v = Math.round(score);
      renderHarmonyTier(v);
      els.harmonyValue.classList.add("reveal");
      let t0 = null;
      const dur = 1100;
      const start = 0;
      const end = v;

      function tick(ts) {
        if (t0 === null) t0 = ts;
        const u = Math.min(1, (ts - t0) / dur);
        const ease = 1 - Math.pow(1 - u, 3);
        const cur = Math.round(start + (end - start) * ease);
        els.harmonyValue.textContent = String(cur);
        const off = RING_C * (1 - cur / 100);
        els.ringProgress.style.strokeDashoffset = String(off);
        if (u < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  async function ensureModels() {
    if (modelsLoaded) return;
    showScan("MODEL LOAD", "Loading face models (one-time)…");
    setStatus("Loading face models (one-time)…");
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    modelsLoaded = true;
    setStatus("Models ready. Add a photo.");
  }

  async function analyzeImage(img) {
    await ensureModels();
    showScan("MESH EXTRACT", "Locating face + landmarks…");
    setStatus("Analyzing face…");

    const det = await faceapi
      .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.45 }))
      .withFaceLandmarks();

    if (!det) {
      setStatus("No face detected. Try a clearer, front-facing photo.", true);
      hideScan(false);
      return;
    }

    setScanStage("RATIO COMPUTE", "Computing classical proportions…");
    const positions = det.landmarks.positions;
    const metrics = computeMetrics(positions);
    setScanStage("APPEAL MODEL", "Estimating appeal proxy + confidence…");
    const conf = computeConfidence(positions, det.detection.box, img);
    metrics.appeal = computeAppeal(metrics, conf);

    els.placeholder.classList.add("hidden");
    els.resultWrap.classList.remove("hidden");
    els.preview.src = img.src;
    await new Promise((r) => {
      if (img.complete) r();
      else img.onload = r;
    });

    drawOverlay(els.overlay, img, positions, metrics);
    els.btnClear.disabled = false;

    const box = det.detection.box;
    buildSymmetryHeatmap(els.heatmapCanvas, img, box, metrics.debug.midX);

    renderMetricCards(metrics);
    updateRadar(metrics);
    setHarmonyScore(metrics.harmony);
    lastMetrics = metrics;
    // AI assistant removed
    renderAppeal(metrics);
    setStatus("Analysis complete — open Results tab.");
    setActiveTab("results");
    hideScan(true);
  }

  function loadImageFromFile(file) {
    setActiveTab("scan");
    showScan("INGEST", "Buffering image…");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      analyzeImage(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("Could not read that image.", true);
      hideScan(false);
    };
    img.src = url;
  }

  async function startWebcam() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus(
          "This browser does not support live webcam here. Use “Take photo” or choose a picture from the box above.",
          true,
        );
        return;
      }
      streamRef = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      els.webcam.srcObject = streamRef;
      els.webcamWrap.classList.remove("hidden");
      setStatus("Position your face in the frame, then capture.");
    } catch (e) {
      const blockedOnHttpPhone =
        typeof window.isSecureContext !== "undefined" &&
        !window.isSecureContext &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1";
      let msg =
        "Camera access was denied or unavailable. Use “Take photo” to use your camera app, or allow camera in site settings.";
      if (blockedOnHttpPhone) {
        msg =
          "Live webcam is blocked on http:// when you open this site from another device (phone browsers require https:// for that). Use “Take photo” — it opens your regular Camera app — or pick a photo from the box above.";
      } else if (e && (e.name === "NotAllowedError" || e.name === "PermissionDeniedError")) {
        msg =
          "Camera permission was denied. Change it in your browser or system settings, or use “Take photo” / choose a file.";
      } else if (e && e.name === "NotFoundError") {
        msg = "No camera was found. Choose a photo from your library instead.";
      }
      setStatus(msg, true);
    }
  }

  function stopWebcam() {
    if (streamRef) {
      streamRef.getTracks().forEach((t) => t.stop());
      streamRef = null;
    }
    els.webcamWrap.classList.add("hidden");
  }

  function captureWebcam() {
    const video = els.webcam;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    stopWebcam();
    const img = new Image();
    img.onload = () => analyzeImage(img);
    img.src = c.toDataURL("image/jpeg", 0.92);
  }

  function syncOverlaySize() {
    const img = els.preview;
    const cv = els.overlay;
    if (!img.naturalWidth) return;
    cv.style.width = "100%";
    cv.style.height = "100%";
  }

  /**
   * Map Harmony score (0–100) to illustrative tier bands informed by tier-list style tables.
   * Not population percentiles—not clinical—and the bottom bracket uses LTN wording only (no harsh labels).
   */
  function tierFromHarmonyScore(score) {
    const s = Math.round(Number(score));
    if (Number.isNaN(s)) return null;
    if (s >= 94)
      return {
        acronym: "Chad",
        title: "Chad · top band",
        note: "~top ~1% on this heuristic (very rare—strict geometry match).",
        key: "chad",
      };
    if (s >= 88)
      return {
        acronym: "CL",
        title: "Chadlite · strong band",
        note: "~top ~1–5% heuristic band versus our proportional baselines.",
        key: "chadlite",
      };
    if (s >= 80)
      return {
        acronym: "HTN",
        title: "High-tier normie",
        note: "Score ≥ 80 — strong match to multiple classical proportions in one photo.",
        key: "htn",
      };
    if (s >= 50)
      return {
        acronym: "MTN",
        title: "Mid-tier normie",
        note: "Scores 50–79 — typical spread; lighting and pose still move numbers a lot.",
        key: "mtn",
      };
    return {
      acronym: "LTN",
      title: "Low-tier normie",
      note: "Below 50 — often angle, blur, facial size in frame, or proportion spread—not a verdict on anyone.",
      key: "ltn",
    };
  }

  function renderHarmonyTier(score) {
    const t = tierFromHarmonyScore(score);
    if (!t) {
      if (els.harmonyTier) els.harmonyTier.classList.add("hidden");
      if (els.headerTierPill) {
        els.headerTierPill.classList.add("hidden");
        delete els.headerTierPill.dataset.tierKey;
      }
      if (els.headerTierAcronym) els.headerTierAcronym.textContent = "—";
      return;
    }
    if (els.harmonyTier) {
      els.harmonyTier.classList.remove("hidden");
      els.harmonyTier.dataset.tierKey = t.key;
      if (els.harmonyTierAcronym) els.harmonyTierAcronym.textContent = t.acronym;
      if (els.harmonyTierTitle) els.harmonyTierTitle.textContent = t.title;
      if (els.harmonyTierNote) els.harmonyTierNote.textContent = t.note;
    }
    if (els.headerTierPill && els.headerTierAcronym) {
      els.headerTierPill.classList.remove("hidden");
      els.headerTierPill.dataset.tierKey = t.key;
      els.headerTierAcronym.textContent = t.acronym;
      els.headerTierPill.title = `${t.title} — ${t.note}`;
    }
  }

  // AI assistant removed

  document.querySelectorAll("button.tab-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.getAttribute("data-tab")));
  });
  document.querySelectorAll("[data-go-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      const tab = el.getAttribute("data-go-tab");
      if (tab) setActiveTab(tab);
    });
  });
  if (els.mobileDock) {
    els.mobileDock.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (b) setActiveTab(b.getAttribute("data-tab"));
    });
  }

  if (els.btnBegin) {
    els.btnBegin.addEventListener("click", () => {
      setActiveTab("scan");
      els.cameraCaptureInput.click();
    });
  }
  if (els.btnUploadPhoto) {
    els.btnUploadPhoto.addEventListener("click", () => els.fileInput.click());
  }

  els.dropzone.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener("change", () => {
    const f = els.fileInput.files && els.fileInput.files[0];
    if (f) loadImageFromFile(f);
    els.fileInput.value = "";
  });

  els.btnTakePhoto.addEventListener("click", () => {
    els.cameraCaptureInput.click();
  });

  els.cameraCaptureInput.addEventListener("change", () => {
    const f = els.cameraCaptureInput.files && els.cameraCaptureInput.files[0];
    if (f) loadImageFromFile(f);
    els.cameraCaptureInput.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) => {
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("dragover");
    });
  });
  els.dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) loadImageFromFile(f);
  });

  els.btnWebcam.addEventListener("click", startWebcam);
  els.btnWebcamCancel.addEventListener("click", stopWebcam);
  els.btnCapture.addEventListener("click", captureWebcam);

  els.btnClear.addEventListener("click", () => {
    els.preview.removeAttribute("src");
    els.placeholder.classList.remove("hidden");
    els.resultWrap.classList.add("hidden");
    els.metricsGrid.innerHTML = "";
    els.harmonyValue.textContent = "—";
    els.ringProgress.style.strokeDashoffset = String(RING_C);
    els.heatmapCanvas.width = 0;
    els.heatmapCanvas.height = 0;
    if (radarChartInstance) {
      radarChartInstance.destroy();
      radarChartInstance = null;
    }
    els.btnClear.disabled = true;
    lastMetrics = null;
    if (els.harmonyTier) els.harmonyTier.classList.add("hidden");
    if (els.headerTierPill) {
      els.headerTierPill.classList.add("hidden");
      delete els.headerTierPill.dataset.tierKey;
    }
    if (els.headerTierAcronym) els.headerTierAcronym.textContent = "—";
    if (els.appealTier) {
      els.appealTier.hidden = true;
      els.appealTier.textContent = "";
    }
    // AI assistant removed
    if (els.appealScore) els.appealScore.textContent = "—";
    if (els.appealConfidence) els.appealConfidence.textContent = "—";
    if (els.appealWarnings) els.appealWarnings.innerHTML = "";
    if (els.appealTips) els.appealTips.innerHTML = "";
    if (els.appealPros) els.appealPros.innerHTML = "";
    if (els.appealCons) els.appealCons.innerHTML = "";
    setStatus("Cleared.");
    hideScan(false);
  });

  window.addEventListener("resize", syncOverlaySize);
  els.preview.addEventListener("load", syncOverlaySize);

  // AI assistant removed

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideScan(false);
  });

  setStatus("Awaiting ingress — load models on first specimen.");
})();
