/* ======================================================================
 * Télécommande : panneaux propres à certains modes
 *  - 🃏 Obedience Deck : composer un paquet de cartes cachées
 *  - 🧠 Mind Games : choisir le code du Master Mind, donner des indices, composer un Simon
 *  - 👁️ Eye Contact : messages et distraction en plein écran
 * Utilise peer, live(), cmd() de remote.html et DeckCards (deckcards.js).
 * ====================================================================== */
"use strict";
const AppPanel = {
  kind: null, draft: [], simon: [],
  send(d, msg){ cmd({ t: "app", d }, msg); },
  render(){
    const full = peer && peer.perm && peer.perm.full;
    const a = live() && peer.app && full ? peer.app : null, k = a && this["build_" + a.kind] ? a.kind : null;
    $("secApp").classList.toggle("hidden", !k);
    if (k !== this.kind) {
      this.kind = k; if (k) this["build_" + k]();
    }
    if (k && this["upd_" + k]) this["upd_" + k](a);
  },

  /* ---------------- 👁️ Eye Contact ---------------- */
  build_eyes(){
    $("appTitle").innerHTML = "👁️ Distraction plein écran <small id='appSum'></small>";
    $("appBody").innerHTML = `<div class="row"><button id="eyFs" class="primary">🌀 Ouvrir le plein écran</button></div>
      <label class="f"><span>Contenu</span><select id="eyMode"><option value="mix">🔀 Mélange</option><option value="spiral">🌀 Spirale</option><option value="orbs">🔮 Orbes</option><option value="words">💬 Mots</option><option value="photos">🖼️ Sa galerie</option></select></label>
      <label class="f"><span>Message à afficher en grand</span><input id="eyMsg" type="text" maxlength="60" placeholder="ex. Ne cligne pas" style="max-width:50vw"></label>
      <div class="row"><button id="eySend">💬 Afficher</button><button id="eyQuick">👁️ « Regarde-moi »</button></div>
      <p class="muted">Le message reste 8 s au centre de son écran (lu à voix haute si le plein écran est fermé).</p>`;
    $("eyFs").onclick = () => { const on = !(peer.app && peer.app.fs); this.send({ op: "fs", on }, on ? "🌀 Plein écran ouvert." : "Plein écran fermé."); };
    $("eyMode").onchange = () => this.send({ op: "mode", mode: $("eyMode").value }, "🌀 Distraction changée.");
    $("eySend").onclick = () => { const t = $("eyMsg").value.trim(); if (!t) return; this.send({ op: "msg", text: t }, "💬 Message envoyé."); $("eyMsg").value = ""; };
    $("eyQuick").onclick = () => this.send({ op: "msg", text: "Regarde-moi" }, "💬 « Regarde-moi » envoyé.");
  },
  upd_eyes(a){
    $("eyFs").textContent = a.fs ? "🖥️ Fermer le plein écran" : "🌀 Ouvrir le plein écran";
    if (document.activeElement !== $("eyMode") && a.mode) $("eyMode").value = a.mode;
    $("appSum").textContent = a.fs ? "affiché" : "fermé";
  },

  /* ---------------- 🃏 Obedience Deck ---------------- */
  build_deck(){
    $("appTitle").innerHTML = "🃏 Paquet de cartes <small id='appSum'></small>";
    $("appBody").innerHTML = `<p class="muted" id="dkState"></p>
      <div id="dkBuilder"></div>
      <div class="row"><button id="dkAdd">+ Ajouter au paquet</button></div>
      <div id="dkDraft"></div>
      <div class="row"><button id="dkSend" class="primary">📤 Envoyer le paquet</button><button id="dkDrop">Effacer le brouillon</button></div>
      <hr style="border-color:var(--line)">
      <label class="f"><span>Paquet surprise : cartes</span><input id="dkN" type="number" min="1" max="30" value="5"></label>
      <label class="f"><span>… intensité max (%)</span><input id="dkMax" type="number" min="1" max="100" value="50"></label>
      <div class="row"><button id="dkRnd">🎲 Envoyer un paquet surprise</button><button id="dkClear">🗑️ Vider chez le Sub</button></div>
      <p class="muted">Le Sub ne voit jamais le contenu. Les intensités sont tirées au hasard dans tes fourchettes au moment où chaque carte tombe : toi non plus ne les connais pas avant.</p>`;
    DeckCards.builder($("dkBuilder"));
    $("dkAdd").onclick = () => { const c = DeckCards.read($("dkBuilder")); if (c) { this.draft.push(c); this.drawDraft(); } };
    $("dkDrop").onclick = () => { this.draft = []; this.drawDraft(); };
    $("dkSend").onclick = () => { if (!this.draft.length) return; this.send({ op: "add", cards: this.draft }, `🃏 Paquet de ${this.draft.length} carte(s) envoyé.`); this.draft = []; this.drawDraft(); };
    $("dkRnd").onclick = () => { const c = DeckCards.random(clamp(num("dkN"), 1, 30), clamp(num("dkMax"), 1, 100)); this.send({ op: "add", cards: c }, `🎲 Paquet surprise de ${c.length} cartes envoyé.`); };
    $("dkClear").onclick = () => this.send({ op: "clear" }, "🗑️ Paquet vidé chez le Sub.");
    this.drawDraft();
  },
  drawDraft(){
    const box = $("dkDraft"); if (!box) return;
    box.innerHTML = this.draft.length ? "" : '<p class="muted">Brouillon vide.</p>';
    this.draft.forEach((c, i) => { const r = document.createElement("div"); r.className = "cardRow"; r.innerHTML = `<span>${i + 1}. ${DeckCards.label(c)}</span><button>✕</button>`; r.querySelector("button").onclick = () => { this.draft.splice(i, 1); this.drawDraft(); }; box.appendChild(r); });
    $("dkSend").textContent = `📤 Envoyer le paquet (${this.draft.length})`;
  },
  upd_deck(a){
    $("dkState").textContent = `Chez le Sub : ${a.queue} carte${a.queue > 1 ? "s" : ""} en attente` + (a.running ? " · 🔒 paquet en cours" : "") + (a.pen ? " · 😈 pénalité de brat" : "");
    $("appSum").textContent = a.running ? "en cours" : a.queue + " en attente";
  },

  /* ---------------- 🧠 Mind Games ---------------- */
  build_mind(){
    $("appTitle").innerHTML = "🧠 Mind Games <small id='appSum'></small>";
    $("appBody").innerHTML = `<div id="mdCode">
        <p class="muted" id="mdCodeState"></p>
        <div class="row"><input id="mdCodeIn" type="text" inputmode="numeric" maxlength="10" placeholder="Code (2 à 10 chiffres)" style="flex:1"><button id="mdCodeSet" class="primary">Définir</button></div>
        <div class="row"><button id="mdReveal">💡 Indice (un chiffre en transparent)</button></div>
      </div>
      <div id="mdSimon">
        <p class="muted">Compose la prochaine séquence Simon (sinon elle est tirée au hasard) :</p>
        <div class="grid2" id="mdPads"></div>
        <p id="mdSeq" style="font-size:22px;letter-spacing:4px;min-height:1.3em"></p>
        <div class="row"><button id="mdSimSend" class="primary">📤 Envoyer</button><button id="mdSimClear">Effacer</button></div>
      </div>
      <p class="muted" id="mdSeqInfo">Séquence dictée : les chiffres sont tirés au hasard et dictés dans l'écouteur du Sub.</p>`;
    const Z = [["🔴", "#e63946"], ["🟢", "#2a9d8f"], ["🔵", "#457bfd"], ["🟡", "#ffd166"]];
    Z.forEach(([e, c], z) => { const b = document.createElement("button"); b.textContent = e; b.style.borderColor = c; b.onclick = () => { if (this.simon.length < 10) this.simon.push(z); this.drawSimon(); }; $("mdPads").appendChild(b); });
    $("mdSimClear").onclick = () => { this.simon = []; this.drawSimon(); };
    $("mdSimSend").onclick = () => { if (this.simon.length < 2) return; this.send({ op: "simon", seq: this.simon }, `🎵 Séquence Simon de ${this.simon.length} envoyée.`); this.simon = []; this.drawSimon(); };
    $("mdCodeSet").onclick = () => { const v = $("mdCodeIn").value.replace(/\D/g, ""); if (v.length < 2) return log("Le code doit avoir au moins 2 chiffres."); this.send({ op: "code", code: v }, `🔐 Code de ${v.length} chiffres défini.`); $("mdCodeIn").value = ""; };
    $("mdReveal").onclick = () => cmd({ t: "action", id: "reveal" }, "💡 Indice envoyé.");
    this.drawSimon();
  },
  drawSimon(){ const e = $("mdSeq"); if (e) e.textContent = this.simon.map(z => ["🔴", "🟢", "🔵", "🟡"][z]).join(" ") || "—"; },
  upd_mind(a){
    $("mdCode").classList.toggle("hidden", a.game !== "code");
    $("mdSimon").classList.toggle("hidden", a.game !== "simon");
    $("mdSeqInfo").classList.toggle("hidden", a.game !== "seq");
    $("appSum").textContent = { code: "Master Mind", simon: "Simon", seq: "séquence" }[a.game] || "";
    if (a.game === "code") $("mdCodeState").textContent = a.code ? `Code actuel : ${a.code} · essai ${a.tries || 0}/${a.maxTries || "?"} · ${a.rev} indice${a.rev > 1 ? "s" : ""}` : "Aucun code en cours (un code au hasard sera tiré si tu n'en définis pas).";
  },
};
setInterval(() => AppPanel.render(), 500);
