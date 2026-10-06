/**
 * Static site build: content/pages/*.json → _site/, one real document per
 * (page, language).
 *
 * index.html is the chrome template — head, CSS, sidebar, footer, lightbox.
 * Its authored panels and inline scripts are historical: panels were migrated
 * into the page files by scripts/migrate.mjs, and behaviour lives in
 * src/app.mjs. The build strips both and renders every panel from data via
 * src/templates.mjs, so there is exactly one rendering path.
 *
 * Languages: pages are rendered in English, captureEnglish() snapshots the
 * strings, then applyLanguage() rewrites the document once per language before
 * it is split into per-page files — the same slot/data-i18n mechanism the old
 * runtime used, run at build time. /hi/... pages therefore carry Hindi
 * metadata read back off the translated DOM.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { captureEnglish, applyLanguage } from '../src/hydrate.mjs';
import { renderPage, brandMark, arrowIcon } from '../src/templates.mjs';
import { buildRegistry, buildNav, loadNavConfig, navParentOf, urlFor } from '../src/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

const template = readFileSync(join(ROOT, 'index.html'), 'utf8');
const probeStyles = parseHTML(template).document;
const i18n = JSON.parse(readFileSync(join(ROOT, 'content/i18n.json'), 'utf8'));
// Site-wide chrome (currently just the brand badge). Absent or half-filled is
// fine — every reader of it falls back rather than failing the build.
const SITE = existsSync(join(ROOT, 'content/site.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'))
  : {};

/* Where the site is served. A CNAME means a domain root (the live site). A
 * copy with no CNAME — a preview on <user>.github.io/<repo>/ — takes its
 * address from content/site.json `url` and `base`, and every site-absolute
 * path in the output is prefixed with `base` at the very end of the build. */
const HAS_CNAME = existsSync(join(ROOT, 'CNAME'));
const BASE = HAS_CNAME ? '' : String(SITE.base || '').replace(/\/$/, '');
const ORIGIN = HAS_CNAME
  ? 'https://' + readFileSync(join(ROOT, 'CNAME'), 'utf8').trim()
  : String(SITE.url || 'http://localhost').replace(/\/$/, '');
const SITE_URL = ORIGIN + BASE;

const PAGES = buildRegistry(ROOT);
// The header menu, as editors set it in the CMS (content/navigation.json).
const NAV = buildNav(PAGES, loadNavConfig(ROOT));
const SECTION_IDS = PAGES.slice(1).map((p) => p.slug); // all but home, nav order
const href = (lang, page) => urlFor(lang, page, PAGES);
const pageById = new Map(PAGES.map((p) => [p.slug, p]));

/* ---------- chrome shell + rendered panels ---------- */

