/* ======================================================================
 * Petite carte « tuiles » sur un canvas (sans bibliothèque) : plan
 * OpenStreetMap ou vue satellite, déplacement au doigt, zoom à deux doigts,
 * double-tap, appui = position. Les dessins (zone, joueur, marqueurs…) sont
 * faits par la page dans onDraw(ctx, map).
 * Les tuiles viennent d'Internet (OpenStreetMap / Esri) : seule la carte
 * en a besoin, le jeu fonctionne sans.
 * ====================================================================== */
"use strict";

const TILE_SRC = {
  osm: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, attr: "© OpenStreetMap" },
  sat: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, attr: "© Esri, Maxar, Earthstar" },
};
const Geo = {
  R: 6371000,
  dist(a, b){           // [la, lo] → mètres
    const r = Math.PI / 180, da = (b[0] - a[0]) * r, dO = (b[1] - a[1]) * r;
    const h = Math.sin(da / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dO / 2) ** 2;
    return 2 * this.R * Math.asin(Math.min(1, Math.sqrt(h)));
  },
  offset(p, dn, de){ return [p[0] + dn / 111320, p[1] + de / (111320 * Math.cos(p[0] * Math.PI / 180))]; },
  bearing(a, b){
    const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  },
  inPoly(p, poly){
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if ((yi > p[0]) !== (yj > p[0]) && p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },
  /* zone : { type: "circle", c, r } ou { type: "poly", poly, excl: [poly…] } */
  inZone(p, z){
    if (!z) return true;
    if (z.type === "circle") return this.dist(p, z.c) <= z.r;
    if (!this.inPoly(p, z.poly)) return false;
    return !(z.excl || []).some(e => e.length >= 3 && this.inPoly(p, e));
  },
  bbox(z){
    if (z.type === "circle") { const a = this.offset(z.c, -z.r, -z.r), b = this.offset(z.c, z.r, z.r); return [a[0], a[1], b[0], b[1]]; }
    const la = z.poly.map(p => p[0]), lo = z.poly.map(p => p[1]);
    return [Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo)];
  },
  randomIn(z, avoid = null, minD = 0){
    const [a0, o0, a1, o1] = this.bbox(z);
    for (let k = 0; k < 6000; k++) {
      const p = [a0 + Math.random() * (a1 - a0), o0 + Math.random() * (o1 - o0)];
      if (!this.inZone(p, z)) continue;
      if (avoid && k < 4000 && this.dist(p, avoid) < minD) continue;
      return p;
    }
    return null;
  },
  area(z){                // m² (approx.)
    if (z.type === "circle") return Math.PI * z.r * z.r;
    const ref = z.poly[0], xy = P => P.map(p => [(p[1] - ref[1]) * 111320 * Math.cos(ref[0] * Math.PI / 180), (p[0] - ref[0]) * 111320]);
    const sh = P => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(s / 2); };
    return Math.max(0, sh(xy(z.poly)) - (z.excl || []).filter(e => e.length >= 3).reduce((a, e) => a + sh(xy(e)), 0));
  },
  dir(deg){ return ["au nord", "au nord-est", "à l'est", "au sud-est", "au sud", "au sud-ouest", "à l'ouest", "au nord-ouest"][Math.round(deg / 45) % 8]; },
};

