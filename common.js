/* ======================================================================
 * Couche commune : client Buttplug, rôles des actionneurs, sorties,
 * capteurs (caméra, gyroscope/accéléromètre, cardio BLE), sécurité.
 * Fonctionne dans l'APK (WebView + pont natif « AndroidBridge »)
 * comme dans Chrome (Web Bluetooth).
 * ====================================================================== */
"use strict";

/* Registre des applications : nom, page, icône (menu, télécommande, partenaire). Une nouvelle appli s'ajoute ici. */
const MODE_PAGES = { menu: "index.html", motion: "motion.html", deep: "deep.html", denial: "denial.html", public: "public.html", ahegao: "ahegao.html", seek: "seek.html", making: "making.html", tribute: "tribute.html", eyes: "eyes.html", deck: "deck.html", mind: "mind.html" };
const MODE_NAMES = { menu: "Menu", motion: "Keep Pose", deep: "Blow Trainer", denial: "Denial Control", public: "Public Play", ahegao: "Ahegao Detector", seek: "Vibe & Seek", making: "Making Pose", tribute: "Tribute", eyes: "Eye Contact", deck: "Obedience Deck", mind: "Mind Games", leash: "Invisible Leash", screen: "Digital Leash" };
const MODE_ICONS = { menu: "🏠", motion: "📍", deep: "💋", denial: "✋", public: "🚶", ahegao: "😵", seek: "🧭", making: "🧎", tribute: "🪙", eyes: "👁️", deck: "🃏", mind: "🧠", leash: "🦮", screen: "📵" };
/* Modes qui n'ont de sens qu'avec un Maître connecté : masqués en mode « Seul·e » */
const MASTER_ONLY = ["tribute", "deck"];
const CAREER_MODES = ["motion", "deep", "public", "ahegao", "seek", "making", "tribute", "eyes", "deck", "mind"];
const modeName = m => MODE_NAMES[m] || (m ? String(m) : "—");
const modeLabel = m => ((MODE_ICONS[m] || "📱") + " " + modeName(m)).trim();

