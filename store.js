/* 学生记录 / 会话 / 排行榜 —— 存在本机浏览器 localStorage 里，两个页面共用 */
window.Store = (function () {
  const K_USERS = "sq:users";
  const K_SESSION = "sq:session";

  function readAll() {
    try { return JSON.parse(localStorage.getItem(K_USERS) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function writeAll(o) {
    try { localStorage.setItem(K_USERS, JSON.stringify(o)); } catch (e) {}
  }
  const kOf = (cls, name) => cls + "|" + name;

  function blank(cls, name) {
    return { cls: cls, name: name, score: 0, streak: 0, best: 0, right: 0, wrong: 0, wrongItems: [], ts: 0 };
  }

  /* 错题快照：存下题目本身，题库换版后错题集依然能看 */
  function snapshot(q) {
    return {
      id: q.id, stem: q.stem || "", options: q.options || [],
      answer: q.answer || "", analysis: q.analysis || "",
      type: q.type || "", source: q.source || "",
      images: q.images || [], optionImgs: q.optionImgs || []
    };
  }
  /* 记一道错题：累计次数 +1，同一道题只保留一条（记「错 N 次」） */
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
  function getUser(cls, name) {
    const all = readAll();
    return all[kOf(cls, name)] || blank(cls, name);
  }
  function saveUser(u) {
    const all = readAll();
    u.ts = Date.now();
    all[kOf(u.cls, u.name)] = u;
    writeAll(all);
  }
  function list() {
    return Object.values(readAll()).sort(function (a, b) {
      return (b.score - a.score) || (b.best - a.best) || (a.ts - b.ts);
    });
  }
  function classes() {
    const set = {};
    Object.values(readAll()).forEach(function (u) { if (u.cls) set[u.cls] = 1; });
    return Object.keys(set);
  }
  function clearAll() { writeAll({}); }

  function setSession(s) { try { localStorage.setItem(K_SESSION, JSON.stringify(s)); } catch (e) {} }
  function session() {
    try { return JSON.parse(localStorage.getItem(K_SESSION) || "null"); }
    catch (e) { return null; }
  }
  function clearSession() { try { localStorage.removeItem(K_SESSION); } catch (e) {} }

  /* 清空「已抽过的题」，让新登录的学生从全新一轮开始 */
  function resetDrawn() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (/:drawn$/.test(k)) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  /* ---- 每周五晚 24:00（即周六 00:00）全员积分清零 ---- */
  const K_LASTRESET = "sq:lastReset";
  /* 返回「最近一次已过期的周五 24:00」时间戳 */
  function lastFridayMidnight(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);                 // 今天 00:00
    const day = d.getDay();                 // 0=周日 … 6=周六
    const diff = (day - 6 + 7) % 7;         // 距最近一个周六 00:00 的天数
    d.setDate(d.getDate() - diff);
    return d.getTime();
  }
  /* 页面加载时调用：跨过周五 24:00 边界则清空所有积分（错题集与正确率统计保留） */
  function weeklyReset() {
    let last = 0;
    try { last = Number(localStorage.getItem(K_LASTRESET) || 0); } catch (e) {}
    const boundary = lastFridayMidnight(Date.now());
    if (last >= boundary) return false;     // 本周期已清过
    const all = readAll();
    Object.values(all).forEach(function (u) {
      u.score = 0; u.streak = 0; u.best = 0;      // 只清积分与连对，错题档案留着
      if (!Array.isArray(u.wrongItems)) u.wrongItems = [];
    });
    writeAll(all);
    resetDrawn();                           // 新一周，题目也重新轮
    try { localStorage.setItem(K_LASTRESET, String(Date.now())); } catch (e) {}
    return true;
  }

  return {
    getUser: getUser, saveUser: saveUser, list: list, classes: classes,
    clearAll: clearAll, setSession: setSession, session: session,
    clearSession: clearSession, resetDrawn: resetDrawn, weeklyReset: weeklyReset,
    addWrong: addWrong, removeWrong: removeWrong, clearWrong: clearWrong, snapshot: snapshot
  };
})();
