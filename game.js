/* ======================================================================
 * Progression (carrière) : 20 niveaux par application, un défi par niveau.
 * Réussir TOUS les objectifs du défi fait passer au niveau suivant.
 * Abandonner (ARRÊT, désarmer) n'est jamais pénalisé.
 * Les valeurs de chaque niveau sont personnalisables (niveau 1, niveau 20,
 * et n'importe quel niveau intermédiaire) : localStorage « bpCareerCfg ».
 * Sauvegarde de la progression : localStorage « bpGame ». Nécessite common.js.
 * ====================================================================== */
"use strict";

const GAME_APPS = { motion: "Keep Pose", deep: "Blow Trainer", public: "Public Play", ahegao: "Ahegao Detector", seek: "Vibe & Seek", making: "Making Pose", tribute: "Tribute", eyes: "Eye Contact", deck: "Obedience Deck", mind: "Mind Games" };
const MAX_LVL = 20;
const lv = (a, b, n) => a + (b - a) * (Math.min(n, MAX_LVL) - 1) / (MAX_LVL - 1);

/* Paramètres de chaque application : valeur au niveau 1 (a) et au niveau 20 (b), interpolées entre les deux.
   goal:true = objectif à atteindre pour réussir le défi (0 = objectif désactivé).
   Blow Trainer : la sécurité respiratoire (maintien max, pause respiration) n'est JAMAIS réglée par la carrière. */