class GeoMap {
  constructor(canvas, opts = {}){
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    this.z = opts.zoom || 17; this.c = opts.center || [48.8566, 2.3522];
    this.src = "osm"; this.tiles = new Map(); this.onDraw = null; this.onTap = null;
    this.ptrs = new Map(); this.dirty = true;
    const ev = (n, f) => canvas.addEventListener(n, f, { passive: false });
    ev("pointerdown", e => this._down(e)); ev("pointermove", e => this._move(e));
    ev("pointerup", e => this._up(e)); ev("pointercancel", e => this._up(e, true));
    ev("wheel", e => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 0.5 : -0.5); });
    canvas.style.touchAction = "none";
    const loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  /* coordonnées « monde » (pixels au zoom z) */
  _w(p, z = this.z){ const s = 256 * 2 ** z, r = p[0] * Math.PI / 180; return [(p[1] + 180) / 360 * s, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s]; }
  _p(x, y, z = this.z){ const s = 256 * 2 ** z, lo = x / s * 360 - 180, n = Math.PI - 2 * Math.PI * y / s; return [180 / Math.PI * Math.atan(Math.sinh(n)), lo]; }
  get W(){ return this.cv.clientWidth; } get H(){ return this.cv.clientHeight; }
  toScreen(p){ const a = this._w(p), c = this._w(this.c); return [a[0] - c[0] + this.W / 2, a[1] - c[1] + this.H / 2]; }
  fromScreen(x, y){ const c = this._w(this.c); return this._p(c[0] + x - this.W / 2, c[1] + y - this.H / 2); }
  mPerPx(){ return 156543.03392 * Math.cos(this.c[0] * Math.PI / 180) / 2 ** this.z; }
  setView(c, z){ this.c = c; if (z) this.z = clamp(z, 3, TILE_SRC[this.src].max); this.dirty = true; }
  fit(bb, pad = 30){   // [laMin, loMin, laMax, loMax]
    this.c = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    for (let z = 19; z >= 3; z--) { const a = this._w([bb[2], bb[1]], z), b = this._w([bb[0], bb[3]], z); if (b[0] - a[0] < this.W - pad * 2 && b[1] - a[1] < this.H - pad * 2) { this.z = z; break; } }
    this.dirty = true;
  }
  zoomAt(x, y, dz){
    const before = this.fromScreen(x, y);
    this.z = clamp(this.z + dz, 3, TILE_SRC[this.src].max);
    const after = this.fromScreen(x, y);
    this.c = [this.c[0] + before[0] - after[0], this.c[1] + before[1] - after[1]]; this.dirty = true;
  }
  _xy(e){ const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  _down(e){
    e.preventDefault(); this.cv.setPointerCapture(e.pointerId);
    const p = this._xy(e); this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size === 1) this.tap = { p, t: Date.now(), moved: false };
    else this.tap = null;
    if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.z }; }
  }
  _move(e){
    if (!this.ptrs.has(e.pointerId)) return;
    const p = this._xy(e), old = this.ptrs.get(e.pointerId); this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size === 1) {
      if (this.tap && Math.hypot(p[0] - this.tap.p[0], p[1] - this.tap.p[1]) > 8) this.tap.moved = true;
      if (!this.tap || this.tap.moved) {
        const c = this._w(this.c); this.c = this._p(c[0] - (p[0] - old[0]), c[1] - (p[1] - old[1])); this.dirty = true;
      }
    } else if (this.ptrs.size === 2 && this.pinch) {
      const [a, b] = [...this.ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, target = this.pinch.z + Math.log2(d / Math.max(10, this.pinch.d));
      this.zoomAt(mx, my, target - this.z);
    }
  }
  _up(e, cancel){
    const t = this.tap; this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (cancel || !t || t.moved || Date.now() - t.t > 600) { if (!this.ptrs.size) this.tap = null; return; }
    this.tap = null;
    const now = Date.now();
    if (this.lastTap && now - this.lastTap.t < 300 && Math.hypot(t.p[0] - this.lastTap.p[0], t.p[1] - this.lastTap.p[1]) < 30) {
      this.lastTap = null; clearTimeout(this.tapTimer); this.zoomAt(t.p[0], t.p[1], 1); return;     // double-tap : zoom
    }
    this.lastTap = { t: now, p: t.p };
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => { if (this.onTap) this.onTap(this.fromScreen(t.p[0], t.p[1]), t.p); }, 260);
  }
  _tile(z, x, y){
    const n = 2 ** z; x = ((x % n) + n) % n; if (y < 0 || y >= n) return null;
    const key = this.src + "/" + z + "/" + x + "/" + y; let t = this.tiles.get(key);
    if (!t) {
      t = new Image(); t.crossOrigin = "anonymous"; t.ok = false;
      t.onload = () => { t.ok = true; this.dirty = true; }; t.onerror = () => { t.bad = true; };
      t.src = TILE_SRC[this.src].url(z, x, y); this.tiles.set(key, t);
      if (this.tiles.size > 400) this.tiles.delete(this.tiles.keys().next().value);
    }
    return t;
  }
  draw(){
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = this.W, H = this.H;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const x = this.ctx; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = "#1d2330"; x.fillRect(0, 0, W, H);
    const zi = Math.floor(this.z), sc = 2 ** (this.z - zi), c = this._w(this.c, zi), ts = 256 * sc;
    const x0 = c[0] - W / 2 / sc, y0 = c[1] - H / 2 / sc;
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W / sc) / 256); tx++)
      for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H / sc) / 256); ty++) {
        const t = this._tile(zi, tx, ty), px = (tx * 256 - x0) * sc, py = (ty * 256 - y0) * sc;
        if (t && t.ok) x.drawImage(t, px, py, ts + 0.5, ts + 0.5);
        else { x.strokeStyle = "#2a3242"; x.strokeRect(px, py, ts, ts); }
      }
    if (this.onDraw) this.onDraw(x, this);
    x.font = "10px system-ui"; x.fillStyle = "#000a"; const a = TILE_SRC[this.src].attr, aw = x.measureText(a).width + 8;
    x.fillRect(W - aw, H - 14, aw, 14); x.fillStyle = "#fff"; x.fillText(a, W - aw + 4, H - 4);
  }
}