const $ = id => document.getElementById(id);
const num = id => +$(id).value;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const NATIVE = typeof window.AndroidBridge !== "undefined";
function log(msg){
  const l = $("log"); if (!l) return console.log(msg);
  l.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`; l.scrollTop = l.scrollHeight;
}
/* ---------------------------------------------------------------------
 * Profils : chaque profil a ses propres données (carrière, réglages,
 * équipement, Maîtres appairés…). Le 1er profil garde les clés d'origine
 * (compatibilité), les autres sont préfixés « pf:<id>: ».
 * Clés communes à tous les profils : la liste des profils et les mises à jour.
 * ------------------------------------------------------------------- */
const isGlobalKey = k => k === "bpProfiles" || k.startsWith("bpUpd") || k === "bpBrokerTest";
const Profiles = {
  raw: (() => { try { const r = JSON.parse(localStorage.getItem("bpProfiles")); if (r && r.list && r.list.length) return r; } catch {} return { list: [{ id: "p0", name: "Moi" }], active: "p0" }; })(),
  get list(){ return this.raw.list; },
  get cur(){ return this.raw.list.find(p => p.id === this.raw.active) || this.raw.list[0]; },
  prefix(id){ return id === "p0" ? "" : "pf:" + id + ":"; },
  save(){ try { localStorage.setItem("bpProfiles", JSON.stringify(this.raw)); } catch {} },
  /* clés (sans préfixe) appartenant au profil id */
  keys(id = this.cur.id){
    const pre = this.prefix(id), out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (isGlobalKey(k)) continue;
      if (pre) { if (k.startsWith(pre)) out.push(k.slice(pre.length)); } else if (!k.startsWith("pf:")) out.push(k);
    }
    return out;
  },
  get unlocked(){ const c = this.cur; return !c.pin || sessionStorage.getItem("bpUnlocked") === c.id; },
  hash(id, pin){ let h = 0x811c9dc5; for (const ch of "bplaysure:" + id + ":" + pin) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); },
  unlock(pin){ const c = this.cur; if (!c.pin || this.hash(c.id, pin) === c.pin) { sessionStorage.setItem("bpUnlocked", c.id); return true; } return false; },
  add(name){ const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); this.raw.list.push({ id, name: String(name).slice(0, 30) || "Profil" }); this.save(); return id; },
  switchTo(id){ if (!this.raw.list.some(p => p.id === id)) return; this.raw.active = id; this.save(); sessionStorage.removeItem("bpUnlocked"); },
  remove(id){
    if (this.raw.list.length < 2) return false;
    const pre = this.prefix(id); this.keys(id).forEach(k => localStorage.removeItem(pre + k));
    this.raw.list = this.raw.list.filter(p => p.id !== id);
    if (this.raw.active === id) this.raw.active = this.raw.list[0].id;
    this.save(); return true;
  },
  /* sauvegarde complète du profil actuel (fichier JSON) */
  exportData(){
    const pre = this.prefix(this.cur.id), data = {};
    this.keys().forEach(k => { const v = localStorage.getItem(pre + k); if (v != null) data[k] = v; });
    return { app: "BPlaysure", kind: "profile", v: 1, name: this.cur.name, exportedAt: new Date().toISOString(), data };
  },
  /* import dans un NOUVEAU profil (rien n'est écrasé) ; renvoie son id */
  importData(o){
    if (!o || o.app !== "BPlaysure" || o.kind !== "profile" || typeof o.data !== "object") throw new Error("ce fichier n'est pas une sauvegarde BPlaysure");
    let name = String(o.name || "Profil importé").slice(0, 26);
    while (this.raw.list.some(p => p.name === name)) name += " (2)";
    const id = this.add(name), pre = this.prefix(id);
    for (const [k, v] of Object.entries(o.data)) if (typeof v === "string" && !isGlobalKey(k) && !k.startsWith("pf:")) localStorage.setItem(pre + k, v);
    return id;
  },
};
const sk = k => isGlobalKey(k) ? k : Profiles.prefix(Profiles.raw.active) + k;
const store = {
  get(k, d){ try { const v = localStorage.getItem(sk(k)); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem(sk(k), JSON.stringify(v)); return true; } catch { return false; } },
  del(k){ try { localStorage.removeItem(sk(k)); } catch {} }
};
/* profil verrouillé par PIN : seules les pages d'accueil peuvent s'ouvrir */
const IS_MENU = /(^|\/)(index\.html)?$/.test(location.pathname);
if (!IS_MENU && !Profiles.unlocked) location.replace("index.html");

/* ---------------------------------------------------------------------
 * Équipement choisi dans le menu (masque les réglages inutiles)
 *   vib : jouet vibrant · stim : électrostimulation · hr : ceinture cardio
 *   cam : caméra · gyro : gyroscope/accéléromètre du téléphone
 * ------------------------------------------------------------------- */
/* ordinateur (navigateur sans écran tactile) : pas de gyroscope par défaut */
const IS_DESKTOP = !NATIVE && typeof matchMedia === "function" && !matchMedia("(pointer: coarse)").matches;
const EQUIP_DEFAULT = { vib: true, stim: false, hr: false, cam: true, gyro: !IS_DESKTOP };
const Equip = { ...EQUIP_DEFAULT, ...store.get("bpEquip", {}) };
const EQUIP_LABELS = { vib: "Jouet vibrant", stim: "E-stim", hr: "Ceinture cardio", cam: "Caméra", gyro: "Gyroscope" };
/* data-need="a,b" : tous requis · data-any="a b" : au moins un */
function applyEquip(root = document){
  root.querySelectorAll("[data-need],[data-any]").forEach(el => {
    const all = (el.dataset.need || "").split(",").filter(Boolean).every(k => Equip[k]);
    const any = el.dataset.any ? el.dataset.any.split(" ").some(k => Equip[k]) : true;
    const show = all && any;
    if (el.tagName === "OPTION") { el.hidden = !show; el.disabled = !show; }
    else el.classList.toggle("hidden", !show);
  });
  root.querySelectorAll("select").forEach(s => {
    const o = s.options[s.selectedIndex];
    if (o && o.disabled) { const first = [...s.options].find(x => !x.disabled); if (first) { s.value = first.value; s.dispatchEvent(new Event("change")); } }
  });
  const eq = $("equipLine");
  if (eq) eq.textContent = Object.keys(EQUIP_LABELS).filter(k => Equip[k]).map(k => EQUIP_LABELS[k]).join(" · ") || "aucun";
}
/* Mémorise les volets ouverts/fermés */
function persistDetails(page){
  document.querySelectorAll("details.card[id]").forEach(d => {
    const k = "open:" + page + ":" + d.id, v = store.get(k, null);
    if (v !== null) d.open = v;
    d.addEventListener("toggle", () => store.set(k, d.open));
  });
}

/* ---------------------------------------------------------------------
 * Client Buttplug minimal (spec v3), WebSocket brut
 * ------------------------------------------------------------------- */
class ButtplugClient {
  constructor(name){ this.name = name; this.ws = null; this.nextId = 1; this.pending = new Map(); this.devices = new Map(); this.pingTimer = null; this.onChange = () => {}; this.onClose = () => {}; }
  get connected(){ return !!this.ws && this.ws.readyState === WebSocket.OPEN; }
  connect(url){
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return reject(e); }
      this.ws = ws;
      ws.onmessage = e => { try { JSON.parse(e.data).forEach(m => this._handle(m)); } catch (err) { log("Message illisible : " + err.message); } };
      ws.onerror = () => reject(new Error("Connexion impossible à " + url + " (Intiface est-il lancé, serveur démarré ?)"));
      ws.onclose = () => {
        clearInterval(this.pingTimer); this.devices.clear(); Out.reset();
        reject(new Error("Intiface a fermé la connexion"));
        // une tentative qui échoue n'est pas une « connexion perdue » : seule une connexion établie le signale
        if (this.ws === ws) { this.onChange(); if (ws._opened) this.onClose(); }
      };
      ws.onopen = async () => {
        ws._opened = true;
        try {
          const info = (await this.send("RequestServerInfo", { ClientName: this.name, MessageVersion: 3 })).ServerInfo;
          this.maxPing = info.MaxPingTime || 0; this.lastPing = Date.now();
          if (info.MaxPingTime > 0) this.pingTimer = setInterval(() => this.pingIfDue(true), Math.max(200, info.MaxPingTime / 2));
          const list = await this.send("RequestDeviceList", {});
          list.DeviceList.Devices.forEach(d => this._add(d));
          resolve(info);
        } catch (err) { reject(err); }
      };
    });
  }
  send(type, body){
    if (!this.connected) return Promise.reject(new Error("Non connecté"));
    const Id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(Id, { resolve, reject });
      this.ws.send(JSON.stringify([{ [type]: { ...body, Id } }]));
      setTimeout(() => { if (this.pending.delete(Id)) reject(new Error(type + " : pas de réponse")); }, 5000);
    });
  }
  _handle(msg){
    const type = Object.keys(msg)[0], body = msg[type];
    if (body.Id && this.pending.has(body.Id)) {
      const p = this.pending.get(body.Id); this.pending.delete(body.Id);
      type === "Error" ? p.reject(new Error(body.ErrorMessage)) : p.resolve(msg);
      return;
    }
    if (type === "DeviceAdded") this._add(body);
    else if (type === "DeviceRemoved") { this.devices.delete(body.DeviceIndex); log("Appareil retiré #" + body.DeviceIndex); this.onChange(); }
    else if (type === "ScanningFinished") log("Scan terminé.");
    else if (type === "Error") log("Erreur serveur : " + body.ErrorMessage);
  }
  _add(d){
    const scal = (d.DeviceMessages && d.DeviceMessages.ScalarCmd) || [];
    const actuators = scal.map((a, i) => ({ index: i, type: a.ActuatorType, desc: a.FeatureDescriptor || "", steps: a.StepCount || 20 }));
    this.devices.set(d.DeviceIndex, { index: d.DeviceIndex, name: d.DeviceDisplayName || d.DeviceName, actuators });
    log(`Appareil ajouté : ${d.DeviceName} (${actuators.length} actionneur(s))`);
    this.onChange();
  }
  /* Ping Intiface (aussi appelé par le réveil natif quand l'écran est éteint) */
  pingIfDue(force = false){
    if (!this.connected || !this.maxPing) return;
    if (force || Date.now() - this.lastPing > this.maxPing / 2) { this.lastPing = Date.now(); this.send("Ping", {}).catch(() => {}); }
  }
  scalar(deviceIndex, scalars){ return this.send("ScalarCmd", { DeviceIndex: deviceIndex, Scalars: scalars }); }
  stopAll(){ Out.allStopped(); return this.send("StopAllDevices", {}); }
}

/* ---------------------------------------------------------------------
 * File d'envoi vers les jouets (stabilité Bluetooth / Intiface)
 *  - une seule commande en cours par appareil (on attend la réponse)
 *  - au moins 200 ms entre deux commandes ; seule la dernière valeur compte
 *  - rien n'est envoyé si le cran réel du moteur ne change pas
 *  - un arrêt (0) passe en priorité
 * ------------------------------------------------------------------- */
const Out = {
  q: new Map(), GAP: 200, errAt: 0, count: 0,
  _dev(di){ let d = this.q.get(di); if (!d) { d = { want: new Map(), sent: new Map(), busy: false, last: 0, timer: null }; this.q.set(di, d); } return d; },
  set(di, ai, v, type){ this._dev(di).want.set(ai, { v, type }); this.flush(di); },
  reset(){ for (const d of this.q.values()) clearTimeout(d.timer); this.q.clear(); },
  allStopped(){ for (const d of this.q.values()) { for (const [ai, w] of d.want) { w.v = 0; d.sent.set(ai, 0); } } },
  flush(di){
    const d = this.q.get(di), bp = App.bp; if (!d || !bp || !bp.connected) return;
    const changed = [...d.want].filter(([ai, w]) => d.sent.get(ai) !== w.v);
    if (!changed.length) return;
    const stopping = changed.every(([, w]) => w.v === 0), now = Date.now();
    if (d.busy && !(stopping && now - d.last > 800)) return;     // un arrêt ne reste jamais bloqué plus de 0,8 s
    const wait = d.last + this.GAP - now;
    if (wait > 0 && !stopping) { if (!d.timer) d.timer = setTimeout(() => { d.timer = null; this.flush(di); }, wait); return; }
    d.busy = true; d.last = now; this.count++;
    const scalars = changed.map(([ai, w]) => ({ Index: ai, Scalar: w.v, ActuatorType: w.type }));
    bp.scalar(di, scalars).then(
      () => changed.forEach(([ai, w]) => d.sent.set(ai, w.v)),
      e => { changed.forEach(([ai]) => d.sent.delete(ai)); d.last = Date.now() + 500; this.err(e); }
    ).finally(() => { d.busy = false; this.flush(di); });
  },
  err(e){ if (Date.now() - this.errAt > 5000) { this.errAt = Date.now(); log("⚠ Envoi au jouet échoué : " + e.message); } }
};

/* ---------------------------------------------------------------------
 * Application : état partagé, rôles, sorties, coque d'interface
 * ------------------------------------------------------------------- */
const App = {
  bp: null,
  roles: {},             // "devIndex:actIndex" -> { role: none|vib|stim, max }
  armed: false,
  cap: { vib: () => 100, stim: () => 0 },
  last: { vib: -1, stim: -1 },
  emergencyStop: () => {},
  allowBackground: false,  // true : la session continue écran éteint (mode Sortie, Denial sans caméra)
  suspended: false,        // écran verrouillé avec liaison partenaire : programme auto en pause, télécommande active
  onDisconnect: () => {},
  wakeLock: null,
};

/* Rôles mémorisés par nom d'appareil (partagés entre les 3 modes) */
const ROLE_KEY = "bpRoles";
function roleMemKey(dev, act){ return dev.name + "#" + act.index + "#" + act.type; }

function renderDevices(labels){
  const box = $("devices"); if (!box) return;
  const bp = App.bp;
  if (!bp.devices.size) { box.innerHTML = '<p class="muted">Aucun appareil.</p>'; return; }
  const mem = store.get(ROLE_KEY, {});
  box.innerHTML = "";
  for (const d of bp.devices.values()) {
    const el = document.createElement("div"); el.className = "dev";
    const title = document.createElement("b"); title.textContent = d.name + " "; const idx = document.createElement("span"); idx.className = "muted"; idx.textContent = "#" + d.index; title.appendChild(idx); el.appendChild(title);
    if (!d.actuators.length) { const s = document.createElement("span"); s.className = "muted"; s.textContent = "Pas d'actionneur scalaire (non pilotable ici)."; el.appendChild(s); }
    d.actuators.forEach(a => {
      const key = d.index + ":" + a.index, mk = roleMemKey(d, a);
      if (!App.roles[key]) App.roles[key] = mem[mk] ? { ...mem[mk] } : { role: a.type === "Vibrate" ? "vib" : "none", max: 100 };
      const r = App.roles[key];
      const line = document.createElement("label");
      const name = document.createElement("span"); name.textContent = `${a.type}${a.desc ? " · " + a.desc : ""} [${a.index}]`;
      const ctl = document.createElement("span");
      ctl.innerHTML = `<select class="roleSel"><option value="none">Ignorer</option>${Equip.vib ? `<option value="vib">${labels.vib}</option>` : ""}${Equip.stim && labels.stim ? `<option value="stim">${labels.stim}</option>` : ""}</select> max <input type="number" min="0" max="100" class="maxIn" style="width:70px">%`;
      const sel = ctl.querySelector("select"), mx = ctl.querySelector("input");
      sel.value = [...sel.options].some(o => o.value === r.role) ? r.role : "none"; mx.value = r.max;
      sel.onchange = () => { r.role = sel.value; saveRole(mk, r); sendLevel("vib", 0, true); sendLevel("stim", 0, true); log(`Actionneur ${d.name} [${a.index}] → ${sel.value}`); };
      mx.onchange = () => { r.max = clamp(+mx.value, 0, 100); mx.value = r.max; saveRole(mk, r); };
      line.appendChild(name); line.appendChild(ctl); el.appendChild(line);
    });
    box.appendChild(el);
  }
}
function saveRole(mk, r){ const mem = store.get(ROLE_KEY, {}); mem[mk] = { role: r.role, max: r.max }; store.set(ROLE_KEY, mem); }

/* Envoie un niveau (0–100) à tous les actionneurs d'un rôle, avec plafonds */
function sendLevel(role, pct, force = false, opts = {}){
  // Vibration imposée par le partenaire (télécommande)
  let fromMaster = !!opts.master, fromPartner = !!opts.partner;
  if (role === "vib" && typeof Partner !== "undefined") { const o = Partner.vibOverride(); if (o != null) { pct = o; fromMaster = Partner.ms; fromPartner = true; } }
  if (App.suspended && !fromPartner) pct = 0;     // écran verrouillé : seul le partenaire pilote
  // Mode Master/Sub : le plafond du mode ne s'applique pas aux commandes du partenaire
  // (le « max % » de chaque appareil, réglé dans Appareils, reste toujours appliqué)
  const cap = fromMaster ? 100 : App.cap[role]();
  pct = App.armed ? clamp(pct, 0, clamp(cap, 0, 100)) : 0;
  if (!force && Math.abs(pct - App.last[role]) < 1) return pct;
  App.last[role] = pct;
  const bp = App.bp;
  if (!bp || !bp.connected) return pct;
  if (!Equip[role]) return 0;   // équipement non sélectionné : jamais d'envoi
  for (const [key, r] of Object.entries(App.roles)) {
    if (r.role !== role) continue;
    const [di, ai] = key.split(":").map(Number);
    const dev = bp.devices.get(di); if (!dev || !dev.actuators[ai]) continue;
    const act = dev.actuators[ai], steps = act.steps || 20, v = clamp(pct * r.max / 10000, 0, 1);
    // stim : arrondi vers le bas (jamais au-dessus du plafond) ; vibration : au plus proche
    const q = (role === "stim" ? Math.floor(v * steps + 1e-9) : Math.round(v * steps)) / steps;
    Out.set(di, ai, q, act.type);
  }
  return pct;
}

/* Écran toujours allumé pendant une session (l'APK le fait déjà nativement) */
async function keepAwake(on){
  try {
    if (on && !App.wakeLock && navigator.wakeLock) { App.wakeLock = await navigator.wakeLock.request("screen"); App.wakeLock.addEventListener("release", () => { App.wakeLock = null; }); }
    else if (!on && App.wakeLock) { await App.wakeLock.release(); App.wakeLock = null; }
  } catch {}
}

/* Volet « Appareils » injecté dans <details id="conn"> + câblage en-tête et barre d'actions */
/* ---------------------------------------------------------------------
 * HUD : le monitoring du haut résumé en petits widgets « verre »
 * (icône + chiffre + mini-courbe), construits automatiquement à partir
 * des jauges (.stat) et indicateurs (.kpis) de chaque appli.
 * Toucher le HUD (ou ▾) affiche le panneau complet.
 * Vue caméra plein écran : bouton ⛶ sur chaque caméra, HUD par-dessus.
 * ------------------------------------------------------------------- */
const HUD_ICONS = [[/vib/i, "〰️"], [/shock|stim/i, "⚡"], [/cœur|cardio|bpm|fc\b/i, "❤️"], [/profond/i, "📏"], [/maintien|tenue|temps|durée/i, "⏱️"],
  [/écart|ressembl|dérive/i, "🎯"], [/brusque|tremb/i, "💥"], [/regard/i, "👁️"], [/ahegao|score|crédit/i, "⭐"], [/distance|proche/i, "📍"], [/bruit|son/i, "🔊"], [/mouv|activ/i, "🏃"]];
const HUD_COLORS = { vibC: "var(--vib)", stimC: "var(--stim)", accC: "var(--acc)", warnC: "var(--warn)" };
const Hud = {
  items: [], el: null, name: "",
  init(name){
    const top = document.querySelector(".top"), hdr = top && top.querySelector("header"), dock = top && top.querySelector(".dock");
    if (!hdr || !dock || $("hud")) return;
    this.name = name; this.dock = dock;
    const h = document.createElement("div"); h.id = "hud"; this.el = h;
    h.innerHTML = `<div class="hudBan" id="hudBan"></div><div class="hudRow" id="hudRow"></div>`;
    top.insertBefore(h, dock);
    // bouton ▾ / ▴ : panneau complet
    const b = document.createElement("button"); b.id = "dockBtn"; b.className = "icon"; b.title = "Monitoring détaillé";
    hdr.insertBefore(b, $("connState"));
    const k = "dockFull:" + name;
    this.setFull = on => { document.body.classList.toggle("dockFull", on); b.textContent = on ? "▴" : "▾"; store.set(k, on); };
    b.onclick = () => this.setFull(!document.body.classList.contains("dockFull"));
    h.onclick = e => { if (!e.target.closest("button")) this.setFull(!document.body.classList.contains("dockFull")); };
    this.setFull(store.get(k, false));
    this.build(); this.tick(); setInterval(() => { this.tick(); this.armWatch(); }, 300);
    if ($("menuBtn")) { $("menuBtn").textContent = "‹"; $("menuBtn").classList.add("back"); }
    this.cams();
  },
  build(){
    const row = $("hudRow"); row.innerHTML = ""; this.items = [];
    this.dock.querySelectorAll(".stat").forEach(st => {
      const sp = st.querySelectorAll(":scope>span"), bar = st.querySelector(".meter>div");
      if (sp.length < 2 || !bar) return;
      const lab = sp[0].textContent.trim(), ic = (HUD_ICONS.find(([re]) => re.test(lab)) || [0, "•"])[1];
      const col = HUD_COLORS[[...bar.classList].find(c => HUD_COLORS[c])] || "var(--acc)";
      const w = document.createElement("div"); w.className = "hw"; w.style.setProperty("--c", col); w.title = lab;
      w.innerHTML = `<i>${ic}</i><span class="hv"></span><canvas width="120" height="36"></canvas>`;
      row.appendChild(w); this.items.push({ kind: "s", src: st, val: sp[sp.length - 1], bar, w, cv: w.querySelector("canvas"), hist: [], col });
    });
    this.dock.querySelectorAll(".kpis>div").forEach(d => {
      const b = d.querySelector("b"); if (!b) return;
      const lab = d.firstChild && d.firstChild.nodeType === 3 ? d.firstChild.textContent.trim() : "";
      const w = document.createElement("div"); w.className = "hw kp";
      w.innerHTML = `<span class="hv"></span><small>${lab.replace(/</g, "&lt;")}</small>`;
      row.appendChild(w); this.items.push({ kind: "k", src: d, val: b, w });
    });
    // rien à résumer : on garde le panneau complet
    document.body.classList.toggle("noHud", !this.items.length);
  },
  tick(){
    const ban = this.dock.querySelector(".banner"); $("hudBan").textContent = ban ? ban.textContent.trim() : "";
    for (const it of this.items) {
      const vis = !it.src.closest(".hidden") && getComputedStyle(it.src).display !== "none";
      it.w.classList.toggle("hidden", !vis); if (!vis) continue;
      it.w.querySelector(".hv").textContent = it.val.textContent.trim();
      if (it.kind !== "s") continue;
      const v = parseFloat(it.bar.style.width) || 0; it.hist.push(v); if (it.hist.length > 40) it.hist.shift();
      const c = it.cv.getContext("2d"), W = it.cv.width, H = it.cv.height, n = it.hist.length;
      c.clearRect(0, 0, W, H); if (n < 2) continue;
      const css = getComputedStyle(it.w).getPropertyValue("--c").trim(), col = css.startsWith("var(") ? getComputedStyle(document.documentElement).getPropertyValue(css.slice(4, -1)).trim() : css;
      c.beginPath(); it.hist.forEach((y, i) => { const X = i / 39 * W, Y = H - 3 - y / 100 * (H - 6); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
      c.strokeStyle = col || "#ff3d9a"; c.lineWidth = 2.5; c.lineJoin = "round"; c.stroke();
      c.lineTo((n - 1) / 39 * W, H); c.lineTo(0, H); c.closePath(); c.globalAlpha = .18; c.fillStyle = col || "#ff3d9a"; c.fill(); c.globalAlpha = 1;
    }
  },
  /* vue caméra plein écran (la vidéo garde ses proportions : les dessins de l'IA restent alignés) */
  cams(){
    if ($("camViewBtn")) return;   // Eye Contact a sa propre vue caméra
    document.querySelectorAll(".camWrap").forEach(w => {
      const b = document.createElement("button"); b.className = "camMaxBtn"; b.title = "Plein écran"; b.textContent = "⛶";
      b.onclick = e => { e.stopPropagation(); this.camMax(w, !w.classList.contains("max")); };
      w.appendChild(b);
    });
    window.addEventListener("resize", () => { const w = document.querySelector(".camWrap.max"); if (w) this.fit(w); });
  },
  fit(w){
    const v = w.querySelector("video"), ar = v && v.videoWidth ? v.videoWidth / v.videoHeight : 4 / 3, W = innerWidth, H = innerHeight;
    const ww = Math.min(W, H * ar), hh = ww / ar;
    Object.assign(w.style, { width: ww + "px", height: hh + "px", left: (W - ww) / 2 + "px", top: (H - hh) / 2 + "px" });
  },
  /* boutons utiles repris dans la vue plein écran (ils déclenchent les vrais boutons de l'appli) */
  CAM_ACTIONS: { deep: ["cal0", "cal1"], motion: ["recBtn"] },
  camActs(on){
    let bar = $("camActs");
    if (!on) { if (bar) bar.remove(); clearInterval(this._actT); return; }
    const key = typeof AppTabs !== "undefined" && AppTabs.key, ids = (this.CAM_ACTIONS[key] || []).filter(id => $(id));
    if (!ids.length) return;
    if (!bar) { bar = document.createElement("div"); bar.id = "camActs"; document.body.appendChild(bar); }
    bar.innerHTML = ""; const px = ids.map(id => { const b = document.createElement("button"); b.onclick = e => { e.stopPropagation(); $(id).click(); }; bar.appendChild(b); return [b, $(id)]; });
    const sync = () => px.forEach(([b, o]) => { b.textContent = o.textContent.trim(); b.disabled = o.disabled; b.className = o.className;
      b.classList.toggle("hidden", !!o.closest(".hidden, .awayHidden")); });
    sync(); clearInterval(this._actT); this._actT = setInterval(sync, 300);
  },
  camMax(w, on){
    this.camActs(on);
    const b = w._maxBtn || (w._maxBtn = w.querySelector(".camMaxBtn"));
    w.classList.toggle("max", on); document.body.classList.toggle("camMax", on);
    // le bouton ✕ sort du cadre caméra : sinon le bandeau du haut (au-dessus) captait le toucher
    b.textContent = on ? "✕" : "⛶"; b.title = on ? "Quitter le plein écran" : "Plein écran";
    b.classList.toggle("out", on); (on ? document.body : w).appendChild(b);
    if (on) { this.fit(w); nativeCall("immersive", true, false); }
    else { this.autoCam = false; ["width", "height", "left", "top"].forEach(k => w.style[k] = ""); nativeCall("immersive", false, false); }
  },
  /* à l'armement : caméra en plein écran si elle tourne ; au désarmement, on en sort */
  autoCam: false, wasArmed: false,
  armWatch(){
    const a = !!(typeof App !== "undefined" && App.armed);
    if (a === this.wasArmed) return; this.wasArmed = a;
    if (!store.get("camAutoMax", true)) return;
    const live = v => v && v.srcObject && v.offsetParent !== null && v.readyState >= 2;
    if (typeof window.camView === "function" && $("camViewBtn")) {   // Eye Contact
      const full = document.body.classList.contains("camFull");
      if (a && !full && live($("video"))) { camView(true); this.autoCam = true; }
      else if (!a && full && this.autoCam) { camView(false); this.autoCam = false; }
      return;
    }
    const cur = document.querySelector(".camWrap.max");
    if (a && !cur) {
      const w = [...document.querySelectorAll(".camWrap")].find(w => live(w.querySelector("video")));
      if (w && (w._maxBtn || w.querySelector(".camMaxBtn"))) { this.camMax(w, true); this.autoCam = true; }
    } else if (!a && cur && this.autoCam) this.camMax(cur, false);
  },
};

/* ---------------------------------------------------------------------
 * Onglets de chaque appli : 🎮 Jeu (l'écran de jeu, sans défiler),
 * ⚙️ Réglages (paramètres, Intiface, journal), 🏆 Carrière.
 * ------------------------------------------------------------------- */
/* description de chaque appli (reprise du menu), affichée dans ❓ Aide */
const APP_DESC = {"motion": "Enregistre une posture à tenir : tenue → vibration croissante, posture perdue → shock et temps de pénalité. Reconnaissance du squelette par la caméra.", "deep": "Profondeur mesurée (bouche suivie par l'IA, gode coloré ou repère), compteur de 100 %, guide de rythme, consignes vocales, séries et pauses respiration imposées. Aussi sur ton/ta partenaire.", "denial": "Montée progressive, détection de l'approche, edges, fin autorisée ou refusée.", "public": "Taquineries discrètes en public : montée lente, plafond anti-bruit, selon que tu marches, es assis·e ou en transport. Fonctionne écran éteint.", "seek": "Chasse au trésor GPS : dessine une zone sur la carte, un trésor y est caché, les vibrations te guident. Creuse au bon endroit avant d'épuiser tes jetons. Fonctionne écran éteint.", "making": "Une pose est annoncée (garde-à-vous, Nadu, à genoux, table…) : prends-la à temps et tiens-la. L'IA de la caméra juge la ressemblance : vibration si c'est bien, shock si tu t'en éloignes.", "tribute": "Garde le doigt sur l'écran pendant une série de shocks croissants pour gagner des crédits de plaisir. Ton Maître les dépense en vibrations… quand il le décide.", "eyes": "Regarde la caméra sans détourner les yeux : la vibration monte tant que le regard tient, un shock part dès que tu fuis ou fermes les yeux.", "deck": "Le Maître prépare des cartes cachées (immobilité, shocks, vagues, tease…). Un seul bouton : « Je me soumets ». Abandonner = pénalité de brat.", "mind": "Master Mind (vert, orange, rouge), Simon sous vibration, séquence dictée à l'oreille : chaque erreur se paie, chaque série est récompensée.", "ahegao": "L'IA de la caméra reconnaît ta tête d'ahegao : vibration tant que tu la fais, shock si tu ne la fais plus depuis trop longtemps."};
const PLAY_SECTIONS = { motion: ["secReport", "secDetect"], deep: ["secMeasure"], denial: ["secSensors"], public: ["secSensors"], seek: ["secResult", "secMap"],
  making: ["secCam"], tribute: ["secPlay"], eyes: ["secDetect"], deck: ["secPlay"], mind: ["secPlay"], ahegao: ["secDetect"] };
const AppTabs = {
  key: null, cur: "play", away: [],
  init(){
    const file = (location.pathname.split("/").pop() || "").toLowerCase();
    this.key = Object.keys(MODE_PAGES).find(k => MODE_PAGES[k] === file);
    const play = PLAY_SECTIONS[this.key], main = document.querySelector("main"), top = document.querySelector(".top");
    if (!play || !main || !top || $("appTabs")) { document.body.classList.add("fitted"); return; }
    [...main.children].forEach(el => { el.dataset.tab = play.includes(el.id) ? "play" : el.id === "secGame" ? "car" : "cfg"; });
    // les réglages rangés dans l'écran de jeu partent dans l'onglet Réglages (mêmes éléments, mêmes id)
    const moved = [], help = [];
    play.forEach(id => { const b = $(id) && ($(id).querySelector(":scope>.body") || $(id));
      if (!b) return;
      [...b.children].forEach(e => { if (e.matches(".keep")) return;
        if (e.matches("p.muted:not([id])")) help.push(e); else if (e.matches("label.f, #aiInfo, .toCfg")) moved.push(e); });
      b.querySelectorAll("label.f").forEach(e => { if (!moved.includes(e) && !e.closest("#selfShop, .camWrap, .keep, .toCfg") && !e.querySelector("button")) { e._home = e.parentElement; moved.push(e); this.away.push(e); } }); });
    if (moved.length) {
      const d = document.createElement("details"); d.className = "card"; d.id = "secPlayCfg"; d.open = true; d.dataset.tab = "cfg";
      d.innerHTML = `<summary>🎮 Réglages du jeu</summary><div class="body"></div>`;
      moved.forEach(e => d.lastChild.appendChild(e));
      const first = [...main.children].find(el => el.dataset.tab === "cfg");
      main.insertBefore(d, first || null);
    }
    // les descriptions de l'écran de jeu passent derrière un bouton ❓ Aide
    const sheet = document.createElement("div"); sheet.id = "helpSheet"; sheet.className = "hidden";
    sheet.innerHTML = `<div class="hsBox"><div class="hsHead"><b>❓ Aide · ${((document.querySelector(".top h1") || {}).firstChild || {}).textContent || "Comment jouer"}</b><button id="hsClose">✕</button></div><div class="hsBody"></div></div>`;
    if (APP_DESC[this.key]) { const p = document.createElement("p"); p.className = "hsIntro"; p.innerHTML = APP_DESC[this.key]; sheet.querySelector(".hsBody").appendChild(p); }
    help.forEach(e => sheet.querySelector(".hsBody").appendChild(e));
    document.body.appendChild(sheet);
    sheet.addEventListener("click", e => { if (e.target === sheet || e.target.id === "hsClose") sheet.classList.add("hidden"); });
    const hasCar = !!$("secGame");
    const bar = document.createElement("div"); bar.id = "appTabs";
    bar.innerHTML = `<button data-t="play">🎮 Jeu</button><button data-t="cfg">⚙️ Réglages</button>${hasCar ? `<button data-t="car">🏆 Carrière</button>` : ""}<button class="helpBtn" title="Aide">❓</button>`;
    top.appendChild(bar);
    bar.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
      if (b.classList.contains("helpBtn")) sheet.classList.remove("hidden"); else this.set(b.dataset.t); });
    // hauteur réelle du haut de page : l'écran de jeu s'ajuste pour tenir sans défiler
    const upd = () => { document.documentElement.style.setProperty("--topH", top.getBoundingClientRect().height + "px"); this.fit(); };
    if (window.ResizeObserver) new ResizeObserver(upd).observe(top); upd();
    this.set(store.get("appTab:" + this.key, "play"));
    // l'ajustement se fait avant l'affichage : dès qu'un bloc de jeu change de taille (contenu ajouté au
    // lancement, polices chargées…), on recalcule dans la même image, sans redimensionnement visible
    addEventListener("resize", () => this.fit()); setInterval(() => this.fit(), 700);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => this.fit());
      main.querySelectorAll(':scope>[data-tab="play"]').forEach(sec => ro.observe(sec.querySelector(":scope>.body") || sec));
    }
    // l'écran de jeu reste masqué jusqu'à ce que sa taille finale soit posée (page chargée + polices)
    // on attend que la mise en page ne bouge plus (3 mesures identiques de suite) avant d'afficher
    let last = "", same = 0;
    const done = () => { clearInterval(chk); document.body.classList.add("fitted"); };
    const chk = setInterval(() => {
      this.fit(); const sig = main.style.zoom + "|" + document.querySelector(".top").offsetHeight + "|" + main.scrollHeight;
      same = sig === last ? same + 1 : 0; last = sig;
      if (same >= 3 && document.readyState === "complete") done();
    }, 50);
    setTimeout(done, 1500);
  },
  /* écran de jeu sur téléphone : tout doit tenir sans défiler.
     1) la caméra / la carte rapetisse, 2) s'il le faut encore, l'ensemble est réduit (zoom). */
  fit(){
    const main = document.querySelector("main"); if (!main) return;
    // un réglage sorti d'un bloc masqué (ex. options d'une autre source) reste masqué
    this.away.forEach(e => e.classList.toggle("awayHidden", !!e._home.closest(".hidden")));
    const on = this.cur === "play" && innerWidth < 1000 && !document.body.classList.contains("camMax") && !document.body.classList.contains("camFull")
      && !main.querySelector("#touchPad.full, .camWrap.max");   // zone plein écran dans la page : pas de zoom
    const flex = [...document.querySelectorAll('main>[data-tab="play"] video, main>[data-tab="play"] .mapWrap')];
    // remise à zéro puis mesure dans la même image : aucun clignotement
    main.style.zoom = ""; flex.forEach(e => { e.style.maxHeight = ""; if (e.classList.contains("mapWrap")) e.style.height = ""; });
    if (!on) return;
    const se = document.scrollingElement; let over = se.scrollHeight - innerHeight;
    if (over <= 1) return;
    const f = flex.filter(e => e.offsetParent !== null && e.getBoundingClientRect().height > 100).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (f) {
      const h = f.getBoundingClientRect().height, nh = Math.max(150, h - over);
      if (f.classList.contains("mapWrap")) f.style.height = nh + "px"; f.style.maxHeight = nh + "px";
      over = se.scrollHeight - innerHeight; if (over <= 1) return;
    }
    const mh = main.getBoundingClientRect().height, z = Math.max(.6, (mh - over) / mh);
    main.style.zoom = z.toFixed(3);
  },
  set(t){
    this.cur = t; document.body.dataset.apptab = t; store.set("appTab:" + this.key, t);
    document.querySelectorAll("#appTabs button").forEach(b => b.classList.toggle("sel", b.dataset.t === t));
    if (t === "play") document.querySelectorAll('main>[data-tab="play"]').forEach(d => { if (d.tagName === "DETAILS") d.open = true; });
    if (t === "car" && $("secGame")) $("secGame").open = true;
    window.scrollTo(0, 0); this.fit();
  },
};

function initShell({ clientName, roleLabels, emergencyStop, onDisconnect, background = false }){
  App.bp = new ButtplugClient(clientName);
  App.allowBackground = background;
  nativeCall("setBackground", !!background);
  App.emergencyStop = () => { if (typeof Partner !== "undefined") Partner.cancel(); App.suspended = false; emergencyStop(); };
  App.onDisconnect = onDisconnect || (() => {});
  // monitoring : widgets compacts sur téléphone (HUD), panneau complet sur demande
  Hud.init(clientName);
  AppTabs.init();
  const conn = $("conn");
  conn.innerHTML = `<summary>🔌 Appareils <small id="connSum">non connecté</small></summary><div class="body">
    <label class="f"><span>Serveur Intiface</span><input id="wsUrl" type="text" value="ws://127.0.0.1:12345"></label>
    <label class="f"><span>Reconnexion automatique</span><input id="autoConn" type="checkbox"></label>
    <div class="row"><button id="connectBtn" class="primary">Connecter</button><button id="scanBtn">Scanner</button></div>
    <div id="devices"><p class="muted">Aucun appareil.</p></div>
    <p class="muted">Lance Intiface Central et démarre son serveur avant de connecter. Choisis le rôle de chaque actionneur : rien n'est mis en « Shock » automatiquement. Les rôles sont mémorisés pour tous les modes.<br>Équipement : <span id="equipLine"></span> (modifiable depuis le menu ☰).</p></div>`;
  const setConn = txt => { $("connState").textContent = txt; $("connState").classList.toggle("on", bp.connected); $("connSum").textContent = txt; };
  $("wsUrl").value = store.get("bpUrl", "ws://127.0.0.1:12345");
  $("autoConn").checked = store.get("bpAuto", false);
  $("autoConn").onchange = () => store.set("bpAuto", $("autoConn").checked);

  const bp = App.bp;
  bp.onChange = () => renderDevices(roleLabels);
  /* Connexion avec nouvelles tentatives : Intiface n'accepte qu'un client à la fois, et
     l'ancien écran met parfois un instant à libérer sa place lors d'un changement de page. */
  let userClosed = false, retryTimer = null, tries = 0, connecting = false;
  const scheduleRetry = () => {
    clearTimeout(retryTimer);
    if (userClosed || !$("autoConn").checked) return;
    const delay = Math.min(10000, 1500 * Math.max(1, tries));
    setConn("reconnexion…");
    retryTimer = setTimeout(doConnect, delay);
  };
  bp.onClose = () => {
    App.roles = {}; setConn("déconnecté"); $("connectBtn").textContent = "Connecter";
    if ($("autoConn").checked && !userClosed) {
      // reconnexion automatique : la séance continue, les appareils sont simplement à l'arrêt en attendant
      if (App.armed) log("⚠ Connexion Intiface perdue : appareils à l'arrêt, la séance continue et la reconnexion est en cours.");
    } else {
      if (App.armed) log("⚠ Connexion Intiface perdue : session désarmée par sécurité.");
      App.onDisconnect();
    }
    if (!userClosed && !connecting) { log("Déconnecté d'Intiface."); scheduleRetry(); }
  };
  const doConnect = async () => {
    if (connecting || bp.connected) return;
    connecting = true; userClosed = false; clearTimeout(retryTimer);
    const url = $("wsUrl").value.trim(); store.set("bpUrl", url);
    setConn("connexion…");
    try {
      const info = await bp.connect(url);
      tries = 0;
      for (const k in App.last) App.last[k] = -1;   // renvoie les niveaux en cours après une reconnexion
      setConn("connecté · " + info.ServerName); $("connectBtn").textContent = "Déconnecter";
      log("Connecté à " + info.ServerName);
    } catch (e) {
      tries++;
      if (tries === 1 || tries % 5 === 0) log(e.message + ($("autoConn").checked ? " — nouvel essai automatique…" : ""));
      setConn("déconnecté");
      scheduleRetry();
    } finally { connecting = false; }
  };
  $("connectBtn").onclick = () => {
    if (bp.connected) { userClosed = true; clearTimeout(retryTimer); bp.ws.close(1000); }
    else { tries = 0; doConnect(); }
  };
  $("scanBtn").onclick = async () => {
    try { await bp.send("StartScanning", {}); log("Scan en cours…"); setTimeout(() => bp.send("StopScanning", {}).catch(() => {}), 10000); }
    catch (e) { log(e.message); }
  };
  if ($("autoConn").checked) setTimeout(doConnect, 300);   // laisse l'écran précédent libérer Intiface
  else if (!store.get("open:" + clientName + ":conn", null)) conn.open = true;
  $("connState").onclick = () => { conn.open = true; conn.scrollIntoView({ behavior: "smooth", block: "center" }); };
  persistDetails(clientName);
  applyEquip();

  $("estop").onclick = () => App.emergencyStop();
  $("menuBtn").onclick = () => {
    App.emergencyStop();
    if (typeof Partner !== "undefined") Partner.nav();
    setTimeout(() => { location.href = "index.html"; }, 200);
  };
  document.addEventListener("keydown", e => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.code === "Space" || e.code === "Escape") { e.preventDefault(); App.emergencyStop(); }
  });
  document.addEventListener("visibilitychange", () => { document.hidden ? App.onHidden() : App.onVisible(); });
  window.addEventListener("pagehide", stopAllRaw);
  window.addEventListener("beforeunload", stopAllRaw);
}
/* En quittant l'écran : tout arrêter et libérer proprement la place chez Intiface */
function stopAllRaw(){
  try {
    if (App.bp && App.bp.connected) {
      App.bp.ws.send(JSON.stringify([{ StopAllDevices: { Id: 999999 } }]));
      App.bp.onClose = () => {}; App.bp.ws.close(1000);
    }
  } catch {}
}

