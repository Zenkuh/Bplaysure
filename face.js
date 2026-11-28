/* ======================================================================
 * Visage par IA (Blow Trainer « bouche IA », Ahegao Detector)
 *  - FaceAI : MediaPipe Face Landmarker (Google, Apache 2.0) : 478 points
 *    du visage + 52 expressions (« blendshapes »). Fichiers dans mp/.
 *  - AgNet  : réseau « ahegao » du projet Sir-Prise/ahegao-detector
 *    (petit CNN Keras 75×75), exécuté ici en JavaScript pur, sans
 *    TensorFlow.js. Fichiers dans ag/ (téléchargés à la compilation).
 * Tout tourne sur le téléphone : aucune image ne quitte l'appareil.
 * ====================================================================== */
"use strict";

const FaceAI = {
  lm: null, state: "off", err: "", lastTs: 0,
  async load(){
    if (this.state === "ready" || this.state === "loading") return this.state === "ready";
    this.state = "loading";
    try {
      const vision = await import("./mp/vision_bundle.js");
      const files = await vision.FilesetResolver.forVisionTasks(new URL("mp/wasm", location.href).href);
      this.lm = await vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL("mp/face_landmarker.task", location.href).href, delegate: "CPU" },
        runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      });
      this.state = "ready"; return true;
    } catch (e) { this.state = "error"; this.err = e.message || String(e); return false; }
  },
  /* → { pts: [{x,y,z}…] (0–1), bs: { jawOpen: 0–1, … } } ou null */
  detect(v){
    if (this.state !== "ready" || !v || v.readyState < 2 || !v.videoWidth) return null;
    let ts = performance.now(); if (ts <= this.lastTs) ts = this.lastTs + 1; this.lastTs = ts;
    try {
      const r = this.lm.detectForVideo(v, ts);
      if (!r.faceLandmarks || !r.faceLandmarks[0]) return null;
      const bs = {};
      if (r.faceBlendshapes && r.faceBlendshapes[0]) for (const c of r.faceBlendshapes[0].categories) bs[c.categoryName] = c.score;
      const m = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0] ? r.facialTransformationMatrixes[0].data : null;
      return { pts: r.faceLandmarks[0], bs, head: m ? this.angles(m) : null };
    } catch { return null; }
  },
  /* Orientation de la tête (degrés) depuis la matrice 4×4 (colonnes) : lacet (gauche/droite), tangage (haut/bas) */
  angles(m){
    const yaw = Math.atan2(m[8], m[10]) * 180 / Math.PI, pitch = Math.asin(clamp(-m[9], -1, 1)) * 180 / Math.PI;
    return { yaw, pitch };
  },
  /* Centre de la bouche (moyenne des lèvres et des commissures), en coordonnées 0–1 */
  mouth(f){ const P = f.pts, I = [13, 14, 61, 291, 0, 17]; let x = 0, y = 0; for (const i of I) { x += P[i].x; y += P[i].y; } return { x: x / I.length, y: y / I.length }; },
  /* Cadre carré du visage en pixels vidéo */
  box(f, v, scale = 1.1){
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of f.pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    const W = v.videoWidth, H = v.videoHeight, cx = (x0 + x1) / 2 * W, cy = (y0 + y1) / 2 * H;
    const side = Math.max((x1 - x0) * W, (y1 - y0) * H) * scale;
    return { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
  },
};

/* ---------------------------------------------------------------------
 * CNN ahegao : Conv(16)→Pool→Conv(32)→Pool→Conv(64)→Pool→Dense(512)→Dense(1)
 * Entrée 75×75×3 (RVB / 255), sortie sigmoïde = probabilité d'ahegao.
 * --------------------------------------------------------------------- */
