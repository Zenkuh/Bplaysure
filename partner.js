/* ======================================================================
 * Liaison partenaire côté PORTEUR (chargé par le menu et par chaque mode)
 *  - publie l'état du mode ouvert (aperçu) vers la télécommande
 *  - applique les commandes reçues, dans la limite des permissions et
 *    des plafonds choisis par le porteur dans le menu principal
 * Nécessite common.js et outdoor.js.
 * ====================================================================== */
"use strict";

const PAIR_DEFAULT = { enabled: false, code: null, broker: "emqx", level: "vib", stim: false, vibCap: 60, stimCap: 20, discreet: true,
  msWearer: false, msPartner: false, msCode: null, msSince: null };   // mode Master/Sub (double consentement)
const MODE_REQ = {
  motion: { out: ["vib", "stim"], req: ["cam", "gyro"] },
  deep:   { out: ["vib", "stim"], req: [] },
  denial: { out: ["vib", "stim"], req: [] },
  public: { out: ["vib"], req: [] },
  ahegao: { out: ["vib", "stim"], req: ["cam"] },
  seek:   { out: ["vib"], req: [] },
  making: { out: ["vib", "stim"], req: ["cam"] },
  tribute: { out: ["vib", "stim"], req: [] },
  eyes:   { out: ["vib", "stim"], req: ["cam"] },
  deck:   { out: ["vib", "stim"], req: [] },
  mind:   { out: ["vib", "stim"], req: [] },
};
function modeAllowed(k){
  const m = MODE_REQ[k]; if (!m) return false;
  return m.out.some(e => Equip[e]) && (!m.req.length || m.req.some(e => Equip[e]));
}

/* Plusieurs Maîtres nommés (côté porteur) : chacun a son code, ses permissions et son accord Master/Sub.
   Un seul est actif à la fois ; on change de Maître depuis le menu. */
const Masters = (() => {
  let m = store.get("bpMasters", null);
  if (!m || !Array.isArray(m.list) || !m.list.length) {
    m = { list: [{ id: "m1", name: "Maître", cfg: { ...PAIR_DEFAULT, ...store.get("bpPair", {}) } }], active: "m1" };
    store.set("bpMasters", m);
  }
  if (!m.list.some(x => x.id === m.active)) m.active = m.list[0].id;
  return {
    raw: m,
    get list(){ return m.list; },
    get cur(){ return m.list.find(x => x.id === m.active); },
    save(){ store.set("bpMasters", m); },
    add(name){
      const id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), en = this.cur ? !!this.cur.cfg.enabled : false;
      m.list.push({ id, name: String(name).slice(0, 30) || "Maître", cfg: { ...PAIR_DEFAULT, enabled: en, code: Link.newCode() } });
      this.save(); return id;
    },
    rename(id, name){ const e = m.list.find(x => x.id === id); if (e && name) { e.name = String(name).slice(0, 30); this.save(); } },
    remove(id){ if (m.list.length < 2) return false; const en = this.cur.cfg.enabled; m.list = m.list.filter(x => x.id !== id); if (m.active === id) { m.active = m.list[0].id; m.list[0].cfg.enabled = en; } this.save(); return true; },
    activate(id){ const old = this.cur, e = m.list.find(x => x.id === id); if (!e) return; e.cfg.enabled = old ? !!old.cfg.enabled : e.cfg.enabled; m.active = id; this.save(); },
  };
})();

