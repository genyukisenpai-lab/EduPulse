// Tra cứu web theo thời gian thực cho trợ lý EduPulse — chạy 100% phía client,
// không cần backend hay key trả phí:
//   1) DuckDuckGo Instant Answer (JSONP, miễn phí) — trả lời nhanh khi có sẵn.
//   2) Wikipedia EN/VI (REST API, CORS mở, miễn phí) — tri thức đáng tin cậy.
(function () {
  'use strict';

  const TIMEOUT = 8000;

  function jsonp(url, timeout) {
    return new Promise(resolve => {
      const cbName = '__edupulseDdg' + Math.random().toString(36).slice(2);
      let done = false;
      let script = null;
      const timer = setTimeout(() => finish(null), timeout || 6000);
      function finish(data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (script) script.remove();
        delete window[cbName];
        resolve(data || null);
      }
      window[cbName] = finish;
      script = document.createElement('script');
      script.src = url + '&callback=' + cbName;
      script.onerror = () => finish(null);
      document.head.appendChild(script);
    });
  }

  async function jsonFetch(url, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout || TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (error) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function searchDuckDuckGo(query) {
    const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) +
      '&format=json&no_html=1&skip_disambig=1';
    const data = await jsonp(url, 6000);
    const text = data && (data.AnswerText || data.AbstractText ||
      (Array.isArray(data.RelatedTopics) && data.RelatedTopics[0] && data.RelatedTopics[0].Text) || '');
    return text ? { found: true, text: text.trim(), source: 'DuckDuckGo' } : { found: false, text: '' };
  }

  async function searchWikipedia(query, lang) {
    const base = 'https://' + lang + '.wikipedia.org/w/api.php';
    const searchUrl = base + '?action=query&list=search&srsearch=' + encodeURIComponent(query) +
      '&srlimit=1&format=json&origin=*';
    const s = await jsonFetch(searchUrl, 8000);
    const title = s && s.query && s.query.search && s.query.search[0] && s.query.search[0].title;
    if (!title) return '';
    const extUrl = base + '?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1' +
      '&format=json&origin=*&titles=' + encodeURIComponent(title);
    const e = await jsonFetch(extUrl, 8000);
    const pages = e && e.query && e.query.pages || null;
    const page = pages ? (Object.values(pages)[0] || null) : null;
    const text = page && page.extract ? page.extract.trim() : '';
    if (!text) return '';
    return '[' + lang.toUpperCase() + ' Wiki — ' + title + '] ' + text;
  }

  async function search(query) {
    const q = String(query || '').trim().slice(0, 250);
    if (!q) return { found: false, text: '', source: '' };
    try {
      const ddg = await searchDuckDuckGo(q);
      if (ddg.found) return ddg;
    } catch (error) { /* bỏ qua, chuyển sang Wikipedia */ }
    const results = [];
    for (const lang of ['vi', 'en']) {
      try {
        const t = await searchWikipedia(q, lang);
        if (t) results.push(t);
      } catch (error) { /* bỏ qua */ }
      if (results.length) break;
    }
    if (results.length) {
      return { found: true, text: results.join('\n\n').slice(0, 1600), source: 'Wikipedia' };
    }
    return { found: false, text: '', source: '' };
  }

  window.AiWeb = { search };
})();