const SPEC = {
  motion: [
    { k: "goal",    l: "Temps de posture à tenir",           s: "Tenue",    u: "s",  a: 30,  b: 315, goal: true, min: 5, max: 7200 },
    { k: "tol",     l: "Tolérance d'écart",                   s: "Tolér.",   u: "%",  a: 20,  b: 6,   min: 1, max: 100 },
    { k: "grace",   l: "Écart soutenu avant shock",           s: "Délai",    u: "ms", a: 800, b: 200, st: 50, min: 0, max: 5000 },
    { k: "lives",   l: "Vies (pertes de posture permises)",   s: "Vies",     u: "",   a: 5,   b: 1,   min: 0, max: 50 },
    { k: "penalty", l: "Pénalité par perte de posture",       s: "Pénal.",   u: "s",  a: 0,   b: 15,  min: 0, max: 600 },
  ],
  deep: [
    { k: "goal",    l: "Temps cumulé en profondeur",          s: "Profond",  u: "s",  a: 10,  b: 120, goal: true, min: 0, max: 3600 },
    { k: "reach",   l: "Nombre de fois à 100 %",              s: "×100 %",   u: "×",  a: 3,   b: 40,  goal: true, min: 0, max: 1000 },
    { k: "deepThr", l: "Seuil « profond »",                   s: "Seuil",    u: "%",  a: 60,  b: 100, min: 10, max: 120 },
    { k: "idleMax", l: "Temps toléré trop peu profond",       s: "Inact.",   u: "s",  a: 15,  b: 4,   min: 2, max: 120 },
    { k: "workS",   l: "Durée d'une série",                   s: "Série",    u: "s",  a: 60,  b: 180, st: 5, min: 15, max: 1800 },
    { k: "sets",    l: "Nombre de séries",                    s: "Séries",   u: "",   a: 2,   b: 5,   min: 1, max: 30 },
    { k: "restS",   l: "Repos entre séries",                  s: "Repos",    u: "s",  a: 60,  b: 20,  st: 5, min: 0, max: 600 },
  ],
  public: [
    { k: "goal",    l: "Durée de sortie armée",               s: "Durée",    u: "min", a: 10, b: 90,  goal: true, min: 1, max: 600 },
    { k: "freq",    l: "Fréquence des taquineries",           s: "Fréq.",    u: "×",   a: 1,  b: 3,   st: 0.1, min: 0.1, max: 10 },
    { k: "dMax",    l: "Durée max d'une taquinerie",          s: "D. max",   u: "s",   a: 8,  b: 25,  min: 1, max: 300 },
    { k: "gapMin",  l: "Pause minimale",                      s: "Pause",    u: "s",   a: 90, b: 20,  min: 5, max: 3600 },
    { k: "heatMin", l: "Montée en chaleur",                   s: "Chaleur",  u: "min", a: 60, b: 20,  min: 1, max: 600 },
  ],
  seek: [
    { k: "goal",    l: "Trésors à trouver d'affilée",         s: "Trésors",  u: "",   a: 1,   b: 4,   goal: true, min: 1, max: 20 },
    { k: "tokens",  l: "Jetons (fouilles) par trésor",        s: "Jetons",   u: "",   a: 6,   b: 2,   min: 1, max: 30 },
    { k: "hapR",    l: "Rayon où les vibrations commencent",  s: "Vib.",     u: "m",  a: 200, b: 60,  st: 5, min: 10, max: 2000 },
    { k: "treR",    l: "Rayon du trésor",                     s: "Trésor",   u: "m",  a: 15,  b: 5,   min: 2, max: 100 },
    { k: "timeMin", l: "Temps limite",                        s: "Temps",    u: "min", a: 40, b: 15,  min: 1, max: 600 },
  ],
  tribute: [
    { k: "goal",    l: "Tributs complets",                    s: "Tributs",  u: "",   a: 3,   b: 20,  goal: true, min: 1, max: 200 },
    { k: "lives",   l: "Abandons permis",                     s: "Abandons", u: "",   a: 3,   b: 1,   min: 0, max: 50 },
    { k: "tribS",   l: "Durée d'un tribut",                   s: "Durée",    u: "s",  a: 8,   b: 40,  min: 3, max: 300 },
    { k: "stimEnd", l: "Intensité finale (% du plafond shock)", s: "Intens.", u: "%", a: 40,  b: 100, min: 0, max: 100 },
    { k: "gapEnd",  l: "Intervalle final entre impulsions",   s: "Rythme",   u: "ms", a: 1200, b: 400, st: 50, min: 300, max: 10000 },
  ],
  deck: [
    { k: "goal",    l: "Paquets complétés",                   s: "Paquets",  u: "",   a: 2,   b: 10,  goal: true, min: 1, max: 100 },
    { k: "lives",   l: "Abandons permis",                     s: "Abandons", u: "",   a: 2,   b: 0,   min: 0, max: 20 },
    { k: "cards",   l: "Cartes par paquet surprise",          s: "Cartes",   u: "",   a: 3,   b: 10,  min: 1, max: 30 },
    { k: "maxI",    l: "Intensité max (% du plafond shock)",  s: "Intens.",  u: "%",  a: 40,  b: 100, min: 5, max: 100 },
  ],
  mind: [
    { k: "goal",    l: "Réussites requises (sur 10 tentatives)", s: "Réussies", u: "", a: 4,   b: 9,   goal: true, min: 1, max: 10 },
    { k: "lives",   l: "Codes perdus permis (Master Mind)",             s: "Erreurs",  u: "",   a: 5,   b: 1,   min: 0, max: 50 },
    { k: "len",     l: "Longueur (code, Simon, séquence)",    s: "Long.",    u: "",   a: 3,   b: 7,   min: 2, max: 10 },
    { k: "react",   l: "Temps de réponse Simon",              s: "Réponse",  u: "ms", a: 3000, b: 1200, st: 100, min: 400, max: 8000 },
    { k: "tries",   l: "Essais par code (Master Mind)",       s: "Essais",   u: "",   a: 12,  b: 6,   min: 1, max: 30 },
  ],
  eyes: [
    { k: "goal",    l: "Regard soutenu cumulé",               s: "Cumul",    u: "s",  a: 30,  b: 300, goal: true, min: 0, max: 7200 },
    { k: "streak",  l: "Regard soutenu d'affilée (une fois)", s: "D'affilée",u: "s",  a: 5,   b: 60,  goal: true, min: 0, max: 1200 },
    { k: "grace",   l: "Regard détourné toléré",              s: "Délai",    u: "ms", a: 900, b: 250, st: 50, min: 100, max: 5000 },
    { k: "tol",     l: "Tolérance du regard",                 s: "Tolér.",   u: "%",  a: 20,  b: 8,   min: 5, max: 90 },
  ],
  making: [
    { k: "goal",    l: "Poses réussies",                      s: "Réussies", u: "",   a: 3,   b: 15,  goal: true, min: 1, max: 100 },
    { k: "lives",   l: "Poses ratées permises",               s: "Ratées",   u: "",   a: 3,   b: 1,   min: 0, max: 50 },
    { k: "getS",    l: "Temps pour prendre la pose",          s: "Prendre",  u: "s",  a: 12,  b: 4,   min: 2, max: 120 },
    { k: "holdS",   l: "Temps de tenue",                      s: "Tenir",    u: "s",  a: 8,   b: 30,  min: 2, max: 600 },
    { k: "thr",     l: "Ressemblance exigée",                 s: "Seuil",    u: "%",  a: 55,  b: 80,  min: 20, max: 98 },
    { k: "grace",   l: "Hors pose avant shock",               s: "Délai",    u: "s",  a: 3,   b: 1,   st: 0.5, min: 0.5, max: 30 },
  ],
  ahegao: [
    { k: "goal",    l: "Temps cumulé en ahegao",              s: "Cumul",    u: "s",  a: 15,  b: 240, goal: true, min: 0, max: 7200 },
    { k: "streak",  l: "Ahegao tenu d'affilée (une fois)",    s: "D'affilée",u: "s",  a: 3,   b: 30,  goal: true, min: 0, max: 600 },
    { k: "grace",   l: "Délai sans ahegao avant shock",       s: "Délai",    u: "s",  a: 20,  b: 5,   min: 2, max: 600 },
    { k: "thr",     l: "Seuil de détection",                  s: "Seuil",    u: "%",  a: 55,  b: 75,  min: 20, max: 95 },
  ],
};