function composeDocument() {
  const { document } = parseHTML(template);

  // Drop the authored panels and every script: panels are rendered from data,
  // behaviour ships as /assets/app.mjs, and gallery.js / layout-model.js only
  // existed to serve the old inline runtime.
  document.querySelectorAll('[data-panel]').forEach((n) => n.remove());
  document.querySelectorAll('script').forEach((n) => n.remove());

  // Draw the sidebar brand from content/site.json: the badge, and the two
  // lines beside it. Each is only overwritten when the CMS has something to
  // say, so an empty site.json leaves the template's own wording standing.
  const mark = document.querySelector('.brand-mark');
  if (mark) {
    const { shape, svg } = brandMark(SITE.brand);
    mark.setAttribute('data-shape', shape);
    mark.innerHTML = svg;
  }
  const brandText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node && value) node.textContent = value;
  };
  brandText('.brand-word', SITE.brand?.wordmark);
  brandText('.brand-note', SITE.brand?.tagline);

  // The header menu, from content/navigation.json. Links are drawn once here
  // with English hrefs; buildPage() points them at each language and marks
  // the current tab. Every label carries a data-i18n key (see buildNav), so
  // the translation pass below rewrites the menu like any other string.
  const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const navLink = (item, className) => {
    const a = document.createElement('a');
    if (className) a.className = className;
    if (item.url) {
      a.setAttribute('href', item.url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.setAttribute('data-external', '');
    } else {
      a.setAttribute('href', href('en', item.page) + (item.section ? '#' + item.section : ''));
      a.setAttribute('data-tab', item.page.slug);
      if (item.section) a.setAttribute('data-section', item.section);
    }
    a.setAttribute('data-i18n', item.key);
    a.textContent = item.label;
    return a;
  };
  const lists = [
    ...[...document.querySelectorAll('[data-site-actions]')].map((list) => ({ list, only: (tab) => tab.button, suffix: '' })),
    ...[...document.querySelectorAll('[data-site-nav]')].map((list) => ({ list, only: () => true, suffix: '-m' })),
  ];
  for (const { list, only, suffix } of lists) {
    list.textContent = '';
    NAV.filter(only).forEach((tab) => {
      const li = document.createElement('li');
      li.className = 'nav-item' + (tab.button ? ' nav-item--cta' : '') + (tab.items.length ? ' has-menu' : '');
      // The pages this tab stands for, so buildPage can mark it current.
      li.setAttribute('data-pages', [tab.page.slug, ...tab.items.filter((i) => i.page && !i.section).map((i) => i.page.slug)].join(' '));
      li.appendChild(navLink(tab, tab.button ? 'nav-cta' : 'nav-link'));
      if (tab.items.length) {
        const menuId = 'menu-' + tab.page.slug + (tab.button ? suffix : '');
        const more = document.createElement('button');
        more.className = 'nav-more';
        more.setAttribute('type', 'button');
        more.setAttribute('aria-expanded', 'false');
        more.setAttribute('aria-controls', menuId);
        more.setAttribute('aria-label', 'More: ' + tab.label);
        more.innerHTML = CHEVRON;
        li.appendChild(more);
        const menu = document.createElement('ul');
        menu.className = 'nav-menu';
        menu.id = menuId;
        tab.items.forEach((item) => {
          const entry = document.createElement('li');
          entry.appendChild(navLink(item));
          menu.appendChild(entry);
        });
        li.appendChild(menu);
      }
      list.appendChild(li);
    });
  }

  // Footer: one link per tab.
  const footerNav = document.querySelector('[data-footer-nav]');
  if (footerNav) {
    footerNav.textContent = '';
    NAV.forEach((tab) => {
      const li = document.createElement('li');
      li.appendChild(navLink({ ...tab, items: [] }));
      footerNav.appendChild(li);
    });
  }

  /* The pages of the tab a page belongs to: the tab's own page first (unless
   * a dropdown entry already stands for it), then its dropdown pages. A page
   * listed under two tabs (Videos) takes the first; the home page has none. */
  const tabPages = (page) => {
    if (page.slug === PAGES[0].slug) return [];
    const tab = NAV.find((t) => t.page.slug === page.slug)
      || NAV.find((t) => t.items.some((i) => i.page && !i.url && i.page.slug === page.slug));
    if (!tab) return [];
    const entries = [];
    const seen = new Set();
    const add = (e) => { if (e.page && !e.url && !seen.has(e.page.slug)) { seen.add(e.page.slug); entries.push({ ...e, items: [], tabLabel: tab.label }); } };
    if (!tab.items.some((i) => i.page && i.page.slug === tab.page.slug)) add(tab);
    tab.items.forEach(add);
    return entries;
  };

  // Render every page's panel into <main id="content"> — the layout CSS
  // positions panels relative to that container, not <body>. All panels must
  // be present so captureEnglish/applyLanguage see every string once; the
  // per-page split keeps exactly one.
  const main = document.getElementById('content');
  PAGES.forEach((page, i) => {
    const parent = navParentOf(NAV, page.slug);
    const section = renderPage(document, page, {
      index: i + 1,
      total: PAGES.length,
      urlFor: (id) => href('en', pageById.get(id) || PAGES[0]),
      parent: parent ? { slug: parent.slug } : null
    });
    // Every tab and sub-tab is its own page. Under the page head, a bar lists
    // the pages of this page's tab (this one marked), and the foot of the page
    // leads on to the next one — so a tab reads as a set of pages, not one
    // long page. Labels carry the menu's translation keys.
    const group = tabPages(page);
    if (group.length > 1) {
      const here = group.findIndex((e) => e.page.slug === page.slug);
      const bar = document.createElement('nav');
      bar.className = 'subnav';
      bar.setAttribute('aria-label', group[0].tabLabel);
      const list = document.createElement('ul');
      group.forEach((entry, k) => {
        const li = document.createElement('li');
        const a = navLink(entry, 'subnav-link');
        if (k === here) { a.classList.add('is-current'); a.setAttribute('aria-current', 'page'); }
        li.appendChild(a);
        list.appendChild(li);
      });
      bar.appendChild(list);
      const head = section.querySelector('.page-head');
      if (head) head.after(bar);
      const next = group[here + 1];
      const wrap = section.querySelector('.content-wrap');
      if (next && wrap) {
        const foot = document.createElement('nav');
        foot.className = 'next-page';
        foot.setAttribute('aria-label', group[0].tabLabel);
        const a = navLink(next, 'next-page-link');
        // The translation pass rewrites the text of whatever carries the key,
        // so the label gets its own element and the arrow survives it.
        const label = document.createElement('span');
        label.setAttribute('data-i18n', a.getAttribute('data-i18n'));
        label.textContent = a.textContent;
        a.removeAttribute('data-i18n');
        a.textContent = '';
        a.appendChild(label);
        a.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>');
        foot.appendChild(a);
        wrap.appendChild(foot);
      }
    }
    section.setAttribute('hidden', '');
    main.appendChild(section);
  });

  // Behaviour module. data-base tells it where the site lives (search index,
  // language switching) when served under a path.
  document.body.setAttribute('data-base', BASE);
  // Site-wide header-photo settings (CMS: Site-wide → Logo & header photos).
  // Empty or standard (100) values leave the page exactly as designed.
  {
    const hp = SITE.headerPhoto || {};
    const pct = (v, lo, hi) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
    };
    const overlay = pct(hp.overlay, 0, 150);
    const brightness = pct(hp.brightness, 50, 150);
    if (overlay !== null && overlay !== 100) document.body.style.setProperty('--site-ov', String(overlay / 100));
    if (brightness !== null && brightness !== 100) {
      document.body.style.setProperty('--site-bright', String(brightness / 100));
      document.body.classList.add('site-bright');
    }
  }
  const app = document.createElement('script');
  app.setAttribute('type', 'module');
  app.setAttribute('src', '/assets/app.mjs');
  document.body.appendChild(app);

  /* Design preview (content/site.json "designPreview": true — the staging
     copy only): fifteen looks and a switcher bar. The inline script picks the
     design before first paint so a page never flashes the default first. */
  if (SITE.designPreview) {
    const head = document.querySelector('head');
    const pick = document.createElement('script');
    pick.textContent =
      "try{var D=['fn-copper','fn-light','fn-alllight','fn-ink','fn-clay','fn-olive','cl-bright','cl-forest','cl-limebar','cl-saffron','cl-glow','cl-lines','rangoli','mango','peacock','holi','turmeric','henna','lotus','paddy','thar','kesari','original','monsoon','terracotta','neem','mud','marigold','sandstone','wheat','dusk','laterite','bandhani','charcoal','contour','editorial']," +
      "q=new URLSearchParams(location.search).get('design'),d=q||localStorage.getItem('marvi-design');" +
      "if(q)localStorage.setItem('marvi-design',q);if(D.indexOf(d)>-1)document.documentElement.setAttribute('data-design',d);}catch(e){}";
    head.insertBefore(pick, head.firstChild);
    const css = document.createElement('link');
    css.setAttribute('rel', 'stylesheet');
    css.setAttribute('href', '/assets/variants/variants.css');
    head.appendChild(css);
    const js = document.createElement('script');
    js.setAttribute('type', 'module');
    js.setAttribute('src', '/assets/variants/switcher.js');
    document.body.appendChild(js);
  }

  return document;
}