/* Fenêtre de confirmation avec case « j'accepte » obligatoire */
/* Boîte de dialogue : check = case à cocher obligatoire (sinon OK direct) ;
   input = { value, placeholder, type, maxlength } : renvoie le texte saisi (ou null si annulé) */
function confirmDialog({ title, html = "", check, input, ok = "Confirmer", cancel = "Annuler" }){
  return new Promise(res => {
    const bg = document.createElement("div"); bg.className = "modalBg";
    bg.innerHTML = `<div class="modal"><h3></h3><div class="mbody"></div>
      ${input ? `<input class="minput" style="width:100%;margin:8px 0">` : ""}
      ${check ? `<label class="f"><span class="mchk"></span><input type="checkbox" class="mcb"></label>` : ""}
      <div class="row"><button class="mno"></button><button class="mok primary"></button></div></div>`;
    bg.querySelector("h3").textContent = title; bg.querySelector(".mbody").innerHTML = html;
    bg.querySelector(".mno").textContent = cancel; const okB = bg.querySelector(".mok"); okB.textContent = ok;
    const inp = bg.querySelector(".minput");
    if (inp) { inp.type = input.type || "text"; inp.value = input.value || ""; inp.placeholder = input.placeholder || ""; if (input.maxlength) inp.maxLength = input.maxlength; if (input.type === "password") inp.inputMode = "numeric"; }
    if (check) { bg.querySelector(".mchk").textContent = check; const cb = bg.querySelector(".mcb"); okB.disabled = true; cb.onchange = () => { okB.disabled = !cb.checked; }; }
    const close = v => { bg.remove(); res(v); };
    okB.onclick = () => close(inp ? inp.value : true); bg.querySelector(".mno").onclick = () => close(inp ? null : false);
    if (inp) inp.onkeydown = e => { if (e.key === "Enter" && !okB.disabled) okB.onclick(); };
    document.body.appendChild(bg);
    if (inp) setTimeout(() => inp.focus(), 50);
  });
}
/* Enregistrer / partager un fichier texte (sauvegarde) : feuille de partage Android ou téléchargement */
function saveTextFile(name, text, mime = "application/json"){
  if (nativeCall("shareFile", name, text, mime)) return;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* Bandeau temporaire en haut de l'écran */
function toast(title, text = "", color = "var(--acc)"){
  const t = document.createElement("div"); t.className = "toast"; t.style.borderLeftColor = color;
  t.textContent = title; if (text) { const s = document.createElement("small"); s.textContent = text; t.appendChild(s); }
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("out"), 3500); setTimeout(() => t.remove(), 3900);
}

