/* =====================================================================
 * yekjw.top 全站登录组件 v3
 * ---------------------------------------------------------------------
 * v2 → v3 变化：
 *   1. API_BASE 默认同源（''），走 /api/*，干掉跨域预检
 *   2. sessionStorage 缓存用户信息 5 分钟 → 页面加载 0ms 显示按钮
 *   3. me({ fresh: true }) 强制绕过缓存
 *   4. login/logout/401/download 成功后自动清缓存
 *   5. 同源请求失败时自动回退到 api.yekjw.top
 * =================================================================== */
(function () {
  var TOKEN_KEY = 'yekjw_token';
  var CACHE_KEY = 'yekjw_me_cache';
  var CACHE_TTL = 5 * 60 * 1000;
  var MAX_AGE = 7 * 86400;
  var COOKIE_DOMAIN = '.yekjw.top';

  // 🌟 API_BASE：默认同源；可在页面提前设 window.YEKJW_API_BASE 覆盖
  var FALLBACK_BASE = 'https://api.yekjw.top';
  var API_BASE = (window.YEKJW_API_BASE !== undefined) ? window.YEKJW_API_BASE : '';
  var fellBack = false;

  var isYekjwDomain = /(^|\.)yekjw\.top$/i.test(location.hostname);
  var DOMAIN_SUFFIX = isYekjwDomain ? '; Domain=' + COOKIE_DOMAIN : '';

  // ---------- Cookie ----------
  function getCookie(name) {
    var m = document.cookie.match(
      '(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'
    );
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, maxAge) {
    var parts = [name + '=' + encodeURIComponent(value), 'path=/', 'Secure', 'SameSite=Lax'];
    if (isYekjwDomain) parts.push('Domain=' + COOKIE_DOMAIN);
    if (maxAge) parts.push('max-age=' + maxAge);
    document.cookie = parts.join('; ');
  }
  function delCookie(name) {
    document.cookie = name + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT' + DOMAIN_SUFFIX;
  }

  function token() {
    var t = getCookie(TOKEN_KEY);
    if (t) return t;
    try {
      var legacy = localStorage.getItem(TOKEN_KEY);
      if (legacy) {
        setCookie(TOKEN_KEY, legacy, MAX_AGE);
        localStorage.removeItem(TOKEN_KEY);
        return legacy;
      }
    } catch (e) {}
    return '';
  }
  function setToken(t) {
    if (t) {
      setCookie(TOKEN_KEY, t, MAX_AGE);
    } else {
      delCookie(TOKEN_KEY);
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    }
    clearCache();
  }

  // ---------- sessionStorage 缓存 ----------
  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (Date.now() - c.ts > CACHE_TTL) return null;
      var t = token().slice(0, 20);
      if (!t || c.token !== t) return null;
      return c.user;
    } catch (e) { return null; }
  }
  function writeCache(user) {
    try {
      if (!user) { sessionStorage.removeItem(CACHE_KEY); return; }
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        token: token().slice(0, 20),
        user: user,
        ts: Date.now()
      }));
    } catch (e) {}
  }
  function clearCache() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  // ---------- 请求 ----------
  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var t = token();
    if (t) options.headers['Authorization'] = 'Bearer ' + t;

    var url = API_BASE + path;
    return fetch(url, options).then(function (res) {
      // 同源接口返回 404/530 → 说明 Route 没配好，自动回退到 api.yekjw.top
      if (!fellBack && API_BASE === '' && (res.status === 404 || res.status >= 500)) {
        fellBack = true;
        var fbUrl = FALLBACK_BASE + path;
        var opts2 = Object.assign({}, options);
        return fetch(fbUrl, opts2).then(handleRes);
      }
      return handleRes(res);
    });
  }
  function handleRes(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (res.status === 401) {
        setToken('');
        clearCache();
      }
      data._status = res.status;
      return data;
    });
  }

  var lastBgRefresh = 0;
  function fetchMe() {
    return api('/api/me').then(function (data) { return data.user || null; });
  }
  function backgroundRefresh() {
    var now = Date.now();
    if (now - lastBgRefresh < 60000) return;
    lastBgRefresh = now;
    fetchMe().then(function (u) { if (u) writeCache(u); }).catch(function () {});
  }

  var YekjwAuth = {
    API_BASE: API_BASE,
    token: token,
    setToken: setToken,
    clearCache: clearCache,
    isLoggedIn: function () { return !!token(); },

    login: function (username, password) {
      return api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: username, password: password })
      }).then(function (data) {
        if (data.token) setToken(data.token);
        clearCache();
        return data;
      });
    },

    logout: function () {
      setToken('');
      clearCache();
      window.location.href = '/';
    },

    // 🌟 支持 { fresh: true } 强制绕过缓存
    me: function (opts) {
      opts = opts || {};
      if (!token()) return Promise.resolve(null);

      var cached = opts.fresh ? null : readCache();
      if (cached) {
        backgroundRefresh();
        return Promise.resolve(cached);
      }
      return fetchMe().then(function (u) {
        if (u) writeCache(u);
        return u;
      });
    },

    // 下载：成功后自动清缓存
    download: function (postPath) {
      return api('/api/download', {
        method: 'POST',
        body: JSON.stringify({ path: postPath })
      }).then(function (data) {
        if (data && data.ok) clearCache();
        return data;
      });
    },

    // 🌟 下载前强制 fresh 检查权限（post.ejs 用这个）
    downloadWithCheck: function (postPath) {
      var self = this;
      return self.me({ fresh: true }).then(function (user) {
        if (!user) return { _status: 401, error: 'unauthorized', message: '请先登录' };
        if (user.remaining <= 0) return { _status: 403, error: 'quota_exhausted', message: '下载次数已用完，请联系客服充值' };
        if (user.remainingToday <= 0) return { _status: 429, error: 'daily_limit', message: '今日下载次数已用完，明天再来吧' };
        if (user.expired) return { _status: 403, error: 'expired', message: '会员已过期，请续费' };
        return self.download(postPath);
      });
    },

    loginUrl: function (returnTo) {
      var back = returnTo || window.location.href;
      return 'https://yekjw.top/login/?redirect=' + encodeURIComponent(back);
    },

    safeRedirect: function (url, fallback) {
      if (!url) return fallback || '/';
      if (/^https:\/\/([a-z0-9-]+\.)?yekjw\.top(\/|$)/i.test(url)) return url;
      if (/^\//.test(url)) return url;
      return fallback || '/';
    }
  };

  window.YekjwAuth = YekjwAuth;

  /* 顶栏登录按钮：有缓存 → 0ms 变身；无缓存 → 等接口 */
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.header-buttons .login-btn, a.login-btn');
    if (!btn) return;

    var cached = readCache();
    if (cached) {
      btn.textContent = '👤 ' + cached.username + '（剩' + cached.remaining + '次）';
      btn.href = '/login/';
      btn.title = '点击查看账户信息 / 退出登录';
    }

    YekjwAuth.me().then(function (user) {
      if (user) {
        btn.textContent = '👤 ' + user.username + '（剩' + user.remaining + '次）';
        btn.href = '/login/';
        btn.title = '点击查看账户信息 / 退出登录';
      }
    });
  });
})();