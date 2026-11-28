/* ======================================================================
 * Modes « Sortie » et « Télécommande »
 *  - Sensors : accéléromètre, GPS, micro (natifs dans l'APK, même écran
 *    éteint ; API web dans un navigateur, écran allumé uniquement)
 *  - Link : liaison entre deux téléphones par un relais MQTT public,
 *    chiffrée de bout en bout (AES-GCM) avec la clé du code d'appairage.
 * Nécessite common.js.
 * ====================================================================== */
"use strict";

/* ---------------------------------------------------------------------
 * Capteurs
 * ------------------------------------------------------------------- */
const Sensors = {
  acc: null, accT: 0,          // agitation : RMS de l'accélération linéaire (m/s²)
  spd: null, spdAcc: null, spdT: 0, // vitesse GPS (m/s) et précision (m)
  db: null, dbT: 0,            // niveau sonore ambiant (dBFS, 0 = max, ≈ -90 = silence)
  pos: null, posT: 0,          // position (Vibe & Seek seulement) : { la, lo, acc }
  onPos: null,
  running: false, native: NATIVE && typeof window.AndroidBridge.sensorsStart === "function",
  _web: null,
  get accLive(){ return this.acc != null && Date.now() - this.accT < 3000; },
  get spdLive(){ return this.spd != null && Date.now() - this.spdT < 20000; },
  get dbLive(){ return this.db != null && Date.now() - this.dbT < 3000; },
  get posLive(){ return this.pos != null && Date.now() - this.posT < 15000; },
  _acc(v){ this.acc = v; this.accT = Date.now(); },
  _gps(o){
    if (o && o.spd != null && o.spd >= 0) { this.spd = o.spd; this.spdAcc = o.acc; this.spdT = Date.now(); }
    if (o && o.la != null && o.lo != null) {
      const t = Date.now();
      // une position réseau imprécise ne remplace pas une position GPS récente plus précise
      if (this.pos && t - this.posT < 4000 && o.acc > this.pos.acc * 2) return;
      this.pos = { la: +o.la, lo: +o.lo, acc: +o.acc || 30 }; this.posT = t;
      if (this.onPos) try { this.onPos(this.pos); } catch (e) { console.warn(e); }
    }
  },
  _db(v){ this.db = v; this.dbT = Date.now(); },
  baro: null, baroT: 0,                                   // pression (hPa), Keep Pose « squat »
  _baro(v){ this.baro = this.baro == null ? v : this.baro * 0.7 + v * 0.3; this.baroT = Date.now(); },
  get baroLive(){ return this.baro != null && Date.now() - this.baroT < 3000; },

  async start(opts){
    this.running = true;
    if (this.native) { nativeCall("sensorsStart", JSON.stringify(opts)); return; }
    await this._webStart(opts);
  },
  /* Service sans capteur : garde l'application éveillée écran verrouillé (liaison partenaire) */
  keepAlive(){ if (this.native && !this.running) nativeCall("sensorsStart", JSON.stringify({ accel: false, gps: false, mic: false })); },
  stop(){
    this.running = false;
    if (this.native) {
      if (typeof Partner !== "undefined" && Partner.cfg.enabled) this.keepAlive();   // le partenaire garde la liaison
      else nativeCall("sensorsStop");
      return;
    }
    const w = this._web; if (!w) return;
    if (w.motion) window.removeEventListener("devicemotion", w.motion);
    if (w.geo != null) navigator.geolocation.clearWatch(w.geo);
    if (w.stream) w.stream.getTracks().forEach(t => t.stop());
    if (w.ctx) w.ctx.close().catch(() => {});
    clearInterval(w.timer); this._web = null;
  },

  /* Version navigateur (fonctionne seulement écran allumé, application au premier plan) */
  async _webStart({ gps, mic, accel, pos }){
    this.stop(); this.running = true;
    const w = this._web = { sum: 0, n: 0, grav: null, last: null };
    if (accel && typeof DeviceMotionEvent !== "undefined") {
      try { if (typeof DeviceMotionEvent.requestPermission === "function") await DeviceMotionEvent.requestPermission(); } catch {}
      w.motion = e => {
        let la = e.acceleration && e.acceleration.x != null ? [e.acceleration.x, e.acceleration.y, e.acceleration.z] : null;
        const ig = e.accelerationIncludingGravity;
        if (!la && ig && ig.x != null) {
          const v = [ig.x, ig.y, ig.z];
          w.grav = w.grav ? w.grav.map((g, i) => 0.92 * g + 0.08 * v[i]) : v;
          la = v.map((x, i) => x - w.grav[i]);
        }
        if (la) { w.sum += la[0] ** 2 + la[1] ** 2 + la[2] ** 2; w.n++; }
      };
      window.addEventListener("devicemotion", w.motion);
    }
    if (gps && navigator.geolocation) {
      w.geo = navigator.geolocation.watchPosition(p => {
        let spd = p.coords.speed;
        if ((spd == null || isNaN(spd)) && w.last) {
          const dt = (p.timestamp - w.last.t) / 1000;
          if (dt > 0.5) spd = haversine(w.last.la, w.last.lo, p.coords.latitude, p.coords.longitude) / dt;
        }
        w.last = { la: p.coords.latitude, lo: p.coords.longitude, t: p.timestamp };
        if (pos) this._gps({ spd: spd != null && !isNaN(spd) ? spd : -1, acc: p.coords.accuracy, la: p.coords.latitude, lo: p.coords.longitude });
        else if (spd != null && !isNaN(spd)) this._gps({ spd, acc: p.coords.accuracy });
      }, e => log("GPS : " + e.message), { enableHighAccuracy: true, maximumAge: pos ? 1000 : 2000 });
    }
    if (mic && navigator.mediaDevices) {
      try {
        w.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        w.ctx = new (window.AudioContext || window.webkitAudioContext)();
        w.an = w.ctx.createAnalyser(); w.an.fftSize = 2048; w.buf = new Float32Array(w.an.fftSize);
        w.ctx.createMediaStreamSource(w.stream).connect(w.an);
      } catch (e) { log("Micro : " + e.message); }
    }
    w.timer = setInterval(() => {
      if (w.n) { this._acc(Math.sqrt(w.sum / w.n)); w.sum = 0; w.n = 0; }
      if (w.an) { w.an.getFloatTimeDomainData(w.buf); let s = 0; for (const x of w.buf) s += x * x; this._db(20 * Math.log10(Math.sqrt(s / w.buf.length) + 1e-9)); }
    }, 500);
  }
};
function haversine(a1, o1, a2, o2){
  const R = 6371000, r = Math.PI / 180, da = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(da / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
onNative("acc", v => Sensors._acc(+v));
onNative("gps", v => { try { Sensors._gps(JSON.parse(v)); } catch {} });
onNative("db", v => Sensors._db(+v));
onNative("baro", v => Sensors._baro(+v));
onNative("svc", v => log("Capteurs : " + v));

/* ---------------------------------------------------------------------
 * Motifs de vibration (0–1) : t = progression 0–1, s = secondes, d = durée
 * ------------------------------------------------------------------- */
const env = (s, dur) => clamp(Math.min(s / 0.8, (dur - s) / 0.8), 0, 1);
const PATTERNS = {
  vague:      { soft: true,  label: "Vague",      f: (t, s, d) => Math.sin(Math.PI * t) ** 2 },
  houle:      { soft: true,  label: "Houle",      f: (t, s, d) => env(s, d) * (0.65 + 0.35 * Math.sin(2 * Math.PI * s / 2.5)) },
  doux:       { soft: true,  label: "Constant",   f: (t, s, d) => env(s, d) },
  pulsations: { soft: false, label: "Pulsations", f: (t, s, d) => (s % 1.2) < 0.6 ? 1 : 0.2 },
  battement:  { soft: false, label: "Battement",  f: (t, s, d) => { const p = s % 1.4; return p < 0.15 || (p > 0.3 && p < 0.45) ? 1 : 0.15; } },
};

/* ---------------------------------------------------------------------
 * Client MQTT 3.1.1 minimal sur WebSocket (QoS 0)
 * ------------------------------------------------------------------- */
const te = new TextEncoder(), td = new TextDecoder();
const mqStr = s => { const b = te.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
function mqPacket(type, body){
  const hdr = [type]; let x = body.length;
  do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; hdr.push(d); } while (x > 0);
  const out = new Uint8Array(hdr.length + body.length); out.set(hdr); out.set(body, hdr.length); return out;
}
class MqttWs {
  constructor(url){ this.url = url; this.ws = null; this.subs = []; this.buf = new Uint8Array(0); this.pid = 1; this.want = false; this.ok = false; this.retry = 1000;
    this.onMessage = () => {}; this.onState = () => {}; }
  start(){
    this.want = true; this._open();
    clearInterval(this.watch); this.watch = setInterval(() => this.maintain(), 5000);
    this._wake = () => { this.retry = 1000; this.nextRetry = 0; this.maintain(); };
    window.addEventListener("online", this._wake);
    document.addEventListener("visibilitychange", this._wake);
  }
  stop(){
    this.want = false; this.ok = false; clearInterval(this.ping); clearInterval(this.watch); clearTimeout(this.rt);
    if (this._wake) { window.removeEventListener("online", this._wake); document.removeEventListener("visibilitychange", this._wake); }
    const ws = this.ws; this.ws = null; try { ws && ws.close(); } catch {}
  }
  /* Surveillance : relance si la connexion est morte (réseau mobile, changement Wi-Fi/4G…) */
  maintain(){
    if (!this.want) return;
    const now = Date.now(), ws = this.ws;
    if (this.ok) {
      this.pingIfDue();
      if (now - this.lastIn > 50000) { this.onState("relais muet, reconnexion…"); this._drop(); }
    } else if (ws && ws.readyState !== WebSocket.CLOSED) {
      if (now - this.openedAt > 12000) this._drop();          // connexion bloquée
    } else if (now >= (this.nextRetry || 0)) this._open();
  }
  _drop(){
    const ws = this.ws; this.ws = null; this.ok = false; clearInterval(this.ping);
    try { ws && ws.close(); } catch {}
    this.nextRetry = Date.now() + 500; clearTimeout(this.rt); this.rt = setTimeout(() => this.maintain(), 600);
  }
  subscribe(topic){ if (!this.subs.includes(topic)) this.subs.push(topic); if (this.ok) this._sub(topic); }
  publish(topic, payload){ if (!this.ok) return false; this.ws.send(mqPacket(0x30, [...mqStr(topic), ...payload])); return true; }
  _open(){
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;   // déjà en cours
    this.onState("connexion…");
    let ws; try { ws = new WebSocket(this.url, ["mqtt"]); } catch (e) { this.onState("adresse invalide"); return; }
    this.ws = ws; ws.binaryType = "arraybuffer";
    this.buf = new Uint8Array(0);            // ne jamais réutiliser des restes de l'ancienne connexion
    this.openedAt = Date.now(); this.lastIn = Date.now();
    ws.onopen = () => {
      const cid = "bpc" + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
      ws.send(mqPacket(0x10, [...mqStr("MQTT"), 4, 0x02, 0, 120, ...mqStr(cid)]));   // keepalive 120 s
    };
    ws.onmessage = e => this._data(new Uint8Array(e.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ok = false; clearInterval(this.ping); this.ws = null;
      if (this.want) {
        this.onState("relais perdu, reconnexion…");
        this.nextRetry = Date.now() + this.retry;
        clearTimeout(this.rt); this.rt = setTimeout(() => this.maintain(), this.retry);
        this.retry = Math.min(10000, this.retry * 2);
      } else this.onState("déconnecté");
    };
    ws.onerror = () => {};
  }
  pingIfDue(){
    if (this.ok && Date.now() - this.lastPing > 20000) { this.lastPing = Date.now(); try { this.ws.send(new Uint8Array([0xC0, 0])); } catch {} }
  }
  _sub(topic){ const p = this.pid++ & 0xffff || 1; this.ws.send(mqPacket(0x82, [p >> 8, p & 255, ...mqStr(topic), 0])); }
  _data(chunk){
    this.lastIn = Date.now();
    const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length); this.buf = b;
    for (;;) {
      const B = this.buf; if (B.length < 2) return;
      let len = 0, mul = 1, i = 1, d;
      do { if (i >= B.length) return; d = B[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
      if (B.length < i + len) return;
      const type = B[0] >> 4, flags = B[0] & 15, body = B.subarray(i, i + len);
      this.buf = B.slice(i + len);
      if (type === 2) {                       // CONNACK
        if (body[1] !== 0) { this.onState("refus du relais (" + body[1] + ")"); continue; }
        this.ok = true; this.retry = 1000; this.onState("connecté");
        this.subs.forEach(t => this._sub(t));
        this.lastPing = Date.now();
        this.ping = setInterval(() => this.pingIfDue(), 20000);
      } else if (type === 3) {                // PUBLISH
        const tl = (body[0] << 8) | body[1], topic = td.decode(body.subarray(2, 2 + tl));
        const qos = (flags >> 1) & 3, start = 2 + tl + (qos ? 2 : 0);
        this.onMessage(topic, body.slice(start));
      }
    }
  }
}

/* ---------------------------------------------------------------------
 * Code d'appairage : 16 octets de clé + 8 octets de salon, en base32
 * ------------------------------------------------------------------- */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function b32enc(bytes){
  let bits = 0, val = 0, out = "";
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } val &= (1 << bits) - 1; }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out.match(/.{1,4}/g).join("-");
}
function b32dec(str){
  const s = str.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
  let bits = 0, val = 0; const out = [];
  for (const ch of s) { const v = B32.indexOf(ch); if (v < 0) throw new Error("caractère invalide : " + ch); val = (val << 5) | v; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } val &= (1 << bits) - 1; }
  return new Uint8Array(out);
}
const BROKERS = { emqx: "wss://broker.emqx.io:8084/mqtt", hivemq: "wss://broker.hivemq.com:8884/mqtt" };
/* Développement : relais local de test (localStorage « bpBrokerTest ») */
try { const dev = localStorage.getItem("bpBrokerTest"); if (dev) { BROKERS.emqx = dev; BROKERS.hivemq = dev; } } catch {}

/* ---------------------------------------------------------------------
 * Liaison chiffrée entre porteur (w) et télécommande (r)
 * ------------------------------------------------------------------- */
const Link = {
  mq: null, key: null, room: null, role: null, sid: null, seq: 0, lastSeq: {}, lastRx: 0,
  _txq: Promise.resolve(), _rxq: Promise.resolve(),   // files d'attente : l'ordre des messages est conservé
  onMsg: () => {}, onStatus: () => {},
  newCode(){ return b32enc(crypto.getRandomValues(new Uint8Array(24))); },
  fingerprint(code){ const b = b32dec(code); return b32enc(b.slice(16, 19)).slice(0, 4); },
  get peerLive(){ return Date.now() - this.lastRx < 10000; },   // l'autre téléphone envoie un signe de vie toutes les 2 s
  async start(code, role, brokerUrl){
    this.stop();
    if (!window.crypto || !crypto.subtle) throw new Error("Chiffrement indisponible (contexte non sécurisé).");
    const b = b32dec(code); if (b.length < 24) throw new Error("Code d'appairage incomplet.");
    this.key = await crypto.subtle.importKey("raw", b.slice(0, 16), "AES-GCM", false, ["encrypt", "decrypt"]);
    this.room = Array.from(b.slice(16, 24), x => x.toString(16).padStart(2, "0")).join("");
    this.role = role; this.sid = Array.from(crypto.getRandomValues(new Uint8Array(4)), x => x.toString(16)).join(""); this.seq = 0; this.lastSeq = {};
    this.txTopic = `bpctl/v1/${this.room}/${role}`; this.rxTopic = `bpctl/v1/${this.room}/${role === "w" ? "r" : "w"}`;
    this.mq = new MqttWs(brokerUrl);
    this.mq.onState = s => this.onStatus(s);
    this.mq.onMessage = (t, p) => { if (t === this.rxTopic) this._rxq = this._rxq.then(() => this._rx(p)).catch(() => {}); };
    this.mq.subscribe(this.rxTopic);
    this.mq.start();
  },
  stop(){ if (this.mq) this.mq.stop(); this.mq = null; this.key = null; this.lastRx = 0; },
  send(obj){
    const p = this._txq.then(() => this._send(obj)).catch(() => false);
    this._txq = p; return p;
  },
  async _send(obj){
    if (!this.mq || !this.key) return false;
    const msg = te.encode(JSON.stringify({ ...obj, sid: this.sid, seq: ++this.seq, ts: Date.now() }));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(this.txTopic) }, this.key, msg));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return this.mq.publish(this.txTopic, out);
  },
  async _rx(p){
    if (p.length < 30 || !this.key) return;
    let obj;
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: p.slice(0, 12), additionalData: te.encode(this.rxTopic) }, this.key, p.slice(12));
      obj = JSON.parse(td.decode(pt));
    } catch { return; }                                        // mauvais code ou message étranger : ignoré
    if (Math.abs(Date.now() - obj.ts) > 600000) return;        // trop vieux (rejeu) ; tolère des horloges décalées
    if (obj.seq <= (this.lastSeq[obj.sid] || 0)) return;       // déjà reçu (rejeu)
    this.lastSeq[obj.sid] = obj.seq; this.lastRx = Date.now();
    this.onMsg(obj);
  }
};