/* ---------------------------------------------------------------------
 * Sons (Web Audio)
 * ------------------------------------------------------------------- */
let actx = null;
function beep(freq = 880, ms = 150, times = 1){
  const s = $("sound"); if (s && !s.checked) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * (ms / 1000 + 0.08);
      o.frequency.value = freq; g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + ms / 1000);
    }
  } catch {}
}

/* Motifs de vibration prêts à l'emploi (Tribute, Obedience Deck, Mind Games).
   VibFx.level(fx, ms) → intensité 0–100 au temps ms d'un effet { type, I, D (s) } */
const VIB_TYPES = { wave: "Vague", burst: "Rafale continue", tease: "Tease aléatoire", pulse: "Pulsations", ramp: "Montée progressive", heart: "Battements" };
const VibFx = {
  level(fx, ms){
    const D = Math.max(0.1, fx.D) * 1000, t = ms / D, I = fx.I;
    if (ms < 0 || ms >= D) return 0;
    switch (fx.type) {
      case "burst": return I;
      case "wave":  { const P = D / Math.max(1, Math.round(D / 12000)); return I * (0.5 - 0.5 * Math.cos(2 * Math.PI * ms / P)); }   // vagues de ~12 s
      case "ramp":  return I * t;
      case "pulse": return (ms % 1000) < 500 ? I : I * 0.15;
      case "heart": { const k = ms % 1100; return k < 140 || (k > 260 && k < 400) ? I : I * 0.1; }
      case "tease": { const k = Math.floor(ms / 700); const r = Math.abs(Math.sin(k * 12.9898 + (fx.seed || 1) * 78.233) * 43758.5453) % 1; return r > 0.45 ? I * (0.4 + 0.6 * r) : 0; }
    }
    return 0;
  },
};