/* ---------- URL rewriting ---------- */

const isAbsolute = (v) => /^(https?:|data:|mailto:|tel:|#|\/\/|\/)/.test(v);

// Cover photos and card art live in url() inside the inline <style> — a
// relative one silently resolves against the page directory one level down.
const absolutiseCss = (css) =>
  css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, quote, path) =>
    isAbsolute(path) ? whole : `url(${quote}/${path.replace(/^\.\//, '')}${quote})`
  );

const absolutise = (document) => {
  const fix = (node, attr) => {
    const v = node.getAttribute(attr);
    if (!v || isAbsolute(v)) return;
    node.setAttribute(attr, '/' + v.replace(/^\.\//, ''));
  };
  document.querySelectorAll('[src]').forEach((n) => fix(n, 'src'));
  document.querySelectorAll('link[href]').forEach((n) => fix(n, 'href'));
  document.querySelectorAll('a[href]').forEach((n) => fix(n, 'href'));
  document.querySelectorAll('style').forEach((n) => {
    n.textContent = absolutiseCss(n.textContent);
  });
  document.querySelectorAll('[style]').forEach((n) => {
    const v = n.getAttribute('style');
    if (v && v.includes('url(')) n.setAttribute('style', absolutiseCss(v));
  });
};

/* Prefix every site-absolute path with BASE (preview copies only). */
const rebaseCss = (css) =>
  BASE ? css.replace(/url\(\s*(['"]?)(\/(?!\/)[^'")]+)\1\s*\)/g, (whole, q, path) =>
    path.startsWith(BASE + '/') ? whole : `url(${q}${BASE}${path}${q})`) : css;
const rebase = (document) => {
  if (!BASE) return;
  const fix = (node, attr) => {
    const v = node.getAttribute(attr);
    if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith(BASE + '/')) return;
    node.setAttribute(attr, BASE + v);
  };
  document.querySelectorAll('[src]').forEach((n) => fix(n, 'src'));
  document.querySelectorAll('link[href]').forEach((n) => fix(n, 'href'));
  document.querySelectorAll('a[href]').forEach((n) => fix(n, 'href'));
  document.querySelectorAll('style').forEach((n) => { n.textContent = rebaseCss(n.textContent); });
  document.querySelectorAll('[style]').forEach((n) => {
    const v = n.getAttribute('style');
    if (v && v.includes('url(')) n.setAttribute('style', rebaseCss(v));
  });
};

/* ---------- per-page document surgery ---------- */

function buildPage(langHTML, lang, page) {
  const { document } = parseHTML(langHTML);

  // Metadata reads off the *translated* document so /hi/ pages get Hindi.
  const pageName = (
    document.querySelector(`[data-site-nav] a[data-tab="${page.slug}"]:not([data-section])`)?.textContent ||
    document.querySelector(`#panel-${page.slug} .page-head h1`)?.textContent ||
    page.menuName
  ).trim();
  const isHome = page.slug === PAGES[0].slug;
  const descSel = isHome
    ? `#panel-${page.slug} .hero-copy .lede`
    : `#panel-${page.slug} .page-head .lede`;
  const description = document.querySelector(descSel)?.textContent.trim() || '';

  // 1. Keep only this page's panel.
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    if (panel.getAttribute('data-panel') === page.slug) {
      panel.removeAttribute('hidden');
      panel.removeAttribute('role');
    } else {
      panel.remove();
    }
  });

  // 2. Menu links point at this language; the current page's tab is marked.
  document.querySelectorAll('a[data-tab]').forEach((link) => {
    const target = pageById.get(link.getAttribute('data-tab'));
    if (!target) return;
    const section = link.getAttribute('data-section');
    link.setAttribute('href', href(lang, target) + (section ? '#' + section : ''));
    if (target.slug === page.slug && !section && link.closest('[data-site-nav], [data-site-actions]')) {
      link.setAttribute('aria-current', 'page');
    }
  });
  document.querySelectorAll('.nav-item[data-pages]').forEach((li) => {
    if (li.getAttribute('data-pages').split(' ').includes(page.slug)) li.classList.add('is-current');
    li.removeAttribute('data-pages');
  });

  // 2b. Links inside the page body (buttons, story cards, tool cards) are
  //     rendered with English hrefs too; point them at this language, so a
  //     reader who chose Hindi stays in Hindi when they follow one.
  if (lang !== 'en') {
    const byEnglishPath = new Map(PAGES.map((p) => [href('en', p), p]));
    document.querySelectorAll('main a[href^="/"]').forEach((link) => {
      const [path, hash] = link.getAttribute('href').split('#');
      const target = byEnglishPath.get(path);
      if (target) link.setAttribute('href', href(lang, target) + (hash ? '#' + hash : ''));
    });
  }

  // 3. Any remaining [data-open] button (the sidebar brand) becomes a link;
  //    rendered blocks already emit real links with data-open kept as a hook.
  document.querySelectorAll('button[data-open]').forEach((btn) => {
    const target = pageById.get(btn.getAttribute('data-open'));
    if (!target) return;
    const link = document.createElement('a');
    link.className = btn.className;
    link.setAttribute('href', href(lang, target));
    if (btn.hasAttribute('aria-label')) link.setAttribute('aria-label', btn.getAttribute('aria-label'));
    link.innerHTML = btn.innerHTML;
    btn.replaceWith(link);
  });

  // 4. Language switcher: point page-relative so the choice stays on this page.
  const select = document.getElementById('lang-select');
  if (select) {
    select.setAttribute('data-lang-base', isHome ? '' : page.slug + '/');
    select.setAttribute('data-site-base', BASE);
    select.querySelectorAll('option').forEach((opt) => {
      if (opt.value === lang) opt.setAttribute('selected', 'selected');
      else opt.removeAttribute('selected');
    });
  }

  // 5. Head: title, description, canonical, alternates, social card.
  const head = document.querySelector('head');
  const title = isHome ? 'MARVI — Groundwater · India' : 'MARVI — ' + pageName;
  document.querySelector('title').textContent = title;

  const canonical = SITE_URL + href(lang, page);
  head.querySelectorAll('meta[name="description"]').forEach((n) => n.remove());
  const meta = (attr, key, value) => {
    if (!value) return;
    const tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    tag.setAttribute('content', value);
    head.appendChild(tag);
  };
  meta('name', 'description', description);
  // A preview copy (content/site.json "noindex": true) must not compete with
  // marvi.org.in in search results.
  if (SITE.noindex) meta('name', 'robots', 'noindex, nofollow');
  const link = (rel, hrefValue, hreflang) => {
    const tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    tag.setAttribute('href', hrefValue);
    if (hreflang) tag.setAttribute('hreflang', hreflang);
    head.appendChild(tag);
  };
  link('canonical', canonical);
  LANGS.forEach((l) => link('alternate', SITE_URL + href(l, page), l));
  link('alternate', SITE_URL + href('en', page), 'x-default');

  const socialSrc = (page.menuImage || page.heroImage || {}).image;
  const social = socialSrc
    ? SITE_URL + encodeURI(socialSrc.startsWith('/') ? socialSrc : '/' + socialSrc)
    : null;
  meta('property', 'og:type', 'website');
  meta('property', 'og:site_name', 'MARVI');
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:url', canonical);
  meta('property', 'og:locale', lang);
  meta('property', 'og:image', social);
  meta('name', 'twitter:card', 'summary_large_image');
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', description);
  meta('name', 'twitter:image', social);

  drawArrows(document);
  absolutise(document);
  rebase(document);
  return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}

/**
 * Replace any literal ↗ still in the text with the drawn arrow.
 *
 * The renderers no longer emit that character, but content can still contain
 * it — an editor types it, or it survives in an older page file — and on iOS
 * it renders as a blue emoji tile. Doing it here, on the finished per-language
 * document, catches content and translations alike without editing either.
 */
function drawArrows(document) {
  const walker = document.createTreeWalker(document.body, 4 /* SHOW_TEXT */);
  const hits = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const tag = node.parentNode?.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT') continue;
    if (node.nodeValue.includes('↗')) hits.push(node);
  }
  hits.forEach((node) => {
    const parts = node.nodeValue.split('↗');
    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
      if (i > 0) frag.appendChild(arrowIcon(document));
      if (part) frag.appendChild(document.createTextNode(part));
    });
    node.parentNode.replaceChild(frag, node);
  });
}

