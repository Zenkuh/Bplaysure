/* ======================================================================
 * Mises à jour : au lancement (menu), l'appli regarde la dernière version
 * publiée sur GitHub Releases. Si elle est plus récente, un bandeau propose
 * de la télécharger et de l'installer (l'installeur d'Android demande
 * confirmation). Dépôt réglable dans « ℹ️ À propos & mises à jour ».
 * Nécessite common.js.
 * ====================================================================== */
"use strict";

const UPDATE_REPO_DEFAULT = "Zenkuh/Bplaysure";   // « propriétaire/dépôt » GitHub des versions

const Update = {
  cur: null, rel: null, state: "idle",
  get repo(){ return (store.get("bpUpdRepo", UPDATE_REPO_DEFAULT) || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, ""); },
  get auto(){ return store.get("bpUpdAuto", true); },
  version(){
    if (this.cur) return this.cur;
    try { if (NATIVE && window.AndroidBridge.appVersion) this.cur = JSON.parse(window.AndroidBridge.appVersion()); } catch {}
    return this.cur || { name: "?", code: 0 };
  },
  /* « v2.10.1 » > « 2.9 » */
  newer(a, b){
    const p = s => String(s || "").replace(/^[^\d]*/, "").split(/[^\d]+/).filter(Boolean).map(Number);
    const x = p(a), y = p(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
    return false;
  },
  async check(manual){
    const repo = this.repo;
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { if (manual) this.info("Indique d'abord le dépôt GitHub (propriétaire/dépôt)."); return; }
    this.info("Recherche d'une nouvelle version…");
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (r.status === 404) throw new Error("aucune version publiée (ou dépôt privé / introuvable)");
      if (!r.ok) throw new Error("GitHub a répondu " + r.status);
      const j = await r.json();
      const apk = (j.assets || []).find(a => /\.apk$/i.test(a.name));
      if (!apk) throw new Error(`la version ${j.tag_name} ne contient pas d'APK`);
      store.set("bpUpdLast", Date.now());
      const cur = this.version().name;
      if (!this.newer(j.tag_name, cur)) { this.info(`✅ Tu as la dernière version (${cur}).`); this.show(null); return; }
      this.rel = { tag: j.tag_name, name: j.name || j.tag_name, notes: (j.body || "").trim(), url: apk.browser_download_url, size: apk.size, date: j.published_at };
      this.info(`🆕 Version ${j.tag_name} disponible.`);
      if (!manual && store.get("bpUpdSkip", "") === j.tag_name) return;      // « ignorer cette version »
      this.show(this.rel);
    } catch (e) { this.info("⚠ Vérification impossible : " + e.message); }
  },
  show(rel){
    const box = $("updBox"); if (!box) return;
    box.classList.toggle("hidden", !rel); if (!rel) return;
    $("updTitle").textContent = `🆕 BPlaysure ${rel.tag} est disponible`;
    $("updSub").textContent = `Tu as la ${this.version().name} · ${(rel.size / 1048576).toFixed(1)} Mo` + (rel.date ? " · publiée le " + new Date(rel.date).toLocaleDateString() : "");
    $("updNotes").textContent = rel.notes.length > 900 ? rel.notes.slice(0, 900) + "…" : rel.notes;
    $("updNotes").classList.toggle("hidden", !rel.notes);
    $("updProg").classList.add("hidden"); $("updMsg").textContent = "";
    $("updGo").disabled = false; $("updGo").textContent = "⬇️ Mettre à jour";
  },
  go(){
    const r = this.rel; if (!r) return;
    if (!NATIVE || !window.AndroidBridge.updateDownload) { location.href = r.url; return; }
    if (App.armed) return toast("Mise à jour", "arrête d'abord la séance", "var(--warn)");
    this.state = "dl"; $("updGo").disabled = true; $("updGo").textContent = "Téléchargement…";
    $("updProg").classList.remove("hidden"); $("updBar").style.width = "0%";
    nativeCall("updateDownload", r.url, r.tag);
  },
  onNative(o){
    const m = $("updMsg");
    if (o.st === "dl") { $("updBar").style.width = (o.p >= 0 ? o.p : 50) + "%"; m.textContent = o.p >= 0 ? o.p + " %" : o.mb.toFixed(1) + " Mo"; return; }
    $("updGo").disabled = false;
    if (o.st === "perm") { m.textContent = "🔐 Autorise BPlaysure à installer des applis, puis reviens : l'installation reprendra."; $("updGo").textContent = "Réessayer l'installation"; $("updGo").onclick = () => nativeCall("updateInstall"); }
    else if (o.st === "install") { m.textContent = "📦 Confirme l'installation dans la fenêtre d'Android. Tes réglages et ta progression sont conservés."; $("updGo").textContent = "Relancer l'installation"; $("updGo").onclick = () => nativeCall("updateInstall"); }
    else if (o.st === "err") { m.textContent = "⚠ " + o.msg; $("updGo").textContent = "⬇️ Réessayer"; $("updGo").onclick = () => this.go(); $("updProg").classList.add("hidden"); }
  },
  info(t){ const e = $("updInfo"); if (e) e.textContent = t; },
  init(){
    if (!$("updBox")) return;
    $("verCur").textContent = this.version().name + (this.version().code ? ` (${this.version().code})` : "");
    $("updRepo").value = this.repo; $("updAuto").checked = this.auto;
    $("updRepo").onchange = () => { store.set("bpUpdRepo", $("updRepo").value.trim()); $("updRepo").value = this.repo; this.check(true); };
    $("updAuto").onchange = () => store.set("bpUpdAuto", $("updAuto").checked);
    $("updCheck").onclick = () => this.check(true);
    $("updGo").onclick = () => this.go();
    $("updLater").onclick = () => this.show(null);
    $("updSkip").onclick = () => { if (this.rel) store.set("bpUpdSkip", this.rel.tag); this.show(null); this.info(`Version ${this.rel.tag} ignorée (« Vérifier maintenant » pour la retrouver).`); };
    onNative("upd", v => { try { this.onNative(JSON.parse(v)); } catch {} });
    if (!NATIVE) { this.info("Version web : toujours à jour (elle suit automatiquement la dernière version publiée)."); return; }
    // au lancement de l'appli (une fois par démarrage, et au plus toutes les 3 h)
    const fresh = !sessionStorage.getItem("bpUpdDone"), last = store.get("bpUpdLast", 0);
    if (this.auto && this.repo && (fresh || Date.now() - last > 3 * 3600e3)) { sessionStorage.setItem("bpUpdDone", "1"); setTimeout(() => this.check(false), 1200); }
    else if (!this.repo) this.info("Indique le dépôt GitHub où sont publiées les versions.");
  },
};