/* Consignes vocales : synthèse vocale d'Android (ou du navigateur). Case « voice » de la page. */
const Speak = {
  last: {}, 
  say(text, key = text, minGap = 0){
    const v = $("voice"); if (v && !v.checked) return;
    const t = Date.now(); if (minGap && t - (this.last[key] || 0) < minGap) return;
    this.last[key] = t;
    if (nativeCall("speak", text)) return;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = "fr-FR"; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
  }
};

/* ---------------------------------------------------------------------
 * Caméra (avant/arrière) + détection de mouvement par différence d'images
 * ------------------------------------------------------------------- */
async function openCamera(video, facing = "user", w = 640, h = 480){
  const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: w }, height: { ideal: h } }, audio: false });
  video.srcObject = s; try { await video.play(); } catch {}
  return s;
}
class CamMotion {
  constructor(video){ this.video = video; this.stream = null; this.W = 80; this.H = 60; this.prev = null;
    this.c = document.createElement("canvas"); this.c.width = this.W; this.c.height = this.H; this.ctx = this.c.getContext("2d", { willReadFrequently: true }); }
  get on(){ return !!this.stream; }
  async start(facing){ this.stop(); this.stream = await openCamera(this.video, facing); }
  stop(){ if (this.stream) this.stream.getTracks().forEach(t => t.stop()); this.stream = null; this.video.srcObject = null; this.prev = null; }
  /* % de pixels qui ont changé (0–100) ou null si pas d'image */
  sample(thr = 25){
    const v = this.video;
    if (!this.stream || v.readyState < 2) return null;
    this.ctx.drawImage(v, 0, 0, this.W, this.H);
    const d = this.ctx.getImageData(0, 0, this.W, this.H).data, g = new Uint8Array(this.W * this.H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    let m = 0;
    if (this.prev) { let c = 0; for (let i = 0; i < g.length; i++) if (Math.abs(g[i] - this.prev[i]) > thr) c++; m = c / g.length * 100; }
    this.prev = g; return m;
  }
}

/* ---------------------------------------------------------------------
 * Gyroscope + accéléromètre du téléphone (DeviceMotion)
 * Le téléphone est posé/attaché sur le corps (ou le lit) : toute
 * secousse ou rotation est mesurée.
 * ------------------------------------------------------------------- */
const Gyro = {
  on: false, last: 0, peakA: 0, peakR: 0, grav: null, hp: null, trS: 0, trN: 0,
  async start(){
    if (typeof DeviceMotionEvent === "undefined") throw new Error("Capteurs de mouvement indisponibles sur cet appareil.");
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const r = await DeviceMotionEvent.requestPermission(); if (r !== "granted") throw new Error("Permission capteurs refusée.");
    }
    if (!this.on) window.addEventListener("devicemotion", this._h);
    this.on = true; this.last = 0;
    setTimeout(() => { if (this.on && !this.last) log("⚠ Aucun signal du gyroscope/accéléromètre (appareil sans capteur ?)."); }, 2000);
  },
  stop(){ window.removeEventListener("devicemotion", this._h); this.on = false; this.grav = null; this.hp = null; },
  _h: e => {
    const G = Gyro; G.last = Date.now();
    const ig = e.accelerationIncludingGravity;
    if (ig && ig.x != null) {
      const v = [ig.x, ig.y, ig.z];
      G.grav = G.grav ? G.grav.map((g, i) => 0.9 * g + 0.1 * v[i]) : v;      // gravité (passe-bas)
      G.hp = v.map((x, i) => x - G.grav[i]);                                   // linéaire (passe-haut)
    }
    const la = e.acceleration && e.acceleration.x != null ? [e.acceleration.x, e.acceleration.y, e.acceleration.z] : G.hp;
    if (la) { const m = Math.hypot(la[0], la[1], la[2]); G.peakA = Math.max(G.peakA, m); G.trS += m * m; G.trN++; }
    const rr = e.rotationRate;
    if (rr && rr.alpha != null) G.peakR = Math.max(G.peakR, Math.hypot(rr.alpha, rr.beta || 0, rr.gamma || 0));
  },
  get live(){ return this.on && Date.now() - this.last < 1000; },
  /* Score 0–100 : max(accélération / accMax, rotation / rotMax) depuis le dernier appel */
  sample(accMax, rotMax){
    if (!this.live) return null;
    const s = Math.max(this.peakA / Math.max(0.05, accMax), this.peakR / Math.max(1, rotMax)) * 100;
    this.peakA = 0; this.peakR = 0;
    return clamp(s, 0, 100);
  },
  /* Tremblements : accélération linéaire efficace (m/s²) depuis le dernier appel */
  tremor(){ if (!this.live || !this.trN) return null; const r = Math.sqrt(this.trS / this.trN); this.trS = 0; this.trN = 0; return r; },
  /* Vecteur gravité normalisé (inclinaison du téléphone) */
  tilt(){
    if (!this.live || !this.grav) return null;
    const n = Math.hypot(...this.grav); return n > 1 ? this.grav.map(x => x / n) : null;
  }
};