/* ---------- run ---------- */

const composed = composeDocument();
const LANGS = [...composed.querySelectorAll('#lang-select option')].map((o) => o.value);
const englishBase = captureEnglish(composed, SECTION_IDS);
const composedHTML = composed.documentElement.outerHTML;

const write = (relPath, body) => {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
};

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

let count = 0;
for (const lang of LANGS) {
  const { document } = parseHTML(composedHTML);
  const base = captureEnglish(document, SECTION_IDS);
  base.EN = englishBase.EN;
  base.EN_BODY = englishBase.EN_BODY;
  base.EN_ALT = englishBase.EN_ALT;
  applyLanguage(document, base, i18n, lang);
  const langHTML = document.documentElement.outerHTML;
  for (const page of PAGES) {
    const rel = href(lang, page).replace(/^\//, '');
    write(join(rel, 'index.html'), buildPage(langHTML, lang, page));
    count++;
  }
  if (lang === 'en') write('404.html', buildPage(langHTML, 'en', PAGES[0]));
  /* A page's former addresses (formerSlugs) forward to where it lives now, so
   * old links, bookmarks and printed QR codes keep working after a rename. */
  for (const page of PAGES) {
    for (const former of page.formerSlugs || []) {
      if (!/^[a-z0-9-]+$/.test(former) || PAGES.some((p) => p.slug === former)) continue;
      const to = BASE + href(lang, page);
      const from = href(lang, { ...page, slug: former });
      write(join(from.replace(/^\//, ''), 'index.html'),
        `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${page.menuName}</title>` +
        `<link rel="canonical" href="${SITE_URL}${href(lang, page)}"><meta name="robots" content="noindex">` +
        `<meta http-equiv="refresh" content="0; url=${to}"></head>` +
        `<body><p>This page has moved: <a href="${to}">${page.menuName}</a>.</p></body></html>`);
    }
  }
}

/* ---------- static passthrough ---------- */

for (const dir of ['assets', 'content', 'admin']) {
  if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
}
cpSync(join(ROOT, 'src/app.mjs'), join(OUT, 'assets/app.mjs'));
// The CMS preview renders entries with the very same renderer the site uses,
// so publish it as a module the admin page can import, plus the site's CSS
// lifted out of the template for the preview iframe to load.
cpSync(join(ROOT, 'src/templates.mjs'), join(OUT, 'assets/templates.mjs'));
write(
  'assets/site.css',
  rebaseCss(absolutiseCss([...probeStyles.querySelectorAll('style')].map((n) => n.textContent).join('\n')))
);
if (HAS_CNAME) cpSync(join(ROOT, 'CNAME'), join(OUT, 'CNAME'));
write('.nojekyll', '');

/* The CMS config is a template: repository, branch, site address and the
 * public media path come from content/site.json `cms` and the base path, so a
 * preview copy edits its own repository and never the live one. */
const cmsConfig = join(OUT, 'admin/config.yml');
if (existsSync(cmsConfig) && SITE.cms) {
  let config = readFileSync(cmsConfig, 'utf8');
  config = config
    .replace(/^(\s*repo:).*$/m, `$1 ${SITE.cms.repo}`)
    .replace(/^(\s*branch:).*$/m, `$1 ${SITE.cms.branch || 'main'}`)
    .replace(/^site_url:.*$/m, `site_url: ${SITE_URL}`)
    .replace(/^display_url:.*$/m, `display_url: ${SITE_URL}`)
    .replace(/^public_folder:\s*"\/assets\//m, `public_folder: "${BASE}/assets/`);
  writeFileSync(cmsConfig, config);
}

/* The search index: every page and section heading, every publication,
 * media story, film and person on the site, in English. */
const plain = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const slugish = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const searchEntries = [];
for (const page of PAGES) {
  const url = href('en', page);
  searchEntries.push({ k: 'Page', t: plain(page.intro?.title) || page.menuName, u: url, x: plain(page.intro?.lede).slice(0, 180) });
  for (const b of page.blocks || []) {
    if (b.visible === false) continue;
    if ((b.type === 'banner' || b.type === 'storyCards') && plain(b.title)) searchEntries.push({ k: page.menuName, t: plain(b.title), u: url + '#s-' + slugish(b.title), x: plain(b.lede || b.eyebrow).slice(0, 160) });
    if (b.type === 'publicationList') (b.items || []).forEach((i) => searchEntries.push({ k: 'Publication', t: plain(i.title), u: url, x: plain(i.meta || i.description).slice(0, 160) }));
    if (b.type === 'mediaStories') (b.items || []).forEach((i) => searchEntries.push({ k: 'In the media', t: plain(i.title), u: i.url || url, x: plain(i.meta) }));
    if (b.type === 'filmGrid') (b.items || []).forEach((i) => searchEntries.push({ k: 'Video', t: plain(i.title), u: i.url || url, x: plain(i.meta) }));
    if (b.type === 'portraitBand') (b.items || []).forEach((i) => i.name && searchEntries.push({ k: 'Person', t: plain(i.name), u: url, x: [i.title, i.affiliation].filter(Boolean).map(plain).join(', ') }));
    if (b.type === 'partnerList') (b.items || []).forEach((i) => i.name && searchEntries.push({ k: 'Partner', t: plain(i.name), u: i.url || url, x: plain(i.meta) }));
  }
}
write('assets/search.json', JSON.stringify(searchEntries));

const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
  'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  LANGS.flatMap((lang) =>
    PAGES.map(
      (page) =>
        '  <url>\n    <loc>' + SITE_URL + href(lang, page) + '</loc>\n' +
        LANGS.map(
          (l) => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + SITE_URL + href(l, page) + '"/>\n'
        ).join('') +
        '  </url>'
    )
  ).join('\n') +
  '\n</urlset>\n';
write('sitemap.xml', sitemap);
write('robots.txt', SITE.noindex ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');

console.log(`Built ${count} pages (${PAGES.length} pages × ${LANGS.length} languages) into _site/`);
