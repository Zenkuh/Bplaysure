/* ======================================================================
 * Cartes de l'Obedience Deck (partagé par la page du porteur et la
 * télécommande). Une carte : { k: type, d: durée s, n: nombre, lo, hi : %
 * intensité min/max } — l'intensité réelle est tirée au hasard au moment
 * où la carte tombe (personne ne la connaît à l'avance).
 * ====================================================================== */
"use strict";
const CARD_TYPES = {
  still:  { t: "Immobile",              i: "🧊", out: "stim", f: ["d", "lo", "hi"], dd: 45, dlo: 8,  dhi: 20, help: "Ne pas bouger (gyroscope du téléphone) ; chaque mouvement = shock." },
  zaps:   { t: "Shocks croissants",     i: "⚡", out: "stim", f: ["n", "lo", "hi"], dn: 5,  dlo: 8,  dhi: 25, help: "N shocks de plus en plus forts, à encaisser." },
  reward: { t: "Vague de récompense",   i: "🌊", out: "vib",  f: ["d", "lo", "hi"], dd: 60, dlo: 40, dhi: 90, help: "Vibration en vagues." },
  tease:  { t: "Tease",                 i: "🪶", out: "vib",  f: ["d", "lo", "hi"], dd: 45, dlo: 30, dhi: 70, help: "Vibrations irrégulières, frustrantes." },
  mix:    { t: "Distraction + frappes", i: "🌀", out: "vib",  f: ["d", "lo", "hi"], dd: 40, dlo: 50, dhi: 90, help: "Vibration forte et shocks à des moments imprévisibles." },
  pause:  { t: "Pause",                 i: "⏸️", out: null,   f: ["d"],             dd: 15, help: "Rien… le temps d'attendre la suite." },
};
const rnd = (a, b) => a + Math.random() * (b - a);
const DeckCards = {
  clean(c){
    if (!c || !CARD_TYPES[c.k]) return null;
    const T = CARD_TYPES[c.k], o = { k: c.k };
    if (T.f.includes("d")) o.d = clamp(Math.round(+c.d || T.dd), 3, 1800);
    if (T.f.includes("n")) o.n = clamp(Math.round(+c.n || T.dn), 1, 50);
    if (T.f.includes("lo")) { o.lo = clamp(Math.round(+c.lo || 0), 0, 100); o.hi = clamp(Math.round(+c.hi || o.lo), o.lo, 100); }
    return o;
  },
  /* tire les valeurs réelles */
  resolve(c, mixLo = 8, mixHi = 20){
    const r = { d: c.d || 0, seed: Math.random() * 100 };
    if (c.k === "zaps") {
      const mid = (c.lo + c.hi) / 2, a = rnd(c.lo, mid), b = rnd(mid, c.hi);
      r.n = c.n; r.lv = Array.from({ length: c.n }, (_, k) => Math.round(c.n > 1 ? a + (b - a) * k / (c.n - 1) : b));
      r.gap = Math.round(rnd(1200, 2600)); r.i = r.lv[r.lv.length - 1];
    } else if (c.lo != null) r.i = Math.round(rnd(c.lo, c.hi));
    if (c.k === "mix") r.zl = () => Math.round(rnd(mixLo, mixHi));
    return r;
  },
  random(n, mx, stim = true, vib = true){
    const pool = Object.keys(CARD_TYPES).filter(k => { const o = CARD_TYPES[k].out; return o === null || (o === "stim" ? stim : vib); });
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = pool[Math.floor(Math.random() * pool.length)], T = CARD_TYPES[k];
      const lo = Math.round(rnd(5, mx * 0.5)), hi = Math.round(rnd(lo + 5, Math.max(lo + 5, mx)));
      out.push(this.clean({ k, d: Math.round(rnd(0.5, 1.5) * (T.dd || 20)), n: Math.round(rnd(3, 8)), lo: Math.min(lo, 100), hi: Math.min(hi, 100) }));
    }
    return out;
  },
  title: c => CARD_TYPES[c.k].t,
  icon: c => CARD_TYPES[c.k].i,
  label(c, r){
    const T = CARD_TYPES[c.k], v = r ? (r.i != null ? ` · ${r.i} %` : "") : (c.lo != null ? ` · ${c.lo}–${c.hi} %` : "");
    return `${T.i} ${T.t}` + (c.k === "zaps" ? ` ×${c.n}` : ` ${c.d} s`) + v;
  },
  say(c, r){
    if (c.k === "still") return `Immobile. ${c.d} secondes`;
    if (c.k === "zaps") return `${c.n} shocks. Encaisse`;
    if (c.k === "reward") return "Récompense";
    if (c.k === "tease") return "Tease";
    if (c.k === "mix") return "Ne te laisse pas distraire";
    return "Attends";
  },
  /* petit formulaire de création de carte */
  builder(el){
    el.innerHTML = `<label class="f"><span>Carte</span><select data-f="k">${Object.entries(CARD_TYPES).map(([k, T]) => `<option value="${k}">${T.i} ${T.t}</option>`).join("")}</select></label>
      <p class="muted" data-f="help"></p>
      <label class="f" data-w="d"><span>Durée (s)</span><input data-f="d" type="number" min="3" max="1800"></label>
      <label class="f" data-w="n"><span>Nombre de shocks</span><input data-f="n" type="number" min="1" max="50"></label>
      <label class="f" data-w="lo"><span>Intensité de (%)</span><input data-f="lo" type="number" min="0" max="100"></label>
      <label class="f" data-w="hi"><span>… à (%), tirée au hasard</span><input data-f="hi" type="number" min="0" max="100"></label>`;
    const q = f => el.querySelector(`[data-f="${f}"]`), sel = q("k");
    const upd = () => { const T = CARD_TYPES[sel.value]; q("help").textContent = T.help; ["d", "n", "lo", "hi"].forEach(f => { el.querySelector(`[data-w="${f}"]`).classList.toggle("hidden", !T.f.includes(f)); const v = T["d" + f]; if (v != null) q(f).value = v; }); };
    sel.onchange = upd; upd();
  },
  read(el){ const q = f => el.querySelector(`[data-f="${f}"]`); return this.clean({ k: q("k").value, d: q("d").value, n: q("n").value, lo: q("lo").value, hi: q("hi").value }); },
};
