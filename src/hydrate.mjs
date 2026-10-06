/**
 * Content hydration + translation, as pure DOM transforms.
 *
 * Every function here takes a `document` rather than reaching for a global, so
 * the same code runs in the browser and under linkedom at build time. Keep it
 * that way: no fetch, no localStorage, no addEventListener, no window. Browser-
 * only glue (search inputs, the lightbox, the language <select>) lives in
 * index.html; anything that changes what the page *says* belongs here, so the
 * static build and the live page can never disagree.
 */

/* ---------- tiny DOM helpers ---------- */

const el = (document, tag, opts = {}) => {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  return node;
};

const setText = (root, sel, value) => {
  const node = root && root.querySelector(sel);
  if (node && value != null) node.textContent = value;
};

const setMultiline = (document, root, sel, value) => {
  const node = root && root.querySelector(sel);
  if (!node || value == null) return;
  node.textContent = '';
  String(value).split('\n').forEach((line, i) => {
    if (i > 0) node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode(line));
  });
};

const ytId = (url) => {
  const m =
    String(url || '').match(/[?&]v=([^&]+)/) ||
    String(url || '').match(/youtu\.be\/([^?&]+)/);
  return m ? m[1] : '';
};

// Optional per-image crop controls. 'auto'/blank = leave the CSS default.
const applyFit = (img, focus, fit) => {
  if (focus && focus !== 'auto') img.style.objectPosition = focus;
  if (fit && fit !== 'auto') img.style.objectFit = fit;
};

/* ---------- content ---------- */

/**
 * Apply the CMS content files to the document.
 * `content` is { home, sections, media, films, partners, images, portraits, menu },
 * each either the parsed JSON or null. A missing file leaves the authored
 * fallback markup untouched.
 */