const Career = {
  data: store.get("bpCareerCfg", {}),
  save(){ store.set("bpCareerCfg", this.data); },
  spec(app, k){ return SPEC[app].find(s => s.k === k); },
  ends(app, k){ const s = this.spec(app, k), c = (this.data[app] || {})[k] || {}; return [c.a ?? s.a, c.b ?? s.b]; },
  round(s, v){ const st = s.st || 1; return clamp(+(Math.round(v / st) * st).toFixed(2), s.min, s.max); },
  value(app, k, n){
    const s = this.spec(app, k), c = (this.data[app] || {})[k] || {};
    if (c.ov && c.ov[n] != null) return this.round(s, c.ov[n]);
    const [a, b] = this.ends(app, k);
    return this.round(s, lv(a, b, n));
  },
  params(app, n){ const p = {}; for (const s of SPEC[app]) p[s.k] = this.value(app, s.k, n); return p; },
  /* niveau 1 ou 20 → bornes ; autre niveau → valeur imposée pour ce niveau */
  set(app, k, n, v){
    const s = this.spec(app, k); if (!s || !isFinite(+v)) return;
    v = this.round(s, +v);
    const d = this.data[app] || (this.data[app] = {}), c = d[k] || (d[k] = {});
    if (n === 1) c.a = v; else if (n === MAX_LVL) c.b = v;
    else { c.ov = c.ov || {}; c.ov[n] = v; }
    this.save();
  },
  isCustom(app, k, n){ const c = (this.data[app] || {})[k] || {}; return n === 1 ? c.a != null : n === MAX_LVL ? c.b != null : !!(c.ov && c.ov[n] != null); },
  smooth(app){ const d = this.data[app] || {}; for (const k in d) delete d[k].ov; this.save(); },
  reset(app){ delete this.data[app]; this.save(); },
  /* Pour la télécommande du Maître */
  schema(app){ return SPEC[app].map(s => { const [a, b] = this.ends(app, s.k); return { k: s.k, l: s.l, u: s.u, a, b, da: s.a, db: s.b, min: s.min, max: s.max, st: s.st || 1, goal: !!s.goal }; }); },
};