const Partner = {
  cfg: { ...PAIR_DEFAULT, ...Masters.cur.cfg },
  mode: "menu", ad: null, ov: null, armTimer: null, lastShock: 0, stimLevel: 0,
  lastSent: 0, lastKey: "", started: false, status: "désactivée", onStatus: () => {},

  save(){ Masters.cur.cfg = this.cfg; Masters.save(); },
  get masterName(){ return Masters.cur.name; },
  /* Master/Sub actif = accord du porteur + accord du partenaire, pour le code actuel */
  get ms(){ return !!(this.cfg.msWearer && this.cfg.msPartner && this.cfg.msCode === this.cfg.code); },
  get can(){
    if (this.ms) return { vib: true, full: true, stim: Equip.stim };
    const l = this.cfg.level; return { vib: l !== "view", full: l === "full", stim: !!this.cfg.stim && Equip.stim };
  },
  /* Retrait du consentement (porteur ou partenaire) : retour immédiat aux plafonds habituels */
  msRevoke(who){
    if (who === "wearer") this.cfg.msWearer = false;
    this.cfg.msPartner = false; this.cfg.msCode = null; this.cfg.msSince = null; this.save();
    log(who === "wearer" ? "👑 Mode Master/Sub désactivé." : "👑 Le partenaire a quitté le mode Master/Sub.");
    this.send(true);
  },
  get peerLive(){ return Link.peerLive; },
  get remoteActive(){ return !!this.ov && Date.now() < this.ov.until; },

  /* mode : "menu" | "motion" | "deep" | "denial" | "public" | "ahegao" ; adapter : voir chaque page */
  init(mode, adapter = {}){
    this.mode = mode;
    this.ad = { telemetry: () => ({}), actions: () => [], doAction: () => {}, setArmed: null,
                vibCap: () => this.cfg.vibCap, blockRemote: () => false, ...adapter };
    if (!this.cfg.code) { this.cfg.code = Link.newCode(); this.save(); }
    Link.onMsg = m => this._msg(m);
    Link.onStatus = s => { this.status = "relais " + s; this.onStatus(this.status); if (s === "connecté") this.send(true); };
    this._pill();
    if (this.cfg.enabled) { this.start(); Sensors.keepAlive(); }
    App.syncBg();
    setInterval(() => { this.send(false); this._pill(); }, 250);
    BgHooks.push(() => { this.send(false); if (Link.mq) Link.mq.maintain(); });   // écran éteint (mode Sortie)
    // Applique la vibration du partenaire même quand le mode n'envoie rien (pause du denial, écran
    // verrouillé…). Branché aussi sur le réveil natif : Android gèle les minuteries écran éteint.
    const ovTick = () => {
      const a = this.remoteActive && !this.ad.blockRemote();
      if ((a || this._wasOv) && App.bp) sendLevel("vib", 0);
      this._wasOv = a;
    };
    setInterval(ovTick, 100);
    BgHooks.push(ovTick);
  },
  start(){ this.started = true; Sensors.keepAlive(); App.syncBg(); Link.start(this.cfg.code, "w", BROKERS[this.cfg.broker] || BROKERS.emqx).catch(e => log("Partenaire : " + e.message)); },
  stop(){ Link.stop(); this.started = false; this.cancel(); this.status = "désactivée"; this.onStatus(this.status); App.syncBg(); if (!Sensors.running) nativeCall("sensorsStop"); },
  restart(){ this.stop(); if (this.cfg.enabled) this.start(); },

  /* Prévient la télécommande d'un changement d'écran (évite une fausse alerte « hors ligne ») */
  nav(){ if (this.started) Link.send({ t: "nav" }); },

  /* Annule tout ce qui vient du partenaire (appelé par ARRÊT) */
  cancel(){
    this.ov = null;
    if (this.armTimer) { this.armTimer = null; log("Armement à distance annulé."); }
  },

  /* Niveau de vibration imposé par le partenaire (0–100 absolu) ou null */
  vibOverride(){
    const o = this.ov; if (!o) return null;
    const t = Date.now();
    if (t >= o.until) { this.ov = null; return null; }
    if (this.ad.blockRemote()) return null;
    const d = (o.until - o.t0) / 1000, s = (t - o.t0) / 1000;
    const p = o.pat && PATTERNS[o.pat] ? PATTERNS[o.pat].f(s / d, s, d) : 1;
    return (this.ms ? 100 : clamp(this.ad.vibCap(), 0, 100)) * o.lvl / 100 * p;
  },

  /* ---------- Réglages du mode, modifiables par le Maître (Master/Sub uniquement) ----------
     Construits à partir de l'écran : chaque champ « label.f » visible des volets de réglages.
     Les champs marqués data-local (sécurité respiratoire de Blow Trainer) restent au porteur. */
  cfgSchema(){
    const out = [];
    document.querySelectorAll("main details.card").forEach(sec => {
      if (["conn", "secLog"].includes(sec.id) || sec.classList.contains("hidden")) return;
      const sum = sec.querySelector("summary"), title = sum ? sum.childNodes[0].textContent.trim() : "";
      sec.querySelectorAll("label.f").forEach(l => {
        if (l.closest(".hidden")) return;
        const el = l.querySelector("input,select"), sp = l.querySelector("span");
        if (!el || !el.id || !sp || "local" in el.dataset || el.type === "text" || el.disabled) return;   // champs réglés par la carrière : exclus
        const f = { id: el.id, label: sp.textContent.trim(), sec: title };
        if (el.tagName === "SELECT") { f.type = "select"; f.options = [...el.options].filter(o => !o.disabled).map(o => [o.value, o.text]); f.value = el.value; }
        else if (el.type === "checkbox") { f.type = "check"; f.value = el.checked; }
        else { f.type = el.type === "range" ? "range" : "number"; f.min = el.min; f.max = el.max; f.step = el.step || "any"; f.value = el.value; }
        out.push(f);
      });
    });
    return out;
  },
  sendCfg(){ if (this.ms && this.mode !== "menu") Link.send({ t: "cfg", mode: this.mode, fields: this.cfgSchema(), canSave: !!$("saveCfg") }); },
  applySet(id, value){
    const f = this.cfgSchema().find(x => x.id === id); if (!f) return;      // uniquement les champs autorisés
    const el = $(id);
    if (f.type === "check") el.checked = !!value;
    else if (f.type === "select") { if (!f.options.some(o => o[0] === value)) return; el.value = value; }
    else {
      let v = +value; if (!isFinite(v)) return;
      if (f.min !== "") v = Math.max(+f.min, v); if (f.max !== "") v = Math.min(+f.max, v);
      el.value = v;
    }
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    log(`👑 Réglage « ${f.label} » → ${f.type === "check" ? (el.checked ? "oui" : "non") : f.type === "select" ? el.selectedOptions[0].text : el.value}`);
    clearTimeout(this._cfgT); this._cfgT = setTimeout(() => this.sendCfg(), 400);
  },

  shock(lvl, ms){
    if (!this.can.stim) { log("🎮 Shock refusé : e-stim à distance non autorisée dans le menu."); return; }
    if (!App.armed) return;
    const M = this.ms, t = Date.now();
    if (t - this.lastShock < (M ? 1000 : 2000)) return;                // délai minimum entre deux
    ms = clamp(+ms || 400, 100, M ? 3000 : 1000);                       // garde-fou : 3 s max (brûlures)
    const level = (M ? 100 : clamp(this.cfg.stimCap, 0, 100)) * clamp(+lvl || 0, 0, 100) / 100;
    this.lastShock = t;
    this.stimLevel = sendLevel("stim", level, true, { master: M, partner: true });
    log(`⚡ Shock du partenaire : ${this.stimLevel.toFixed(0)} % pendant ${ms} ms`);
    Sched.after(ms, () => { this.stimLevel = 0; sendLevel("stim", 0, true); this.send(true); });
  },

  _msg(m){
    if (!this.cfg.enabled) return;
    const c = this.can, t = Date.now();
    switch (m.t) {
      case "hello": log("🎮 Partenaire connecté."); break;
      case "ms_accept":
        if (this.cfg.msWearer && !this.ms) {
          this.cfg.msPartner = true; this.cfg.msCode = this.cfg.code; this.cfg.msSince = new Date().toISOString(); this.save();
          log("👑 Le partenaire a accepté : mode Master/Sub actif."); beep(990, 150, 2);
        }
        break;
      case "ms_revoke": if (this.cfg.msPartner) this.msRevoke("partner"); break;
      case "getcfg": this.sendCfg(); return;
      case "getgcfg": if (this.ms && typeof Game !== "undefined") { const r = Game.remoteSchema(m.app); if (r) Link.send(r); } return;
      case "gset":
        if (this.ms && typeof Game !== "undefined") { Game.remoteSet(m); const r = Game.remoteSchema(m.app); if (r) Link.send(r); }
        break;
      case "set": if (this.ms) this.applySet(m.id, m.value); return;
      case "savecfg":
        if (this.ms && $("saveCfg")) { $("saveCfg").click(); log("👑 Réglages sauvegardés par le Maître."); Link.send({ t: "saved" }); }
        return;
      case "stop": this.ov = null; break;
      case "hold":
        if (!c.vib || !App.armed) break;
        this.ov = { lvl: clamp(+m.lvl || 0, 0, 100), t0: this.ov && this.ov.hold ? this.ov.t0 : t, until: t + 1200, pat: null, hold: true };
        break;
      case "pulse": {
        if (!c.vib || !App.armed) break;
        const ms = clamp(+m.ms || 2000, 300, 15000), pat = PATTERNS[m.pat] ? m.pat : null;
        this.ov = { lvl: clamp(+m.lvl || 0, 0, 100), t0: t, until: t + ms, pat };
        log(`🎮 Vibration ${Math.round(this.ov.lvl)} % · ${(ms / 1000).toFixed(0)} s${pat ? " · " + PATTERNS[pat].label : ""}`);
        break;
      }
      case "shock": this.shock(m.lvl, m.ms); break;
      case "disarm":
        if (App.armed || this.armTimer) { log("🎮 Le partenaire a désarmé la session."); App.emergencyStop(); }
        break;
      case "arm":
        if (!c.full) { log("🎮 Armement à distance non autorisé."); break; }
        this._armCountdown(); break;
      case "app":                                   // données propres au mode (paquet de cartes, code…)
        if (!c.full) break;
        try { if (this.ad.onApp) this.ad.onApp(m.d || {}); } catch (e) { log(e.message); }
        break;
      case "action":
        if (!c.full) break;
        try { this.ad.doAction(m.id); } catch (e) { log(e.message); }
        break;
      case "goto":
        if (!c.full || !MODE_PAGES[m.mode] || m.mode === this.mode) break;
        if (m.mode !== "menu" && !modeAllowed(m.mode)) { log("Mode demandé indisponible avec ton équipement."); break; }
        log("🎮 Le partenaire ouvre " + modeName(m.mode) + "…");
        if (App.armed || this.armTimer) App.emergencyStop();
        this.nav();
        setTimeout(() => { location.href = MODE_PAGES[m.mode]; }, 400);
        break;
    }
    this.send(true);
  },

  /* Armement à distance : compte à rebours de 3 s annulable avec ARRÊT */
  _armCountdown(){
    if (App.armed || this.armTimer || !this.ad.setArmed) return;
    log("🎮 Le partenaire arme la session dans 3 s — ARRÊT pour annuler.");
    beep(660, 120);
    // compte à rebours sur le minuteur fiable (fonctionne aussi écran verrouillé)
    const step = n => () => { if (this.armTimer !== tok) return; beep(660, 120); };
    const tok = {}; this.armTimer = tok;
    Sched.after(1000, step(2)); Sched.after(2000, step(1));
    Sched.after(3000, () => {
      if (this.armTimer !== tok) return;
      this.armTimer = null;
      beep(990, 250); this.ad.setArmed(true);
      if (document.hidden) App.onHidden();          // armé écran verrouillé : seul le partenaire pilote
      this.send(true);
    });
  },

  send(force){
    if (!this.started || !Link.mq) return;
    const tel = this.ad.telemetry() || {};
    const st = {
      t: "st", mode: this.mode, armed: !!App.armed, arming: !!this.armTimer,
      perm: this.can, vibCap: this.ms ? 100 : Math.round(this.ad.vibCap()), stimCap: this.ms ? 100 : this.cfg.stimCap,
      ms: { offered: !!this.cfg.msWearer, active: this.ms, since: this.cfg.msSince },
      remote: this.remoteActive,
      // État des jouets (null au menu : Intiface n'y est pas connecté)
      toys: App.bp ? { on: App.bp.connected, n: App.bp.devices.size, names: [...App.bp.devices.values()].map(d => d.name).slice(0, 3) } : null,
      modes: Object.keys(MODE_REQ).filter(modeAllowed),
      actions: this.can.full ? this.ad.actions() : [],
      phase: "", chips: [], main: null, vib: 0, stim: 0,
      ...tel,
      locked: !!App.suspended || document.hidden,
      hr: HR.live ? HR.bpm : null,                 // cardio en direct (tous les modes)
      game: typeof Game !== "undefined" ? Game.summary() : null,   // progression (carrière)
    };
    if (App.suspended) st.phase = "🔒 Écran verrouillé · programme en pause · tu as la main";
    st.vib = Math.round(Math.max(0, App.last.vib));          // ce qui est réellement envoyé
    st.stim = Math.round(Math.max(0, App.last.stim, this.stimLevel));
    const key = JSON.stringify(st), since = Date.now() - this.lastSent;
    // changement : au plus ~3 envois/s ; sinon un signe de vie toutes les 2 s
    if (!force && ((key === this.lastKey && since < 2000) || since < 300)) return;
    this.lastKey = key; this.lastSent = Date.now(); Link.send(st);
  },

  /* Pastille « 🎮 » dans l'en-tête de chaque écran */
  _pill(){
    const hdr = document.querySelector("header"); if (!hdr) return;
    let p = $("partnerPill");
    if (!p) { p = document.createElement("span"); p.id = "partnerPill"; p.className = "pill"; const ref = $("connState"); ref ? hdr.insertBefore(p, ref) : hdr.appendChild(p); }
    p.classList.toggle("hidden", !this.cfg.enabled);
    const ico = this.ms ? "👑" : "🎮";
    p.textContent = this.armTimer ? ico + " armement…" : this.remoteActive ? ico + " aux commandes" : this.peerLive ? ico + " connecté" : ico + " en attente";
    p.classList.toggle("on", this.peerLive);
  }
};