const AgNet = {
  state: "off", W: null, err: "",
  async load(){
    if (this.state === "ready" || this.state === "loading") return this.state === "ready";
    this.state = "loading";
    try {
      // dans l'APK : dossier ag/ ; version web : chargé depuis le projet d'origine (Sir-Prise/ahegao-detector)
      const SRC = "https://raw.githubusercontent.com/Sir-Prise/ahegao-detector/48906bcce9f6b2ded2ced85c10b481882d1fa341/src/assets/model-ag2/";
      let base = "ag/", r = await fetch(base + "model.json").catch(() => null);
      if (!r || !r.ok) { base = SRC; r = await fetch(base + "model.json"); }
      const mj = await r.json();
      const buf = await (await fetch(base + "group1-shard1of1.bin")).arrayBuffer();
      // poids quantifiés en uint8 (valeur = q × scale + min) ou float32
      const W = {}; let off = 0;
      for (const g of mj.weightsManifest) for (const w of g.weights) {
        const n = w.shape.reduce((a, b) => a * b, 1), q = w.quantization;
        if (q && q.dtype === "uint8") {
          const u = new Uint8Array(buf, off, n), f = new Float32Array(n);
          for (let i = 0; i < n; i++) f[i] = u[i] * q.scale + q.min;
          W[w.name] = f; off += n;
        } else { W[w.name] = new Float32Array(buf.slice(off, off + n * 4)); off += n * 4; }
      }
      if (off !== buf.byteLength || !W["dense/kernel"] || W["dense/kernel"].length !== 5184 * 512) throw new Error("modèle inattendu");
      this.W = W; this.state = "ready"; return true;
    } catch (e) { this.state = "error"; this.err = e.message || String(e); return false; }
  },
  /* conv 3×3 « same » + ReLU, puis max-pool 2×2 (valid), format HWC */
  convPool(inp, H, Wd, C, k, b, F){
    const out = new Float32Array(H * Wd * F);
    for (let y = 0; y < H; y++) for (let x = 0; x < Wd; x++) {
      const o = (y * Wd + x) * F;
      for (let f = 0; f < F; f++) out[o + f] = b[f];
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= Wd) continue;
          const ib = (yy * Wd + xx) * C, kb = ((dy + 1) * 3 + (dx + 1)) * C * F;
          for (let c = 0; c < C; c++) {
            const v = inp[ib + c]; if (v === 0) continue;
            const kr = kb + c * F;
            for (let f = 0; f < F; f++) out[o + f] += v * k[kr + f];
          }
        }
      }
      for (let f = 0; f < F; f++) if (out[o + f] < 0) out[o + f] = 0;
    }
    const H2 = H >> 1, W2 = Wd >> 1, p = new Float32Array(H2 * W2 * F);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) for (let f = 0; f < F; f++) {
      const a = ((2 * y) * Wd + 2 * x) * F + f, c = ((2 * y + 1) * Wd + 2 * x) * F + f;
      p[(y * W2 + x) * F + f] = Math.max(out[a], out[a + F], out[c], out[c + F]);
    }
    return p;
  },
  /* rgb : Float32Array 75×75×3 (0–1) → probabilité 0–1 */
  predict(rgb){
    const W = this.W; if (!W) return null;
    let t = this.convPool(rgb, 75, 75, 3, W["conv2d/kernel"], W["conv2d/bias"], 16);        // 37×37×16
    t = this.convPool(t, 37, 37, 16, W["conv2d_1/kernel"], W["conv2d_1/bias"], 32);          // 18×18×32
    t = this.convPool(t, 18, 18, 32, W["conv2d_2/kernel"], W["conv2d_2/bias"], 64);          // 9×9×64 = 5184
    const k = W["dense/kernel"], h = new Float32Array(512); h.set(W["dense/bias"]);
    for (let i = 0; i < 5184; i++) { const v = t[i]; if (v === 0) continue; const r = i * 512; for (let j = 0; j < 512; j++) h[j] += v * k[r + j]; }
    let z = W["dense_1/bias"][0]; const k2 = W["dense_1/kernel"];
    for (let j = 0; j < 512; j++) if (h[j] > 0) z += h[j] * k2[j];
    return 1 / (1 + Math.exp(-z));
  },
  /* Recadre le visage (carré) depuis la vidéo vers 75×75 puis prédit */
  cv: null,
  fromVideo(v, box){
    if (!this.cv) { this.cv = document.createElement("canvas"); this.cv.width = this.cv.height = 75; this.cx = this.cv.getContext("2d", { willReadFrequently: true }); }
    this.cx.fillStyle = "#000"; this.cx.fillRect(0, 0, 75, 75);
    this.cx.drawImage(v, box.x, box.y, box.w, box.h, 0, 0, 75, 75);
    const d = this.cx.getImageData(0, 0, 75, 75).data, rgb = new Float32Array(75 * 75 * 3);
    for (let i = 0, j = 0; i < d.length; i += 4) { rgb[j++] = d[i] / 255; rgb[j++] = d[i + 1] / 255; rgb[j++] = d[i + 2] / 255; }
    return this.predict(rgb);
  },
};
