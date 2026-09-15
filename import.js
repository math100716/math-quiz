/**
 * 题库解析：把从 ima 知识库复制出来的纯文本 / Markdown / JSON 转成题目数组。
 * 规则：
 *  1. 合法 JSON 数组 → 直接使用
 *  2. 否则按「1. / 1、/ （1）/ 第1题」等行首编号切题
 *  3. 题块内以「答案 / 解析 / 详解 / 思路」开头的行拆成对应字段
 *  4. 形如「A. xxx」「B．xxx」的行识别为选择题选项
 */
(function () {
  const NUM_RE = /^\s*(?:第\s*)?(\d{1,3})\s*[.、．)）:：]\s*/;

  function splitBlocks(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const m = line.match(NUM_RE);
      const num = m ? Number(m[1]) : 0;
      // 编号递增（或重新从 1 开始）才切新块，避免误伤正文里的行内序号
      const isNew = m && (cur === null || num > cur.id || (num === 1 && cur.id > 1));
      if (isNew) {
        if (cur) blocks.push(cur);
        cur = { id: num, lines: [line.replace(NUM_RE, "")] };
      } else if (cur) {
        cur.lines.push(line);
      }
    }
    if (cur) blocks.push(cur);
    return blocks;
  }

  const OPT_RE = /^[（(]?\s*([A-D])\s*[)）]?\s*[.、．:：、]\s*(\S.*)$/;
  const HAS_BLANK = /（\s*[）)]|\(\s*\)|＿|_/;

  function parseBlock(b) {
    const q = { id: b.id, source: "", type: "", level: "", stem: "", options: [], answer: "", analysis: "" };
    const stem = [];
    let mode = "stem";
    for (const raw of b.lines) {
      let t = raw.trim();
      if (!t) continue;

      if (mode === "stem") {
        const opt = t.match(OPT_RE);
        if (opt && (q.options.length > 0 || HAS_BLANK.test(stem.join("")))) {
          q.options.push(opt[1] + ". " + opt[2]);
          q.type = "选择";
          continue;
        }
      }
      if (/^(答案|参考答案|【答案】)/.test(t)) { mode = "answer"; t = t.replace(/^(答案|参考答案|【答案】)\s*[:：]?\s*/, ""); }
      else if (/^(解析|详解|思路|分析|【解析】|【详解】)/.test(t)) { mode = "analysis"; t = t.replace(/^(解析|详解|思路|分析|【解析】|【详解】)\s*[:：]?\s*/, ""); }

      if (mode === "answer") q.answer += (q.answer ? "\n" : "") + t;
      else if (mode === "analysis") q.analysis += (q.analysis ? "\n" : "") + t;
      else stem.push(t);
    }
    q.stem = stem.join("\n").trim();
    if (!q.type) q.type = q.answer ? "解答" : "填空";
    return q;
  }

  window.parseQuestions = function (text) {
    text = String(text || "").trim();
    if (!text) return [];
    if (text[0] === "[" || text[0] === "{") {
      try {
        const j = JSON.parse(text);
        const arr = Array.isArray(j) ? j : [j];
        return arr.map((x, i) => Object.assign({ id: i + 1, source: "", type: "解答", level: "", options: [] }, x));
      } catch (e) { /* 不是 JSON，走文本解析 */ }
    }
    return splitBlocks(text).map(parseBlock).filter(q => q.stem);
  };
})();