const fmtMs = x => (x / 1000).toFixed(2).replace(/\.?0+$/, "");
const DESCR = {
  motion: (p, x = 0) => `Tenir la posture <b>${p.goal + x} s</b>${x ? ` (dont +${x} s de pénalités)` : ""} · tolérance <b>${p.tol} %</b> · ${p.lives} vie${p.lives > 1 ? "s" : ""} · shock après ${fmtMs(p.grace)} s d'écart${p.penalty ? ` · +${p.penalty} s par perte de posture` : ""}`,
  deep: p => [p.goal ? `cumuler <b>${p.goal} s</b> au-delà de <b>${p.deepThr} %</b>` : "", p.reach ? `atteindre <b>100 % ${p.reach} fois</b>` : ""].filter(Boolean).join(" et ").replace(/^./, c => c.toUpperCase())
    + ` · ${p.sets} séries de ${p.workS} s · repos ${p.restS} s · shock après ${p.idleMax} s trop peu profond`,
  public: p => `Tenir <b>${p.goal} min</b> de sortie armée · taquineries ×${p.freq} · jusqu'à ${p.dMax} s · pause min ${p.gapMin} s · chaleur max en ${p.heatMin} min`,
  seek: p => `Trouver <b>${p.goal} trésor${p.goal > 1 ? "s" : ""}</b> en moins de <b>${p.timeMin} min</b> · ${p.tokens} jeton${p.tokens > 1 ? "s" : ""} par trésor · vibrations à ${p.hapR} m · trésor de ${p.treR} m`,
  tribute: p => `Payer <b>${p.goal} tributs</b> de <b>${p.tribS} s</b> (${p.lives} abandon${p.lives > 1 ? "s" : ""} permis) · jusqu'à ${p.stimEnd} % du plafond shock · une impulsion toutes les ${(p.gapEnd / 1000).toFixed(2)} s à la fin`,
  deck: p => `Terminer <b>${p.goal} paquets</b> sans abandonner plus de ${p.lives} fois · paquets surprise de ${p.cards} cartes jusqu'à ${p.maxI} % du plafond`,
  mind: p => `Simon / Séquence : réussir <b>${p.goal} tentatives sur 10</b> · Master Mind : trouver <b>${p.goal} codes</b> de ${p.len} chiffres en ${p.tries || 10} essais max (${p.lives} code${p.lives > 1 ? "s" : ""} perdu${p.lives > 1 ? "s" : ""} permis) · longueur de départ ${p.len} · Simon : ${(p.react / 1000).toFixed(1)} s par touche`,
  eyes: p => [p.goal ? `cumuler <b>${p.goal} s</b> de regard soutenu` : "", p.streak ? `le tenir <b>${p.streak} s d'affilée</b>` : ""].filter(Boolean).join(" et ").replace(/^./, c => c.toUpperCase()) + ` · regard détourné toléré ${fmtMs(p.grace)} s · tolérance ${p.tol} %`,
  making: p => `Réussir <b>${p.goal} poses</b> (${p.lives} ratée${p.lives > 1 ? "s" : ""} permise${p.lives > 1 ? "s" : ""}) · ${p.getS} s pour prendre la pose · tenir <b>${p.holdS} s</b> · ressemblance ${p.thr} % · shock après ${p.grace} s hors pose`,
  ahegao: p => [p.goal ? `cumuler <b>${p.goal} s</b> d'ahegao` : "", p.streak ? `le tenir <b>${p.streak} s d'affilée</b>` : ""].filter(Boolean).join(" et ").replace(/^./, c => c.toUpperCase())
    + ` · shock après ${p.grace} s sans ahegao · seuil ${p.thr} %`,
};
const UNITS = { motion: "s", deep: "s", public: "min", ahegao: "s", seek: "", making: "", tribute: "", eyes: "s", deck: "", mind: "" };
const TITLES = ["Débutant·e", "Curieux·se", "Initié·e", "Appliqué·e", "Endurant·e", "Confirmé·e", "Aguerri·e", "Expert·e", "Virtuose", "Légende"];
const rankOf = lvl => TITLES[Math.min(TITLES.length - 1, Math.floor((lvl - 1) / 2))];
/* Compat : LEVELS[app](n) */
const LEVELS = Object.fromEntries(Object.keys(SPEC).map(a => [a, n => Career.params(a, n)]));

