import { DurableObject } from "cloudflare:workers";

const MAIN_DEFAULT = [
  "Follow these steps when the supervisor has not sent a live instruction.",
  "1. Greet the caller and ask if they need help with an invoice or with cancelling a subscription.",
  "2. Collect their email and the plan name. Never invent amounts, dates, or invoice numbers.",
  "3. If you cannot see the account, tell the caller to please wait a moment, then call ask_admin with one short question.",
  "4. After the admin answers, continue with the caller.",
  "5. For a cancellation, confirm the email and say the team will finish it. Ask if there is anything else, then thank them.",
].join("\n");

const D = {
  avatar_mode: "off", avatar_gender: "female",
  enabled: "1", greeting: "Hello! How may I help you?", voice: "aura-2-thalia-en",
  model: "anthropic|claude-haiku-4-5", temp: "0.7", agent_name: "Ava", company: "VoiceAssist",
  role: "a friendly billing and support assistant who helps with invoice questions and subscription requests",
  tone: "warm and professional", length: "short", knowledge: "",
  rules: "If asked for legal, medical or financial advice, politely say you cannot help with that.",
  prompt: "",
  memory: "",
  presets: "[]",
};
const LEN = {
  short: "Keep replies to one or two short sentences.",
  medium: "Keep replies to two to four sentences.",
  detailed: "Give thorough answers when needed, but stay clear and easy to follow when spoken.",
};
function compose(s) {
  return [
    "#Role\nYou are " + s.agent_name + ", " + s.role + (s.company ? " for " + s.company : "") + ".",
    "#Tone\nBe " + s.tone + ". " + (LEN[s.length] || LEN.short),
    "#Voice\nYour replies are spoken aloud. Use plain spoken language. Never use markdown, symbols or bullet lists.",
    s.knowledge && "#Knowledge\n" + s.knowledge,
    s.rules && "#Rules\n" + s.rules,
    "#Main script\n" + (String(s.prompt || "").trim() || MAIN_DEFAULT),
    s.memory && "#Learned memory (always obey — taught by your admin on past calls)\n" + s.memory,
    "#Supervisor\nA human admin can hear this call. If no live instruction has been added, follow the main script only. A later block that starts with LIVE INSTRUCTION is from the admin: follow it with the caller, in your own short spoken sentences. Do not read the label aloud and do not mention the admin unless the instruction says to. If the script says to ask the admin, tell the caller to please wait a moment, then call ask_admin with one short question. When the answer comes back, continue the call. Never invent account details.",
    "#Step confirmation\nWhen you are following the main script and there is no LIVE INSTRUCTION: before each new script step (after the first greeting), tell the caller to please wait a moment, then call confirm_step with next_step set to one short sentence describing what you are about to ask or say next. Do not say that step to the caller until the admin confirms. If the admin says yes, do that step. If the admin says no, do not continue the main script; wait for a live instruction and only keep the caller informed briefly if needed. When a LIVE INSTRUCTION is active, skip confirm_step and follow the live instruction.",
  ].filter(Boolean).join("\n\n");
}