export function hydrate(document, content = {}) {
  const { home, sections, media, films, partners, images, portraits, menu } = content;

  // --- Hero (homepage.json) ---
  if (home) {
    const hero = document.querySelector('#panel-home .hero-copy');
    if (hero) {
      setText(hero, '.eyebrow', home.eyebrow);
      setMultiline(document, hero, 'h1', home.heroTitle);
      setText(hero, '.lede', home.heroBody);
      if (home.heroImage) {
        const heroImg = document.querySelector('#panel-home .hero-image-main');
        if (heroImg) {
          heroImg.src = home.heroImage;
          applyFit(heroImg, home.heroImageFocus, home.heroImageFit);
        }
      }
      [['approach', home.primaryButtonLabel], ['mywell', home.secondaryButtonLabel]].forEach(
        ([key, label]) => {
          const btn = hero.querySelector('button[data-open="' + key + '"]');
          if (btn && label != null) {
            const arrow = btn.querySelector('span');
            btn.textContent = label + ' ';
            if (arrow) btn.appendChild(arrow);
          }
        }
      );
    }
  }

  // --- Section intros (sections.json) ---
  if (sections) {
    Object.keys(sections).forEach((key) => {
      const head = document.querySelector('#panel-' + key + ' .page-head');
      const data = sections[key];
      if (!head || !data) return;
      setText(head, '.eyebrow', data.eyebrow);
      setText(head, 'h1', data.title);
      setText(head, '.lede', data.lede);
    });
  }

  // --- Media stories (media.json) ---
  if (media && Array.isArray(media.items)) {
    const grid = document.getElementById('media-grid');
    const count = document.getElementById('media-count');
    if (grid) {
      grid.textContent = '';
      media.items.forEach((item) => {
        const a = el(document, 'a', { class: 'media-card' });
        a.href = item.url || '#';
        a.target = '_blank';
        a.rel = 'noopener';
        a.setAttribute(
          'data-search',
          [item.meta, item.title, item.description].filter(Boolean).join(' ').toLowerCase()
        );
        a.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
        a.appendChild(el(document, 'h3', { text: item.title }));
        a.appendChild(el(document, 'p', { text: item.description }));
        a.appendChild(el(document, 'span', { class: 'read', text: 'Read story ↗' }));
        grid.appendChild(a);
      });
      const n = media.items.length;
      if (count) count.textContent = n + (n === 1 ? ' selected story' : ' selected stories');
    }
  }

  // --- Films (films.json) ---
  if (films && Array.isArray(films.items)) {
    const grid = document.querySelector('#panel-films .video-grid');
    if (grid) {
      grid.textContent = '';
      films.items.forEach((item) => {
        const a = el(document, 'a', { class: 'video-card' });
        a.href = item.url || '#';
        a.target = '_blank';
        a.rel = 'noopener';
        const wrap = el(document, 'div', { class: 'video-image' });
        const img = el(document, 'img');
        img.loading = 'lazy';
        const id = ytId(item.url);
        if (id) img.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
        img.alt = item.title || '';
        const play = el(document, 'span', { class: 'play' });
        play.setAttribute('aria-hidden', 'true');
        wrap.appendChild(img);
        wrap.appendChild(play);
        a.appendChild(wrap);
        a.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
        a.appendChild(el(document, 'h3', { text: item.title }));
        grid.appendChild(a);
      });
    }
  }

  // --- People & partners (partners.json) ---
  if (partners && Array.isArray(partners.items)) {
    const grid = document.querySelector('#panel-people .people-grid');
    if (grid) {
      grid.textContent = '';
      partners.items.forEach((item) => {
        const card = el(document, 'article', { class: 'people-card' });
        card.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
        const h3 = el(document, 'h3');
        if (item.url) {
          const a = el(document, 'a', { text: (item.name || '') + ' ↗' });
          a.href = item.url;
          a.target = '_blank';
          a.rel = 'noopener';
          h3.appendChild(a);
        } else {
          h3.textContent = item.name || '';
        }
        card.appendChild(h3);
        grid.appendChild(card);
      });
    }
  }

  // --- Section images (images.json → any element with data-img) ---
  if (images) {
    document.querySelectorAll('[data-img]').forEach((img) => {
      const entry = images[img.getAttribute('data-img')];
      if (!entry) return;
      const src = typeof entry === 'string' ? entry : entry.image;
      if (src) img.src = src;
      if (entry && typeof entry === 'object') applyFit(img, entry.focus, entry.fit);
    });
  }

  // --- Menu card photos (menu.json → nav tabs, shown on mobile) ---
  if (menu) {
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      const entry = menu[tab.getAttribute('data-tab')];
      const thumb = tab.querySelector('.nav-thumb');
      if (entry && thumb) {
        thumb.src = entry.image;
        applyFit(thumb, entry.focus, entry.fit);
      }
    });
  }

  // --- People portrait band (portraits.json) ---
  if (portraits && Array.isArray(portraits.items)) {
    const band = document.querySelector('#panel-people .portrait-band');
    if (band) {
      band.textContent = '';
      portraits.items.forEach((item) => {
        if (!item || !item.image) return;
        const img = el(document, 'img');
        img.loading = 'lazy';
        img.src = item.image;
        img.alt = 'MARVI team member portrait';
        applyFit(img, item.focus, item.fit);
        band.appendChild(img);
      });
    }
  }

  return document;
}

/* ---------- translation ---------- */

// The sections that shipped with the site. Pages created in the CMS are added
// to this at build time, which is why the slot list below is derived from a
// page list rather than hardcoded — a new page must pick up translations too.
export const SECTION_KEYS = [
  'approach', 'bjs', 'groundwater', 'mywell', 'media', 'films', 'game', 'people', 'archive'
];

export const RTL_LANGS = ['ar'];

/**
 * The "spine": strings that live in known places rather than being tagged with
 * data-i18n. Keys match the ones auto-translate.mjs writes into i18n.json.
 * `sectionIds` is every page except home, in nav order.
 */