/* ---------------------------------------------------------------------
 * Ceinture cardio BLE (service standard heart_rate 0x180D)
 * APK : pont natif Android. Navigateur : Web Bluetooth.
 * ------------------------------------------------------------------- */
const HR = {
  bpm: null, last: 0, name: null, onStatus: () => {}, onBpm: () => {},
  get live(){ return this.bpm != null && Date.now() - this.last < 5000; },
  _push(bpm){ this.bpm = bpm; this.last = Date.now(); this.onBpm(bpm); },
  _status(txt){ this.onStatus(txt); log("Cardio : " + txt); },
  async connect(){
    if (NATIVE && window.AndroidBridge.hrConnect) { window.AndroidBridge.hrConnect(); return; }
    if (!navigator.bluetooth) throw new Error("Bluetooth indisponible : utilise l'APK, ou Chrome/Edge.");
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
    this._dev = dev;
    dev.addEventListener("gattserverdisconnected", () => this._webReconnect(1));
    await this._webSubscribe(dev);
  },
  /* Navigateur : reconnexion automatique à la même ceinture */
  async _webReconnect(n){
    if (this._dev !== undefined && n > 30) { this.bpm = null; this._status("perdu ⚠"); return; }
    this._status("liaison perdue, reconnexion…");
    await new Promise(r => setTimeout(r, Math.min(8000, 1000 * n)));
    try { await this._webSubscribe(this._dev); } catch { this._webReconnect(n + 1); }
  },
  async _webSubscribe(dev){
    const server = await dev.gatt.connect();
    const ch = await (await server.getPrimaryService("heart_rate")).getCharacteristic("heart_rate_measurement");
    ch.addEventListener("characteristicvaluechanged", e => {
      const v = e.target.value, flags = v.getUint8(0);
      this._push((flags & 1) ? v.getUint16(1, true) : v.getUint8(1));
    });
    await ch.startNotifications();
    this.name = dev.name; this._status("connecté · " + dev.name);
  }
};
/* Appel sûr d'une méthode du pont Android (sans effet dans un navigateur) */
function nativeCall(name, ...args){
  try { if (NATIVE && typeof window.AndroidBridge[name] === "function") { window.AndroidBridge[name](...args); return true; } } catch (e) { console.warn(name, e); }
  return false;
}
/* Événements génériques venant du code Java : window.__native(type, valeur) */
const NativeBus = {};
function onNative(type, fn){ (NativeBus[type] = NativeBus[type] || []).push(fn); }
/* ---------------------------------------------------------------------
 * Écran verrouillé / application en arrière-plan
 *  - mode prévu pour (Sortie, Denial sans caméra) : rien ne change
 *  - liaison partenaire active : le programme automatique se met en pause
 *    (ses capteurs caméra sont coupés), le partenaire garde la main
 *  - sinon : arrêt par sécurité, comme avant
 * ------------------------------------------------------------------- */
