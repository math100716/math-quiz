/* cloud.js —— 云端学生档案（腾讯云开发 CloudBase · PostgreSQL）
   取代原 store.js：注册/登录（密码加密）、积分与错题集存云端，全班共享排行榜。
   写入采用节流合并（约 2.5 秒内的多次改动合并成一次请求），节省资源点。 */
window.Cloud = (function () {
  const ENV = "math100716-d4g85ttym7c04ee74";
  const REGION = "ap-shanghai";
  const ACCESS_KEY = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjU1MTRjZmYwLTI1NmEtNGZmNS04YWI1LTI5YWU0MTczOGYyYSJ9.eyJpc3MiOiJodHRwczovL21hdGgxMDA3MTYtZDRnODV0dHltN2MwNGVlNzQuYXAtc2hhbmdoYWkudGNiLWFwaS50ZW5jZW50Y2xvdWRhcGkuY29tIiwic3ViIjoiYW5vbiIsImF1ZCI6Im1hdGgxMDA3MTYtZDRnODV0dHltN2MwNGVlNzQiLCJleHAiOjQwOTMyMjIxNzksImlhdCI6MTc4OTUzODk3OSwibm9uY2UiOiJkQ1FETE52VlN2aXZTT3ZlOW1mRk9RIiwiYXRfaGFzaCI6ImRDUURMTnZWU3ZpdlNPdmU5bWZGT1EiLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoibWF0aDEwMDcxNi1kNGc4NXR0eW03YzA0ZWU3NCIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.h8Yo1D_eBlGarvx7k_g_zksOehtwMMZpJl6zHJfMTF5TKfFnkHdRgV_AJoVT5h2hkvfqARoNl7KKU5EdfY89eQI-eetqrm24-b33FVzKIMrZIG82DZRqgMvhXrn9z3UrrY5gU40iLNJnYvq2S0Al1osLOIUzTi5e4cYrwfNro-_LWC0hzR73IO88KGbeYTZuNSF2UOaQutyGfY_A3y0IsYkl2wAoPbneo_ObdQLSufFvsOAcL5b0Su3CnaZotDlz3YxRaJhkPlbGAnzerIBbUJ1YhkWZv9WjXQYi34YQu2vbDYrKvtNLreAIB7GPEgQo3RcUXFriB3R2SNE3WrEuWg";
  const K_SESSION = "sq:session";

  const app = window.cloudbase.init({
    env: ENV, region: REGION, accessKey: ACCESS_KEY,
    auth: { detectSessionInUrl: true }
  });
  const db = app.rdb();

  /* ---------------- 工具 ---------------- */
  async function sha256(s) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    /* 兜底（非安全上下文）：FNV-1a 简易散列，仅防止明文 */
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return "f" + h.toString(16);
  }
  const passHash = (un, pwd) => sha256("sq::" + un + "::" + pwd);
  const uname = (grade, cls, name) => grade + "·" + cls + "·" + name;

  /* 数据库行 → 页面用的 me 对象（字段名与原 store.js 保持一致） */
  function rowToUser(r) {
    return {
      id: r.id, grade: r.grade, cls: r.grade + "·" + r.cls, clsOnly: r.cls,
      name: r.name, username: r.username,
      score: r.score || 0, streak: r.streak || 0, best: r.best || 0,
      right: r.right_cnt || 0, wrong: r.wrong_cnt || 0,
      wrongItems: Array.isArray(r.wrong_items) ? r.wrong_items : [],
      lastWeek: r.last_week || ""
    };
  }

  /* ---------------- 查询 ---------------- */
  async function findByUsername(un) {
    const r = await db.from("students").select("*").eq("username", un).limit(1);
    if (r.error) throw new Error(r.error.message || "数据库查询失败");
    return (r.data && r.data[0]) || null;
  }
  async function getById(id) {
    const r = await db.from("students").select("*").eq("id", id).limit(1);
    if (r.error) throw new Error(r.error.message || "数据库查询失败");
    return (r.data && r.data[0]) || null;
  }

  /* ---------------- 注册 / 登录 ---------------- */
  async function register(grade, cls, name, password) {
    const un = uname(grade, cls, name);
    if (await findByUsername(un)) return { ok: false, error: "registered" };
    const ph = await passHash(un, password);
    const r = await db.from("students").insert({
      grade: grade, cls: cls, name: name, username: un, pass_hash: ph,
      score: 0, streak: 0, best: 0, right_cnt: 0, wrong_cnt: 0,
      wrong_items: [], drawn: [], last_week: weekKey()
    });
    if (r.error) throw new Error(r.error.message || "注册失败");
    const row = await findByUsername(un);
    return { ok: true, user: applyWeekly(rowToUser(row)).user };
  }
  async function login(grade, cls, name, password) {
    const un = uname(grade, cls, name);
    const row = await findByUsername(un);
    if (!row) return { ok: false, error: "no_user" };
    const ph = await passHash(un, password);
    if (ph !== row.pass_hash) return { ok: false, error: "bad_password" };
    const step = applyWeekly(rowToUser(row));
    if (step.changed) commit(step.user);          // 跨周首次登录：把清零结果写回
    return { ok: true, user: step.user };
  }

  /* ---------------- 每周五 24:00（周六 00:00）积分清零 ----------------
     与原 store.js 的 weeklyReset 同语义：只清 score/streak/best，
     错题集与答题统计（正确率）保留。按行内 last_week 判断是否跨周。 */
  function weekKey(now) {
    const d = now ? new Date(now) : new Date();
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const off = (t.getDay() + 1) % 7;             // 周六=0 偏移：周六当天算新周期第一天
    t.setDate(t.getDate() - off);
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  function applyWeekly(u) {
    const wk = weekKey();
    if (u.lastWeek === wk) return { user: u, changed: false };
    u.score = 0; u.streak = 0; u.best = 0;
    u.lastWeek = wk;
    return { user: u, changed: true };
  }

  /* ---------------- 保存：节流合并写（省资源点） ---------------- */
  let pending = null, uid = null, timer = null;
  function commit(u) {
    if (!u || !u.id) return;
    if (!pending) pending = {};
    pending.score = u.score; pending.streak = u.streak; pending.best = u.best;
    pending.right_cnt = u.right; pending.wrong_cnt = u.wrong;
    pending.wrong_items = u.wrongItems || [];
    pending.last_week = u.lastWeek || "";
    uid = u.id;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 2500);              // 2.5 秒内的连续答题合并成一次写
  }
  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending || !uid) return;
    const data = pending; pending = null;
    try {
      const r = await db.from("students").update(data).eq("id", uid);
      if (r.error) pending = Object.assign(pending || {}, data);   // 失败留待下次重试
    } catch (e) { pending = Object.assign(pending || {}, data); }
  }

  /* ---------------- 排行榜（全班共享，云端读取） ---------------- */
  async function board() {
    const r = await db.from("students")
      .select("id,grade,cls,name,score,streak,best,right_cnt,wrong_cnt")
      .order("score", { ascending: false }).limit(200);
    if (r.error) throw new Error(r.error.message || "排行榜读取失败");
    const rows = (r.data || []).slice();
    rows.sort(function (a, b) {
      return (b.score - a.score) || (b.best - a.best) || (a.id - b.id);
    });
    return rows.map(function (x) {
      return {
        id: x.id, cls: x.grade + "·" + x.cls, name: x.name,
        score: x.score || 0, best: x.best || 0,
        right: x.right_cnt || 0, wrong: x.wrong_cnt || 0
      };
    });
  }

  /* ---------------- 错题集逻辑（与原 store.js 完全一致） ---------------- */
  function snapshot(q) {
    return {
      id: q.id, stem: q.stem || "", options: q.options || [],
      answer: q.answer || "", analysis: q.analysis || "",
      type: q.type || "", source: q.source || "",
      images: q.images || [], optionImgs: q.optionImgs || []
    };
  }
  function addWrong(u, q) {
    if (!u) return u;
    u.wrong = (u.wrong || 0) + 1;
    if (!Array.isArray(u.wrongItems)) u.wrongItems = [];
    const hit = u.wrongItems.find(function (x) { return String(x.id) === String(q.id); });
    if (hit) { hit.times = (hit.times || 1) + 1; hit.at = Date.now(); }
    else {
      const snap = snapshot(q);
      snap.times = 1; snap.at = Date.now();
      u.wrongItems.unshift(snap);
    }
    return u;
  }
  function removeWrong(u, qid) {
    if (!u) return u;
    u.wrongItems = (u.wrongItems || []).filter(function (x) { return String(x.id) !== String(qid); });
    return u;
  }
  function clearWrong(u) {
    if (!u) return u;
    u.wrongItems = []; u.wrong = 0;
    return u;
  }

  /* ---------------- 会话（本机记住"当前是谁"，与原 store.js 相同的键） ---------------- */
  function setSession(s) { try { localStorage.setItem(K_SESSION, JSON.stringify(s)); } catch (e) {} }
  function session() {
    try { return JSON.parse(localStorage.getItem(K_SESSION) || "null"); }
    catch (e) { return null; }
  }
  function clearSession() { try { localStorage.removeItem(K_SESSION); } catch (e) {} }

  return {
    register: register, login: login, board: board,
    findByUsername: findByUsername, getById: getById,
    rowToUser: rowToUser, applyWeekly: applyWeekly, weekKey: weekKey,
    commit: commit, flush: flush,
    snapshot: snapshot, addWrong: addWrong, removeWrong: removeWrong, clearWrong: clearWrong,
    setSession: setSession, session: session, clearSession: clearSession
  };
})();
