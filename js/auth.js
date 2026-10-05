/* =====================================================================
 * yekjw.top 全站登录组件 v2（SSO 父域 Cookie 版）
 * ---------------------------------------------------------------------
 * 与 v1 的区别：
 *   token 从 localStorage 迁移到父域 Cookie（Domain=.yekjw.top）
 *   这样 yekjw.top / sou.yekjw.top / 任何 *.yekjw.top 都能共享登录态
 *   老用户无需重新登录，v2 会自动从 localStorage 迁移
 * =================================================================== */
(function () {
  var API_BASE = window.YEKJW_API_BASE || 'https://api.yekjw.top';
  var TOKEN_KEY = 'yekjw_token';    // Cookie / localStorage 的 key
  var MAX_AGE = 7 * 86400;          // 7 天，和后端 token 一致
  var COOKIE_DOMAIN = '.yekjw.top'; // 父域，子域共享

  // 是否在 yekjw.top 域名下（本地预览/其他域名则不加 Domain）
  var isYekjwDomain = /(^|\.)yekjw\.top$/i.test(location.hostname);
  var DOMAIN_SUFFIX = isYekjwDomain ? '; Domain=' + COOKIE_DOMAIN : '';

  function getCookie(name) {
    var m = document.cookie.match(
      '(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'
    );
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, maxAge) {
    var parts = [
      name + '=' + encodeURIComponent(value),
      'path=/',
      'Secure',
      'SameSite=Lax'
    ];
    if (isYekjwDomain) parts.push('Domain=' + COOKIE_DOMAIN);
    if (maxAge) parts.push('max-age=' + maxAge);
    document.cookie = parts.join('; ');
  }
  function delCookie(name) {
    document.cookie = name + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT' + DOMAIN_SUFFIX;
  }

  // 读 token：优先 Cookie；若无但 localStorage 有旧值 → 自动迁移
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
  }

  // 统一请求封装
  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var t = token();
    if (t) options.headers['Authorization'] = 'Bearer ' + t;
    return fetch(API_BASE + path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) setToken('');
        data._status = res.status;
        return data;
      });
    });
  }

  var YekjwAuth = {
    API_BASE: API_BASE,
    token: token,
    setToken: setToken,
    isLoggedIn: function () { return !!token(); },

    login: function (username, password) {
      return api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: username, password: password })
      }).then(function (data) {
        if (data.token) setToken(data.token);
        return data;
      });
    },

    logout: function () {
      setToken('');
      window.location.href = '/';
    },

    me: function () {
      if (!token()) return Promise.resolve(null);
      return api('/api/me').then(function (data) { return data.user || null; });
    },

    download: function (postPath) {
      return api('/api/download', {
        method: 'POST',
        body: JSON.stringify({ path: postPath })
      });
    },

    // 生成登录跳转链接：带上当前页作为回跳目标
    loginUrl: function (returnTo) {
      var back = returnTo || window.location.href;
      return 'https://yekjw.top/login/?redirect=' + encodeURIComponent(back);
    },

    // 安全跳回：只允许 *.yekjw.top 或站内相对路径，防止开放重定向
    safeRedirect: function (url, fallback) {
      if (!url) return fallback || '/';
      if (/^https:\/\/([a-z0-9-]+\.)?yekjw\.top(\/|$)/i.test(url)) return url;
      if (/^\//.test(url)) return url;
      return fallback || '/';
    }
  };

  window.YekjwAuth = YekjwAuth;

  /* 顶栏登录按钮 → 登录后显示用户名和剩余次数 */
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.header-buttons .login-btn, a.login-btn');
    if (!btn) return;
    YekjwAuth.me().then(function (user) {
      if (user) {
        btn.textContent = '👤 ' + user.username + '（剩' + user.remaining + '次）';
        btn.href = '/login/';
        btn.title = '点击查看账户信息 / 退出登录';
      }
    });
  });
})();