App.onHidden = () => {
  if (!App.armed || App.allowBackground || App.suspended) return;
  if (typeof Partner !== "undefined" && Partner.cfg.enabled && Partner.started) {
    App.suspended = true;
    sendLevel("vib", 0, true); sendLevel("stim", 0, true);
    log("🔒 Écran verrouillé : programme automatique en pause, ton/ta partenaire garde la main.");
    Partner.send(true);
  } else { log("Application masquée → arrêt par sécurité."); App.emergencyStop(); }
};
App.onVisible = () => {
  if (!App.suspended) return;
  App.suspended = false; log("🔓 Écran déverrouillé : programme automatique repris.");
  if (typeof Partner !== "undefined") Partner.send(true);
};
/* Le code natif réveille la page écran éteint si le mode le permet ou si un partenaire est lié */
App.syncBg = () => nativeCall("setBgAllowed", !!(App.allowBackground || (typeof Partner !== "undefined" && Partner.cfg.enabled)));

/* Réveil natif écran éteint : chaque module y ajoute ses tâches périodiques */
const BgHooks = [];
window.__bgTick = () => BgHooks.forEach(f => { try { f(); } catch (e) { console.warn(e); } });

/* Minuteur fiable même écran éteint (Android ralentit setTimeout en arrière-plan) :
   sert surtout à couper la stim à l'heure. Vérifié toutes les 50 ms et à chaque réveil natif. */
