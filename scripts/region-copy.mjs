/**
 * 区域静态文案单点（index.html 元信息 / robots 注释）。
 * zh = cn 基线原文（逐字节不变）；en = com 面文案（B3 起 com 默认 en）。
 * robotsComment 为行数组（cn 基线两行注释，勿并成一行）。
 */
export const REGION_COPY = {
  zh: {
    locale: 'zh-CN',
    title: 'Autional 身份认证',
    description: 'Autional 身份认证 —— 登录、注册、多因素认证与单点登录。',
    robotsComment: [
      '身份认证页（登录/注册/OAuth）：不收录。',
      '不用 Disallow：保持可抓取，搜索引擎才能读到 index.html 里的 robots noindex。',
    ],
  },
  en: {
    locale: 'en-US',
    title: 'Autional Auth',
    description: 'Autional Auth — sign-in, registration, multi-factor authentication, and single sign-on.',
    robotsComment: [
      'auth pages (sign-in / registration / OAuth): not indexed.',
      'No Disallow: stay crawlable so search engines can read the robots noindex meta in index.html.',
    ],
  },
};