const Game = {
  data: store.get("bpGame", {}),
  app: null, run: null, hooks: {}, last: null,
  get(app){ return this.data[app] || (this.data[app] = { lvl: 1, xp: 0, wins: 0, tries: 0, hist: [] }); },
  save(){ store.set("bpGame", this.data); },
  params(app = this.app){ return Career.params(app, this.get(app).lvl); },
  get career(){ return !!store.get("career:" + this.app, true); },
  goals(app = this.app){ return SPEC[app].filter(s => s.goal); },
  target(k){ const r = this.run; return r ? r.p[k] + (k === "goal" ? r.extra : 0) : 0; },

  /* Résumé pour la télécommande du Maître */
  summary(){
    const out = {};
    for (const a of Object.keys(GAME_APPS)) { const g = this.get(a); out[a] = { lvl: g.lvl, xp: g.xp, wins: g.wins, tries: g.tries }; }
    const r = this.run;
    out.run = r ? {
      app: this.app, lvl: r.lvl, won: r.won, reached: !!r.reached, lives: r.p.lives, lost: r.lost, extra: r.extra,
      goals: this.goals().filter(s => r.p[s.k] > 0).map(s => ({ l: s.l, u: s.u, v: Math.floor(r.prog[s.k] || 0), goal: this.target(s.k) })),
      // compat (anciennes télécommandes)
      prog: Math.floor(r.prog.goal || 0), goal: this.target("goal"), unit: UNITS[this.app],
    } : null;
    out.last = this.last;
    return out;
  },

  /* app : "motion" | "deep" | "public" | "ahegao" ; hooks.apply(p, on) règle (et verrouille) les champs du niveau */
  init(app, hooks){
    this.app = app; this.hooks = hooks;
    const box = $("secGame"); if (!box) return;
    box.innerHTML = `<summary>🏆 Carrière <small id="gSum"></small></summary><div class="body">
      <div class="gHead"><div><b id="gLvl" class="gLvlBig"></b><span id="gRank" class="muted"></span></div><div class="gStats muted" id="gStats"></div></div>
      <label class="f"><span>Mode carrière : la difficulté du niveau s'applique</span><input id="gCareer" type="checkbox"></label>
      <p id="gGoal" class="gGoal"></p>
      <div id="gProg"></div>
      <p class="muted" id="gNext"></p>
      <p class="muted">Arme la séance pour lancer le défi. ARRÊT ou désarmer l'interrompt simplement : aucune pénalité.</p>
      <details class="sub" id="gEdit"><summary>✏️ Personnaliser les objectifs par niveau</summary>
        <p class="muted">Modifie les valeurs du niveau 1 et du niveau 20 : les niveaux intermédiaires suivent la progression. Tu peux aussi imposer la valeur d'un niveau précis (en couleur). Objectif à 0 = désactivé. S'applique au prochain défi.</p>
        <div class="gTblWrap"><table class="gTbl" id="gTbl"></table></div>
        <div class="row"><button id="gSmooth">Lisser (effacer les niveaux imposés)</button><button id="gDefault">Valeurs d'origine</button></div>
      </details>
      <div class="row"><button id="gReset">Remettre ma progression à zéro</button></div></div>`;
    $("gCareer").checked = this.career;
    $("gCareer").onchange = () => { store.set("career:" + app, $("gCareer").checked); this.applyLevel(); this.render(); };
    $("gReset").onclick = async () => {
      const ok = await confirmDialog({ title: "Remettre à zéro ?", html: `<p>La progression de <b>${GAME_APPS[app]}</b> repartira du niveau 1.</p>`, check: "Je veux repartir du niveau 1", ok: "Remettre à zéro" });
      if (!ok) return; this.data[app] = null; this.get(app); this.save(); this.applyLevel(); this.render(); log("🏆 Progression remise à zéro.");
    };
    $("gSmooth").onclick = () => { Career.smooth(app); this.changed("niveaux imposés effacés"); };
    $("gDefault").onclick = async () => {
      const ok = await confirmDialog({ title: "Valeurs d'origine ?", html: `<p>Tous les objectifs personnalisés de <b>${GAME_APPS[app]}</b> seront effacés.</p>`, ok: "Rétablir" });
      if (ok) { Career.reset(app); this.changed("valeurs d'origine rétablies"); }
    };
    $("gEdit").addEventListener("toggle", () => { if ($("gEdit").open) this.buildTable(); });
    this.applyLevel(); this.render();
    setInterval(() => this.render(), 500);
    // toucher un réglage grisé par la carrière : explique et ouvre l'éditeur des niveaux
    document.addEventListener("click", e => {
      const l = e.target.closest && e.target.closest("label.f"); if (!l || l.closest("#secGame")) return;
      const i = l.querySelector("input:disabled,select:disabled"); if (!i || !/carrière/.test(i.title || "")) return;
      toast("🔒 Réglé par la carrière", "Décoche « Mode carrière » pour le modifier librement, ou change la valeur du niveau dans « Personnaliser les objectifs ».", "#ffd166");
      $("secGame").open = true; $("gEdit").open = true; setTimeout(() => $("gEdit").scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    });
  },
  applyLevel(){ if (this.hooks.apply && !this.run) this.hooks.apply(this.params(), this.career); },
  changed(what){
    log("🏆 Objectifs de carrière : " + what + ".");
    this.applyLevel(); this.render(); if ($("gEdit") && $("gEdit").open) this.buildTable();
    if (typeof Partner !== "undefined") Partner.send(true);
  },

  /* Tableau éditable : une ligne par niveau, une colonne par paramètre */
  buildTable(){
    const app = this.app, t = $("gTbl"); if (!t) return;
    const cur = this.get(app).lvl;
    let h = "<thead><tr><th>Niv.</th>" + SPEC[app].map(s => `<th title="${s.l}">${s.goal ? "🎯 " : ""}${s.s}${s.u ? `<br><small>${s.u}</small>` : ""}</th>`).join("") + "</tr></thead><tbody>";
    for (let n = 1; n <= MAX_LVL; n++) {
      h += `<tr class="${n === cur ? "cur" : ""}"><td>${n}${n === cur ? " ◀" : ""}</td>` + SPEC[app].map(s =>
        `<td><input type="number" data-k="${s.k}" data-n="${n}" min="${s.min}" max="${s.max}" step="${s.st || 1}" value="${Career.value(app, s.k, n)}" class="${Career.isCustom(app, s.k, n) ? "cust" : ""}${n === 1 || n === MAX_LVL ? " end" : ""}"></td>`).join("") + "</tr>";
    }
    t.innerHTML = h + "</tbody>";
    t.querySelectorAll("input").forEach(i => i.onchange = () => {
      Career.set(app, i.dataset.k, +i.dataset.n, i.value);
      this.changed(`${Career.spec(app, i.dataset.k).l} niveau ${i.dataset.n} → ${Career.value(app, i.dataset.k, +i.dataset.n)}`);
    });
  },

  /* ----- cycle d'un défi ----- */
  start(){
    if (!this.career || this.run) return;
    this.applyLevel();
    const g = this.get(this.app); g.tries++; this.save();
    this.run = { lvl: g.lvl, p: this.params(), prog: {}, extra: 0, lost: 0, xp: 0, won: false, t0: Date.now() };
    if (!this.goals().some(s => this.run.p[s.k] > 0)) this.run.p.goal = 1;     // au moins un objectif
    log(`🏆 Défi niveau ${g.lvl} lancé : ${DESCR[this.app](this.run.p).replace(/<[^>]+>/g, "")}`);
    beep(880, 100, 2);
  },
  /* progression d'un objectif (k = "goal" par défaut). Quand tous sont atteints, le défi est « atteint »
     mais le niveau n'est validé qu'à la FIN de la série (désarmement), et seulement si elle n'a pas été perdue. */
  progress(v, k = "goal"){
    const r = this.run; if (!r || r.won) return;
    r.prog[k] = v;
    if (!r.reached && this.goals().every(s => !(r.p[s.k] > 0) || (r.prog[s.k] || 0) >= this.target(s.k))) {
      r.reached = true;
      log("🎯 Objectif du défi atteint : le niveau sera validé à la fin de la série (fin de séance ou désarmement).");
      toast("🎯 Objectif atteint", "le niveau sera validé à la fin de la série", "#ffd166"); beep(1175, 90, 2);
      if (typeof Partner !== "undefined") Partner.send(true);
    }
  },
  /* temps supplémentaire à tenir (pénalité ou ajout du Maître) */
  addGoal(sec){ if (this.run && !this.run.won && sec > 0) { this.run.extra += sec; this.run.reached = false; } },
  xp(n){ if (this.run) this.run.xp += n; },
  loseLife(){
    const r = this.run; if (!r || r.won) return;
    r.lost++;
    if (r.lost > r.p.lives) this.fail("plus de vies");
    else { const left = r.p.lives - r.lost; log(`💔 Vie perdue : ${left} vie${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""}.`); beep(330, 200); }
  },
  win(){
    const r = this.run, g = this.get(this.app); if (!r || r.won) return;
    r.won = true; g.wins++;
    const before = g.lvl; if (g.lvl < MAX_LVL) g.lvl++;
    r.xp += 100 * before;
    this.last = { app: this.app, ok: true, lvl: before, to: g.lvl, at: Date.now() };
    g.hist.unshift({ at: new Date().toISOString(), lvl: before, ok: true }); g.hist = g.hist.slice(0, 30);
    this.save();
    toast(`🏆 Défi réussi ! Niveau ${g.lvl}`, before < MAX_LVL ? "la difficulté augmente" : "niveau maximum atteint 👑", "#ffd166");
    log(`🏆 Défi niveau ${before} réussi ! Tu passes au niveau ${g.lvl}.`); beep(1320, 120, 4);
    if (typeof Speak !== "undefined") Speak.say("Défi réussi. Niveau " + g.lvl);
    if (typeof Partner !== "undefined") Partner.send(true);
  },
  fail(reason){
    const r = this.run; if (!r || r.won) return this.end();
    const g = this.get(this.app);
    this.last = { app: this.app, ok: false, lvl: r.lvl, why: reason, at: Date.now() };
    g.hist.unshift({ at: new Date().toISOString(), lvl: r.lvl, ok: false, why: reason }); g.hist = g.hist.slice(0, 30);
    this.save();
    toast("Défi non réussi", reason + " — réessaie quand tu veux", "var(--mute)");
    log(`🏆 Défi niveau ${r.lvl} non réussi (${reason}). Aucune pénalité.`);
    if (typeof Partner !== "undefined") Partner.send(true);
    this.end(true);
  },
  /* fin de séance : crédite l'XP gagnée */
  end(silent){
    const r = this.run; if (!r) return;
    if (!silent && r.reached && !r.won) this.win();   // fin de série avec les objectifs atteints : niveau validé
    this.run = null;
    if (!r.won && !silent) {
      const g = this.get(this.app);
      this.last = { app: this.app, ok: false, lvl: r.lvl, why: "interrompu", at: Date.now() };
      g.hist.unshift({ at: new Date().toISOString(), lvl: r.lvl, ok: false, why: "interrompu" }); g.hist = g.hist.slice(0, 30);
      log("🏆 Défi interrompu : aucune pénalité.");
    }
    const g = this.get(this.app); g.xp += Math.round(r.xp); this.save();
    if (r.xp >= 1) log(`✨ +${Math.round(r.xp)} XP`);
    this.applyLevel();          // le niveau suivant s'applique à la prochaine séance
    if (typeof Partner !== "undefined") Partner.send(true);
  },
  /* Texte court de l'avancement (« 45/120 s · 3/10× ») */
  progText(){
    const r = this.run; if (!r) return "";
    if (r.won) return "réussi ✅";
    if (r.reached) return "objectif atteint ✅ · termine la série";
    return this.goals().filter(s => r.p[s.k] > 0).map(s => `${Math.floor(r.prog[s.k] || 0)}/${this.target(s.k)} ${s.u}`).join(" · ");
  },

  render(){
    if (!$("gLvl")) return;
    const g = this.get(this.app), p = this.params(), r = this.run;
    $("gLvl").textContent = `Niveau ${g.lvl}${g.lvl >= MAX_LVL ? " 👑" : ""}`;
    $("gRank").textContent = " · " + rankOf(g.lvl);
    $("gStats").textContent = `${g.wins} victoire${g.wins > 1 ? "s" : ""} · ${g.tries} essai${g.tries > 1 ? "s" : ""} · ${g.xp} XP`;
    $("gSum").textContent = `Niv. ${g.lvl}` + (r ? " · " + (r.won ? "✅ réussi" : r.reached ? "🎯 atteint" : "défi " + this.progText()) : "");
    $("gGoal").innerHTML = (this.career ? "🎯 " : "🎯 (mode libre : pas de défi) ") + DESCR[this.app](r ? r.p : p, r ? r.extra : 0);
    const gp = $("gProg");
    if (!r) { gp.innerHTML = ""; gp.dataset.k = ""; }
    else {
      const G = this.goals().filter(s => r.p[s.k] > 0), key = G.map(s => s.k).join();
      if (gp.dataset.k !== key) { gp.dataset.k = key; gp.innerHTML = G.map(s => `<div class="stat"><span>${s.s}</span><div class="meter"><div class="warnC" data-b="${s.k}"></div></div><span data-v="${s.k}">—</span></div>`).join(""); }
      for (const s of G) {
        const v = r.prog[s.k] || 0, t = this.target(s.k);
        gp.querySelector(`[data-b="${s.k}"]`).style.width = clamp(v / t * 100, 0, 100) + "%";
        gp.querySelector(`[data-v="${s.k}"]`).textContent = r.won || v >= t ? "✅" : `${Math.floor(v)}/${t}`;
      }
    }
    $("gNext").innerHTML = g.lvl < MAX_LVL ? "Niveau suivant : " + DESCR[this.app](Career.params(this.app, g.lvl + 1)) : "Niveau maximum atteint 👑";
    const h = document.querySelector("header h1");
    if (h) { let s = h.querySelector(".lvlTag"); if (!s) { s = document.createElement("span"); s.className = "lvlTag"; h.appendChild(s); } s.textContent = "Niv. " + g.lvl; }
    const d = $("gDock");
    if (d) {
      d.classList.toggle("hidden", !r);
      if (r) d.innerHTML = `🏆 Défi niv. ${r.lvl} : <b>${this.progText()}</b>` + (r.extra && !r.won ? ` <small>(+${r.extra} s)</small>` : "")
        + ((this.app === "motion" || this.app === "making") && !r.won ? ` · ${"❤️".repeat(Math.max(0, r.p.lives - r.lost))}${"🖤".repeat(Math.min(r.p.lives, r.lost))}` : "");
    }
  },

  /* ----- Maître (Master/Sub) : lecture / modification des objectifs à distance ----- */
  remoteSchema(app){ return SPEC[app] ? { t: "gcfg", app, lvl: this.get(app).lvl, rows: Career.schema(app) } : null; },
  remoteSet(m){
    const app = m.app; if (!SPEC[app]) return;
    if (m.k === "_lvl") {
      const g = this.get(app), n = clamp(Math.round(+m.v || 1), 1, MAX_LVL); if (g.lvl === n) return;
      g.lvl = n; this.save(); log(`👑 Le Maître place ${GAME_APPS[app]} au niveau ${n}.`);
    } else if (m.k === "_reset") { Career.reset(app); log(`👑 Le Maître rétablit les objectifs d'origine de ${GAME_APPS[app]}.`); }
    else {
      const s = Career.spec(app, m.k); if (!s) return;
      if (m.a != null) Career.set(app, m.k, 1, m.a);
      if (m.b != null) Career.set(app, m.k, MAX_LVL, m.b);
      log(`👑 Objectif « ${s.l} » : niveau 1 = ${Career.value(app, m.k, 1)} ${s.u}, niveau 20 = ${Career.value(app, m.k, MAX_LVL)} ${s.u}.`);
    }
    if (app === this.app) { this.applyLevel(); this.render(); if ($("gEdit") && $("gEdit").open) this.buildTable(); }
  },
};