const Sched = {
  list: [],
  at(t, fn){ const o = { t, fn }; this.list.push(o); return o; },
  after(ms, fn){ return this.at(Date.now() + ms, fn); },
  cancel(o){ this.list = this.list.filter(x => x !== o); },
  run(){
    const n = Date.now(); if (!this.list.some(x => x.t <= n)) return;
    const due = this.list.filter(x => x.t <= n).sort((a, b) => a.t - b.t);
    this.list = this.list.filter(x => x.t > n);
    due.forEach(x => { try { x.fn(); } catch (e) { console.warn(e); } });
  }
};
setInterval(() => Sched.run(), 50);
BgHooks.push(() => Sched.run());
window.__native = (type, val) => { (NativeBus[type] || []).forEach(f => { try { f(val); } catch (e) { console.warn(e); } }); };
onNative("log", v => log(v));
onNative("stop", () => { log("⛔ Arrêt demandé depuis la notification."); App.emergencyStop(); });

/* Appelé par le code Java */
window.__nativeHR = (type, val) => {
  if (type === "bpm") HR._push(+val);
  else if (type === "lost") { HR.bpm = null; HR._status("perdu ⚠"); }
  else HR._status(String(val));
};

/* ---------------------------------------------------------------------
 * Sauvegarde générique de réglages
 * ------------------------------------------------------------------- */
const Cfg = {
  save(key, fields, checks = [], extra = {}){
    const c = { ...extra }; fields.forEach(f => c[f] = $(f).value); checks.forEach(f => c[f] = $(f).checked);
    store.set(key, c) ? log("Réglages sauvegardés.") : log("Sauvegarde impossible.");
  },
  load(key, fields, checks = []){
    const c = store.get(key, null); if (!c) return null;
    fields.forEach(f => { if (c[f] !== undefined && $(f)) $(f).value = c[f]; });
    checks.forEach(f => { if (c[f] !== undefined && $(f)) $(f).checked = c[f]; });
    return c;
  },
  reset(key){ store.del(key); location.reload(); }
};

/* Bouton « Copier le journal » sous chaque journal (pour diagnostiquer un souci) */
(() => {
  const l = document.getElementById("log"); if (!l || l.classList.contains("hidden")) return;
  const b = document.createElement("button"); b.textContent = "Copier le journal"; b.style.marginTop = "8px";
  b.onclick = async () => {
    const txt = `BPlaysure · ${document.title} · ${navigator.userAgent}\n` + l.textContent;
    try { await navigator.clipboard.writeText(txt); b.textContent = "Copié ✓"; }
    catch { if (!nativeCall("share", txt)) b.textContent = "Copie impossible"; }
    setTimeout(() => { b.textContent = "Copier le journal"; }, 2000);
  };
  l.after(b);
})();