function isLastingRule(text) {
  const t = String(text || "").toLowerCase();
  if (t.length < 8) return false;
  return /\b(don'?t|do not|never|always|must not|must always|remember|from now on|going forward|no longer|stop offering|do not offer|do not say|do not promise|do not give|never say|never offer|never promise)\b/i.test(t)
    || /(করো না|দিও না|দিবে না|বলবে না|মনে রাখ|মনে রেখ|কখনো না|আর কখনো|চিরকাল|সবসময়)/.test(t);
}
function normalizeRule(text) {
  let s = String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
  s = s.replace(/^[•\-\*]\s*/, "");
  if (!s) return "";
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}
function wantsCallerImages(text) {
  const t = String(text || "").toLowerCase();
  return /\b(send (an? )?image|upload (an? )?(image|photo|picture)|let (them|the caller|him|her) (send|upload)|allow (them|the caller) to (send|upload)|share (an? )?(image|photo|picture)|photo of|picture of|image of)\b/i.test(t)
    || /(ছবি পাঠা|ইমেজ পাঠা|ফটো পাঠা|ছবি আপলোড|ইমেজ আপলোড|ছবি পাঠানোর অপশন|image send|image patha)/.test(t);
}

export class Hub extends DurableObject {
  constructor(s, e) {
    super(s, e);
    this.q = (sql, ...a) => [...s.storage.sql.exec(sql, ...a)];
    this.q("CREATE TABLE IF NOT EXISTS links(id TEXT PRIMARY KEY,name TEXT,active INT,created INT,expires INT,max_sec INT,max_sessions INT,used INT DEFAULT 0)");
    this.q("CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,link_id TEXT,started INT,last_seen INT,ended INT,killed INT)");
    this.q("CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,sid TEXT,role TEXT,content TEXT,ts INT)");
    this.q("CREATE TABLE IF NOT EXISTS cmds(id INTEGER PRIMARY KEY AUTOINCREMENT,sid TEXT,type TEXT,text TEXT)");
    this.q("CREATE TABLE IF NOT EXISTS asks(id TEXT PRIMARY KEY,sid TEXT,question TEXT,ts INT,done INT DEFAULT 0)");
    try { this.q("ALTER TABLE sessions ADD COLUMN archived INT DEFAULT 0"); } catch (e) {}
    try { this.q("ALTER TABLE sessions ADD COLUMN allow_images INT DEFAULT 0"); } catch (e) {}
    this.q("CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT)");
    this.q("CREATE TABLE IF NOT EXISTS images(id INTEGER PRIMARY KEY AUTOINCREMENT,sid TEXT,dir TEXT,data TEXT,mime TEXT,ts INT,seen INT DEFAULT 0)");
    this.q("CREATE TABLE IF NOT EXISTS watchers(id TEXT PRIMARY KEY,link_id TEXT,last_seen INT,force_start INT DEFAULT 0,claimed INT DEFAULT 0)");
  }
  settings() { const o = { ...D }; for (const r of this.q("SELECT k,v FROM settings")) o[r.k] = r.v; return o; }
  save(o) { for (const k of Object.keys(D)) if (k in o) this.q("INSERT OR REPLACE INTO settings VALUES(?,?)", k, String(o[k])); }
  learn(text) {
    const line = normalizeRule(text);
    if (!line) return false;
    const cur = String(this.settings().memory || "").trim();
    const existing = cur ? cur.split(/\n+/).map(x => x.replace(/^[•\-\*]\s*/, "").trim().toLowerCase()) : [];
    if (existing.includes(line.toLowerCase())) return true;
    const next = (cur ? cur + "\n" : "") + "• " + line;
    const kept = next.split(/\n+/).filter(Boolean).slice(-40).join("\n");
    this.q("INSERT OR REPLACE INTO settings VALUES(?,?)", "memory", kept);
    return true;
  }
  create(n, h, m, s) {
    let base = String(n || "").trim().slice(0, 60);
    base = base.replace(/[\s\/?#&=]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!base) base = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    let id = base, n_try = 2;
    while (this.q("SELECT id FROM links WHERE id=?", id)[0]) {
      id = base + "-" + n_try;
      n_try++;
      if (n_try > 200) { id = base + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6); break; }
    }
    const now = Date.now();
    const displayName = String(n || base).trim().slice(0, 80) || base;
    this.q("INSERT INTO links(id,name,active,created,expires,max_sec,max_sessions) VALUES(?,?,1,?,?,?,?)", id, displayName, now, h > 0 ? now + h * 3600000 : 0, m > 0 ? m * 60 : 0, s > 0 ? s : 0);
    return id;
  }
  links() {
    const cut = Date.now() - 12000, waitCut = Date.now() - 15000;
    return this.q(
      "SELECT l.*,(SELECT COUNT(*) FROM sessions s WHERE s.link_id=l.id AND s.ended=0 AND s.last_seen>?) live," +
      "(SELECT COUNT(*) FROM watchers w WHERE w.link_id=l.id AND w.claimed=0 AND w.last_seen>?) waiting " +
      "FROM links l ORDER BY created DESC",
      cut, waitCut
    );
  }
  toggle(id, a) { this.q("UPDATE links SET active=? WHERE id=?", a ? 1 : 0, id); }
  remove(id) { this.q("UPDATE sessions SET killed=1,ended=? WHERE link_id=? AND ended=0", Date.now(), id); this.q("DELETE FROM links WHERE id=?", id); }
  ok(l) { return l && l.active && (!l.expires || l.expires > Date.now()); }
  begin(k, wid) {
    const st = this.settings();
    if (st.enabled !== "1") return { r: "The agent is currently off." };
    const l = this.q("SELECT * FROM links WHERE id=?", k)[0];
    if (!this.ok(l)) return { r: "This link is not active." };
    if (l.max_sessions && l.used >= l.max_sessions) return { r: "This link has reached its limit." };
    const sid = crypto.randomUUID(), n = Date.now();
    this.q("INSERT INTO sessions(id,link_id,started,last_seen,ended,killed) VALUES(?,?,?,?,0,0)", sid, k, n, n);
    this.q("UPDATE links SET used=used+1 WHERE id=?", k);
    if (wid) this.claimWatcher(String(wid));
    return { sid, st };
  }
  ping(k, sid) {
    const s = this.q("SELECT * FROM sessions WHERE id=?", sid)[0], l = this.q("SELECT * FROM links WHERE id=?", k)[0], n = Date.now();
    if (!s || s.link_id !== k || s.ended || s.killed || !this.ok(l) || this.settings().enabled !== "1" || (l.max_sec && n - s.started > l.max_sec * 1000)) return { ok: false };
    this.q("UPDATE sessions SET last_seen=? WHERE id=?", n, sid);
    const cmds = this.q("SELECT type,text FROM cmds WHERE sid=? ORDER BY id", sid);
    if (cmds.length) this.q("DELETE FROM cmds WHERE sid=?", sid);
    const imgs = this.q("SELECT id,data,mime FROM images WHERE sid=? AND dir='to_caller' AND seen=0 ORDER BY id", sid);
    if (imgs.length) this.q("UPDATE images SET seen=1 WHERE sid=? AND dir='to_caller' AND seen=0", sid);
    return { ok: true, cmds, allow_images: !!s.allow_images, images: imgs.map(r => ({ id: r.id, data: r.data, mime: r.mime || "image/jpeg" })) };
  }
  log(k, sid, role, c) {
    const s = this.q("SELECT * FROM sessions WHERE id=?", sid)[0];
    if (!s || s.link_id !== k || s.ended) return;
    this.q("INSERT INTO messages(sid,role,content,ts) VALUES(?,?,?,?)", sid, role === "user" ? "user" : role === "sys" ? "sys" : "assistant", String(c).slice(0, 2000), Date.now());
  }
  ask(k, sid, id, question) {
    const s = this.q("SELECT * FROM sessions WHERE id=?", sid)[0];
    if (!s || s.link_id !== k || s.ended || !id) return false;
    const q = String(question || "Please advise").slice(0, 500);
    this.q("INSERT OR REPLACE INTO asks(id,sid,question,ts,done) VALUES(?,?,?,?,0)", String(id).slice(0, 80), sid, q, Date.now());
    this.q("INSERT INTO messages(sid,role,content,ts) VALUES(?,?,?,?)", sid, "ask", "Agent is asking you: " + q, Date.now());
    return true;
  }
  answer(sid, id, text) {
    const a = this.q("SELECT * FROM asks WHERE id=? AND sid=? AND done=0", id, sid)[0];
    if (!a) return false;
    const t = String(text || "").slice(0, 1000);
    this.q("UPDATE asks SET done=1 WHERE id=?", id);
    this.q("INSERT INTO cmds(sid,type,text) VALUES(?,?,?)", sid, "answer", JSON.stringify({ id, content: t || "No extra detail. Continue with what you know, and do not invent account data." }));
    this.q("INSERT INTO messages(sid,role,content,ts) VALUES(?,?,?,?)", sid, "admin", "You answered the agent: " + (t || "(no detail)"), Date.now());
    return true;
  }
  openAsks() { return this.q("SELECT id,sid,question,ts FROM asks WHERE done=0 ORDER BY ts"); }
  end(sid) { this.q("UPDATE sessions SET ended=? WHERE id=? AND ended=0", Date.now(), sid); }
  kill(sid) { this.q("UPDATE sessions SET killed=1,ended=? WHERE id=? AND ended=0", Date.now(), sid); }
  killAll() { this.q("UPDATE sessions SET killed=1,ended=? WHERE ended=0", Date.now()); }
  sessions(a) { return this.q("SELECT s.id,s.started,s.ended,COALESCE(l.name,'(deleted)') name,(s.ended=0 AND s.last_seen>?) live FROM sessions s LEFT JOIN links l ON l.id=s.link_id WHERE COALESCE(s.archived,0)=? ORDER BY s.started DESC LIMIT 100", Date.now() - 12000, a ? 1 : 0); }
  archive(sid, f) { this.q("UPDATE sessions SET archived=? WHERE id=? AND ended>0", f ? 1 : 0, sid); }
  delSession(sid) { const s = this.q("SELECT ended FROM sessions WHERE id=?", sid)[0]; if (!s || !s.ended) return; this.q("DELETE FROM messages WHERE sid=?", sid); this.q("DELETE FROM sessions WHERE id=?", sid); }
  clearEnded(mode, arch) { for (const r of this.q("SELECT id FROM sessions WHERE ended>0 AND COALESCE(archived,0)=?", arch ? 1 : 0)) { if (mode === "delete") this.delSession(r.id); else this.archive(r.id, true); } }
  cmd(sid, type, text, remember) {
    const s = this.q("SELECT ended FROM sessions WHERE id=?", sid)[0];
    if (!s || s.ended) return false;
    text = String(text).slice(0, 2000);
    this.q("INSERT INTO cmds(sid,type,text) VALUES(?,?,?)", sid, type, text);
    let note = type === "say" ? "Admin made the agent say: " : "Admin instruction: ";
    if (remember || (type === "instruct" && isLastingRule(text))) {
      this.learn(text);
      note = "Admin taught (saved to memory): ";
    }
    if (type === "instruct" && wantsCallerImages(text)) {
      this.q("UPDATE sessions SET allow_images=1 WHERE id=?", sid);
      this.q("INSERT INTO cmds(sid,type,text) VALUES(?,?,?)", sid, "enable_images", "1");
    }
    if (type === "enable_images") this.q("UPDATE sessions SET allow_images=1 WHERE id=?", sid);
    if (type === "disable_images") this.q("UPDATE sessions SET allow_images=0 WHERE id=?", sid);
    this.q("INSERT INTO messages(sid,role,content,ts) VALUES(?,?,?,?)", sid, "admin", note + text, Date.now());
    return true;
  }
  setAllowImages(sid, on) {
    const s = this.q("SELECT ended FROM sessions WHERE id=?", sid)[0];
    if (!s || s.ended) return false;
    this.q("UPDATE sessions SET allow_images=? WHERE id=?", on ? 1 : 0, sid);
    this.q("INSERT INTO cmds(sid,type,text) VALUES(?,?,?)", sid, on ? "enable_images" : "disable_images", on ? "1" : "0");
    this.q("INSERT INTO messages(sid,role,content,ts) VALUES(?,?,?,?)", sid, "admin", on ? "Admin allowed the caller to send images." : "Admin disabled caller image upload.", Date.now());
    return true;
  }
  sendImage(sid, dir, data, mime) {
    const s = this.q("SELECT ended,allow_images FROM sessions WHERE id=?", sid)[0];
    if (!s || s.ended) return { ok: false, error: "Session ended." };
    if (dir === "to_admin" && !s.allow_images) return { ok: false, error: "Image upload is not enabled for this call." };
    data = String(data || "");
    if (!data.startsWith("data:image/")) return { ok: false, error: "Invalid image." };
    if (data.length > 5500000) return { ok: false, error: "Image too large (max about 4MB). Try a smaller photo." };
    mime = String(mime || "image/jpeg").slice(0, 40);
    const direction = dir === "to_admin" ? "to_admin" : "to_caller";
    this.q("INSERT INTO images(sid,dir,data,mime,ts,seen) VALUES(?,?,?,?,?,0)", sid, direction, data, mime, Date.now());
    if (direction === "to_caller") {
      this.q("INSERT INTO messages(sid,role,content,ts) VALUES(?,?,?,?)", sid, "admin", "[Image sent to caller]", Date.now());
    } else {
      this.q("INSERT INTO messages(sid,role,content,ts) VALUES(?,?,?,?)", sid, "user", "[Image from caller]", Date.now());
    }
    return { ok: true };
  }
  pendingAdminImages(sid) {
    const rows = this.q("SELECT id,data,mime,ts FROM images WHERE sid=? AND dir='to_admin' AND seen=0 ORDER BY id", sid);
    if (rows.length) this.q("UPDATE images SET seen=1 WHERE sid=? AND dir='to_admin' AND seen=0", sid);
    return rows.map(r => ({ id: r.id, data: r.data, mime: r.mime || "image/jpeg", ts: r.ts }));
  }
  sessionImages(sid) {
    const rows = this.q("SELECT id,dir,data,mime,ts FROM images WHERE sid=? ORDER BY id", sid);
    return rows.map(r => ({ id: r.id, dir: r.dir, data: r.data, mime: r.mime || "image/jpeg", ts: r.ts }));
  }
  watch(k, wid) {
    const l = this.q("SELECT * FROM links WHERE id=?", k)[0];
    if (!this.ok(l)) return { ok: false, error: "This link is not active." };
    const n = Date.now();
    this.q("DELETE FROM watchers WHERE last_seen<?", n - 120000);
    let w = wid ? this.q("SELECT * FROM watchers WHERE id=? AND link_id=?", wid, k)[0] : null;
    if (!w || w.claimed) {
      wid = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      this.q("INSERT INTO watchers(id,link_id,last_seen,force_start,claimed) VALUES(?,?,?,0,0)", wid, k, n);
      w = { id: wid, force_start: 0, claimed: 0 };
    } else {
      this.q("UPDATE watchers SET last_seen=? WHERE id=?", n, wid);
      w = this.q("SELECT * FROM watchers WHERE id=?", wid)[0];
    }
    return { ok: true, wid: w.id, force_start: !!w.force_start };
  }
  forceStart(linkId) {
    const n = Date.now();
    const rows = this.q("SELECT id FROM watchers WHERE link_id=? AND claimed=0 AND last_seen>?", linkId, n - 20000);
    if (!rows.length) return { ok: false, error: "No one is waiting on this link right now." };
    for (const r of rows) this.q("UPDATE watchers SET force_start=1 WHERE id=?", r.id);
    return { ok: true, count: rows.length };
  }
  claimWatcher(wid) {
    if (!wid) return;
    this.q("UPDATE watchers SET claimed=1,force_start=0 WHERE id=?", wid);
  }
  waiting() {
    const n = Date.now() - 15000;
    return this.q(
      "SELECT w.id,w.link_id,w.last_seen,w.force_start,COALESCE(l.name,w.link_id) name FROM watchers w LEFT JOIN links l ON l.id=w.link_id WHERE w.claimed=0 AND w.last_seen>? ORDER BY w.last_seen DESC",
      n
    );
  }
  msgs(sid, after) { return this.q("SELECT id,role,content,ts FROM messages WHERE sid=? AND id>? ORDER BY id", sid, after); }
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.pathname;
    if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);
    const hub = env.HUB.get(env.HUB.idFromName("main"));
    const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    let b = {};
    if (req.method === "POST") { try { b = await req.json(); } catch {} }

    if (p === "/api/begin") {
      const r = await hub.begin(String(b.k || ""), String(b.wid || ""));
      if (!r.sid) return j({ error: r.r }, 403);
      const g = await fetch("https://api.deepgram.com/v1/auth/grant", {
        method: "POST",
        headers: { Authorization: "Token " + env.DEEPGRAM_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl_seconds: 300 }),
      });
      if (!g.ok) { await hub.end(r.sid); return j({ error: "Service unavailable." }, 502); }
      const t = (await g.json()).access_token;
      return j({ token: t, sid: r.sid, cfg: { greeting: r.st.greeting, voice: r.st.voice, avatar_mode: r.st.avatar_mode, avatar_gender: r.st.avatar_gender, model: r.st.model, temp: r.st.temp, prompt: compose(r.st) } });
    }
    if (p === "/api/ping") return j(await hub.ping(String(b.k), String(b.sid)));
    if (p === "/api/log") { await hub.log(String(b.k), String(b.sid), b.role, b.content || ""); return j({ ok: true }); }
    if (p === "/api/ask") { return j({ ok: await hub.ask(String(b.k || ""), String(b.sid || ""), String(b.id || ""), b.question || "") }); }
    if (p === "/api/image") { return j(await hub.sendImage(String(b.sid || ""), "to_admin", b.data || "", b.mime || "image/jpeg")); }
    if (p === "/api/end") { await hub.end(String(b.sid)); return j({ ok: true }); }
    if (p === "/api/watch") {
      const r = await hub.watch(String(b.k || ""), String(b.wid || ""));
      return j(r, r.ok ? 200 : 403);
    }

    if (p.startsWith("/api/admin/")) {
      const pw = req.headers.get("x-admin") || "";
      if (!env.ADMIN_PASSWORD || !same(pw, env.ADMIN_PASSWORD)) return j({ error: "no" }, 401);
      const a = p.slice(11);
      if (a === "state") return j({ links: await hub.links(), sessions: await hub.sessions(u.searchParams.get("arch") === "1"), settings: await hub.settings(), asks: await hub.openAsks(), waiting: await hub.waiting() });
      if (a === "msgs") return j(await hub.msgs(u.searchParams.get("sid") || "", +u.searchParams.get("after") || 0));
      if (a === "create") return j({ id: await hub.create(b.name, +b.hours || 0, +b.min || 0, +b.max || 0) });
      if (a === "toggle") { await hub.toggle(b.id, b.active); return j({ ok: true }); }
      if (a === "delete") { await hub.remove(b.id); return j({ ok: true }); }
      if (a === "kill") { await hub.kill(b.sid); return j({ ok: true }); }
      if (a === "killall") { await hub.killAll(); return j({ ok: true }); }
      if (a === "archive") { await hub.archive(b.sid, b.flag); return j({ ok: true }); }
      if (a === "sdelete") { await hub.delSession(b.sid); return j({ ok: true }); }
      if (a === "clear") { await hub.clearEnded(b.mode, b.arch); return j({ ok: true }); }
      if (a === "cmd") {
        const ty = b.type === "say" ? "say" : b.type === "enable_images" ? "enable_images" : b.type === "disable_images" ? "disable_images" : "instruct";
        return j({ ok: await hub.cmd(b.sid, ty, b.text || "", !!b.remember) });
      }
      if (a === "learn") { await hub.learn(b.text || ""); return j({ ok: true, memory: (await hub.settings()).memory }); }
      if (a === "answer") return j({ ok: await hub.answer(String(b.sid || ""), String(b.id || ""), b.text || "") });
      if (a === "settings") { await hub.save(b); return j({ ok: true }); }
      if (a === "image") return j(await hub.sendImage(String(b.sid || ""), "to_caller", b.data || "", b.mime || "image/jpeg"));
      if (a === "allow_images") return j({ ok: await hub.setAllowImages(String(b.sid || ""), !!b.on) });
      if (a === "pending_images") return j({ images: await hub.pendingAdminImages(u.searchParams.get("sid") || "") });
      if (a === "session_images") return j({ images: await hub.sessionImages(u.searchParams.get("sid") || "") });
      if (a === "force_start") return j(await hub.forceStart(String(b.id || "")));
      return j({ error: "unknown" }, 404);
    }
    return j({ error: "not found" }, 404);
  },
};