export const buildSlots = (sectionIds = SECTION_KEYS) => [
  // The page names in the header menu are not slots: each menu link carries
  // its own data-i18n key (nav.<slug> when its label is the page's name), so
  // the same name can appear in a tab and in a dropdown and translate in both.
  // sectionIds is still taken for the page-head slots below.
  { key: 'hero.eyebrow', sel: '#panel-home .hero-copy .eyebrow' },
  { key: 'hero.title', sel: '#panel-home .hero-copy h1', multiline: true },
  { key: 'hero.body', sel: '#panel-home .hero-copy .lede' },
  { key: 'hero.btn1', sel: '#panel-home .hero-copy [data-open="approach"]', button: true },
  { key: 'hero.btn2', sel: '#panel-home .hero-copy [data-open="mywell"]', button: true },
  ...sectionIds.flatMap((k) => [
    { key: 'sec.' + k + '.eyebrow', sel: '#panel-' + k + ' .page-head .eyebrow' },
    { key: 'sec.' + k + '.title', sel: '#panel-' + k + ' .page-head h1' },
    { key: 'sec.' + k + '.lede', sel: '#panel-' + k + ' .page-head .lede' }
  ])
];

const readSlot = (document, slot) => {
  const node = document.querySelector(slot.sel);
  if (!node) return null;
  if (slot.multiline) {
    return Array.from(node.childNodes)
      .map((n) => (n.nodeName === 'BR' ? '\n' : n.textContent))
      .join('');
  }
  if (slot.button) {
    return (node.childNodes[0] ? node.childNodes[0].textContent : '').trim();
  }
  return node.textContent;
};

const writeSlot = (document, slot, value, rtl) => {
  const node = document.querySelector(slot.sel);
  if (!node) return;
  node.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  if (value == null) return;
  if (slot.multiline) {
    node.textContent = '';
    String(value).split('\n').forEach((line, i) => {
      if (i > 0) node.appendChild(document.createElement('br'));
      node.appendChild(document.createTextNode(line));
    });
    return;
  }
  if (slot.button) {
    const arrow = node.querySelector('span');
    node.textContent = value + ' ';
    if (arrow) node.appendChild(arrow);
    return;
  }
  node.textContent = value;
};

/**
 * Snapshot the English copy currently in the DOM. Must be called after
 * hydrate() and before any applyLanguage(), because English is read live from
 * the page rather than stored — that way it always matches the CMS content.
 */
export function captureEnglish(document, sectionIds) {
  const slots = buildSlots(sectionIds);
  const EN = {};
  slots.forEach((s) => {
    const v = readSlot(document, s);
    if (v != null) EN[s.key] = v;
  });
  const bodyNodes = [...document.querySelectorAll('[data-i18n]')];
  const EN_BODY = {};
  bodyNodes.forEach((n) => {
    EN_BODY[n.getAttribute('data-i18n')] = n.textContent;
  });
  // Alt text is a string a reader can hear, so it gets translated too — but it
  // lives in an attribute, which the textContent path above cannot reach.
  const EN_ALT = {};
  [...document.querySelectorAll('[data-i18n-alt]')].forEach((n) => {
    EN_ALT[n.getAttribute('data-i18n-alt')] = n.getAttribute('alt') || '';
  });
  return { slots, EN, EN_BODY, EN_ALT };
}

/** Swap the document into `lang`, falling back to English per-string. */
export function applyLanguage(document, base, i18n, lang) {
  const { slots, EN, EN_BODY, EN_ALT = {} } = base;
  const rtl = RTL_LANGS.indexOf(lang) !== -1;
  document.documentElement.lang = lang;
  if (rtl) document.documentElement.setAttribute('dir', 'rtl');
  else document.documentElement.removeAttribute('dir');

  slots.forEach((s) => {
    const t =
      lang !== 'en' && i18n[lang] && i18n[lang][s.key] != null ? i18n[lang][s.key] : EN[s.key];
    writeSlot(document, s, t, rtl);
  });
  [...document.querySelectorAll('[data-i18n]')].forEach((n) => {
    const key = n.getAttribute('data-i18n');
    const t = lang !== 'en' && i18n[lang] && i18n[lang][key] != null ? i18n[lang][key] : EN_BODY[key];
    if (t != null) n.textContent = t;
    n.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  });
  [...document.querySelectorAll('[data-i18n-alt]')].forEach((n) => {
    const key = n.getAttribute('data-i18n-alt');
    const t = lang !== 'en' && i18n[lang] && i18n[lang][key] != null ? i18n[lang][key] : EN_ALT[key];
    if (t != null) n.setAttribute('alt', t);
  });
  return document;
}
