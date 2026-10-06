/**
 * Page + block renderers.
 *
 * Every page on the site is rendered from its content/pages/<id>.json by these
 * functions at build time. The markup they emit is byte-compatible with what
 * the old hand-authored panels / runtime renderers produced — same classes,
 * same ids, same attributes — so the existing stylesheet and the migrated
 * pages' #panel-<id> CSS keep working untouched.
 *
 * Translation: any string that was translated under the old system carries its
 * legacy key in the block's `i18n` map (written by scripts/migrate.mjs); the
 * renderer re-emits it as data-i18n. Strings without a legacy key get a
 * generated `page.<slug>.b<n>.<path>` key, which makes them translatable the
 * moment the translation provider is restored (phase 3) while changing
 * nothing today.
 *
 * Isomorphic rule: take `document`, touch no globals — the same code must run
 * under linkedom at build time and, if ever needed, in a browser.
 */

/* ---------- generic helpers ---------- */

const el = (document, tag, opts = {}) => {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.key) node.setAttribute('data-i18n', opts.key);
  return node;
};

/** Text with \n rendered as <br> (hero title, image labels). */
const multiline = (document, node, value) => {
  node.textContent = '';
  String(value ?? '').split('\n').forEach((line, i) => {
    if (i > 0) node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode(line));
  });
  return node;
};

/* Mirror of layout-model.js (the runtime's MarviLayout) — the maths the CMS
 * layout controls are defined by. Kept in sync by hand; it is 12 lines. */
const clamp = (value, min, max, fallback) => {
  // The CMS stores an untouched number field as null; that means "default",
  // not zero (Number(null) is 0, which would clamp brightness to 20%).
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* An object field the editor has not filled in arrives as null, and a default
 * parameter does not catch null — only undefined. Every renderer below takes
 * its optional objects through this, so a half-filled entry renders a partial
 * page instead of throwing. That is what the CMS preview shows you while you
 * type, and the build reads the same data, so it protects both. */
const opt = (value) => (value == null ? {} : value);

export const photoLayout = (entry) => {
  const data = opt(entry);
  const zoom = clamp(data.zoom, 50, 200, 100);
  return {
    x: clamp(data.positionX, 0, 100, 50),
    y: clamp(data.positionY, 0, 100, 50),
    scale: zoom / 100,
    // 100 is "as shot" and emits nothing, so a photo nobody has adjusted
    // carries no filter at all and its markup is unchanged.
    brightness: clamp(data.brightness, 20, 200, 100),
    fit: data.fit && data.fit !== 'auto' ? data.fit : 'cover'
  };
};
export const textLayout = (entry) => {
  const data = opt(entry);
  return {
    width: clamp(data.textWidth, 30, 100, 100),
    offsetX: clamp(data.textOffsetX, -30, 30, 0),
    offsetY: clamp(data.textOffsetY, -30, 30, 0)
  };
};

/* Stands in for a picture nobody has uploaded yet, in the blocks whose whole
 * shape is a row or grid of images. Rendering the slot with this keeps the
 * composition intact; dropping the slot silently re-flows everything around a
 * hole the editor cannot see. */
const PLACEHOLDER_IMAGE = '/assets/placeholder-image.svg';

/**
 * Photo entry ({image, zoom, positionX, positionY, brightness, fit, alt}) → <img>.
 *
 * `placeholder: true` substitutes the stand-in when no image is set. It is
 * opt-in rather than automatic: an optional photo elsewhere — a column that is
 * text this time, a card with no art — should render nothing at all, not a
 * grey box announcing an absence nobody intended.
 */
const photo = (document, raw, { alt, lazy = true, className, placeholder = false } = {}) => {
  const entry = opt(raw);
  const img = el(document, 'img', { class: className });
  if (entry.image) img.src = entry.image;
  else if (placeholder) {
    img.src = PLACEHOLDER_IMAGE;
    // The layout crops photos to fill their slot; cropping a glyph would just
    // hide it, so the class switches this one to fit-inside.
    img.classList.add('is-placeholder');
  }
  img.alt = alt ?? entry.alt ?? '';
  if (lazy) img.setAttribute('loading', 'lazy');
  const layout = photoLayout(entry);
  if (layout.x !== 50 || layout.y !== 50) img.style.objectPosition = `${layout.x}% ${layout.y}%`;
  if (layout.scale !== 1) img.style.scale = String(layout.scale);
  if (layout.brightness !== 100) img.style.filter = `brightness(${layout.brightness}%)`;
  if (entry.fit && entry.fit !== 'auto') img.style.objectFit = layout.fit;
  return img;
};

/**
 * Set an href from CMS data.
 *
 * An editor who pastes `www.linkedin.com/in/…` means a website. A browser
 * reads a value with no scheme as a path relative to the current page, so that
 * link lands on marvi.org.in/www.linkedin.com/… and 404s.
 *
 * Worse, it does so invisibly: assigning to the `.href` *property* lets the
 * DOM resolve the value against the document, which rewrote it to
 * `/www.linkedin.com/…` — leading slash and all. That reads as a perfectly
 * ordinary root-relative path, which is exactly what the build's link check
 * treats as valid, so a dead link shipped with every check green.
 *
 * So: give plainly-external addresses their scheme back, and write the
 * attribute rather than the property, so what was authored is what ships and
 * the checks see the real value.
 */
const setHref = (node, raw) => {
  const value = String(raw ?? '').trim();
  const href = !value || /^(https?:|mailto:|tel:|#|\/)/i.test(value) ? value : 'https://' + value;
  node.setAttribute('href', href);
};

/**
 * The outbound arrow, drawn rather than typed.
 *
 * It used to be the character ↗ (U+2197), which also has an emoji form (↗️).
 * The site's text fonts carry no glyph for it, so iOS and Android fell through
 * to the colour emoji font and every arrow — most visibly on each nav card —
 * rendered as a blue tile. Confirmed on an iPhone simulator, where
 * `font-variant-emoji: text` did nothing: the substitution happens because the
 * glyph is missing, not because a presentation was picked.
 *
 * An inline SVG has no font to fall back from, so it looks the same
 * everywhere. It is aria-hidden — "opens in a new tab" is already carried by
 * the link, and a decorative arrow read aloud is noise.
 */
export const arrowIcon = (document) => {
  const span = el(document, 'span', { class: 'ext-arrow' });
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 8.6 8.6 3.4"/>' +
    '<path d="M4.6 3.4h4v4"/></svg>';
  return span;
};

/** Label plus the drawn arrow, replacing the old `label + ' ↗'` strings. */
const labelWithArrow = (document, node, text) => {
  node.textContent = text + ' ';
  node.appendChild(arrowIcon(document));
  return node;
};

/* ---------- link icons ---------- */

/* The icon set an entry can draw on. Each value is the inside of a 24-box SVG,
 * stroked (or, for the two brand marks, filled) in currentColor — so the card
 * decides the colour and nothing here does. `link` is the fallback: an unknown
 * or blank icon name renders a generic chain rather than nothing, because a
 * link the editor can see but the reader cannot is the worse failure. */
const ICON_SHAPES = {
  website:
    '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c2.4 2.7 2.4 14.5 0 17.2M12 3.4c-2.4 2.7-2.4 14.5 0 17.2"/>',
  linkedin:
    '<path d="M5 3.3a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8zM3.2 9.3h3.6V21H3.2zM9.4 9.3H13v1.7h.05c.5-.95 1.75-1.95 3.6-1.95 3.85 0 4.55 2.4 4.55 5.5V21h-3.8v-5.35c0-1.28-.02-2.92-1.8-2.92-1.8 0-2.07 1.38-2.07 2.82V21H9.4z"/>',
  profile: '<circle cx="12" cy="8" r="3.8"/><path d="M4.6 20.6c1.2-3.9 4-5.9 7.4-5.9s6.2 2 7.4 5.9"/>',
  email: '<rect x="3" y="5.4" width="18" height="13.2" rx="2.2"/><path d="m3.9 7 8.1 6 8.1-6"/>',
  document: '<path d="M6.2 2.9h7.3L18.8 8v13.1H6.2z"/><path d="M13.3 3.1v5h5.3"/><path d="M9 12.6h7M9 16h5"/>',
  publication: '<path d="M3.4 5.2h6.2c1.4 0 2.4.9 2.4 2v12c0-1.1-1-2-2.4-2H3.4zM20.6 5.2h-6.2c-1.4 0-2.4.9-2.4 2v12c0-1.1 1-2 2.4-2h6.2z"/>',
  video: '<rect x="2.9" y="5" width="18.2" height="14" rx="2.6"/><path d="M10.1 9.2v5.6l4.7-2.8z"/>',
  location: '<path d="M12 21.2c4-4.4 6-7.9 6-10.5a6 6 0 1 0-12 0c0 2.6 2 6.1 6 10.5z"/><circle cx="12" cy="10.6" r="2.3"/>',
  link:
    '<path d="M10.4 13.6a4.2 4.2 0 0 0 6 0l2.4-2.4a4.2 4.2 0 0 0-6-6l-1.4 1.4"/><path d="M13.6 10.4a4.2 4.2 0 0 0-6 0l-2.4 2.4a4.2 4.2 0 0 0 6 6l1.4-1.4"/>'
};
/* Brand marks are shapes, not line drawings — stroking them makes mush. */
const FILLED_ICONS = new Set(['linkedin']);
const ICON_LABELS = {
  website: 'Website',
  linkedin: 'LinkedIn',
  profile: 'Profile',
  email: 'Email',
  document: 'Document',
  publication: 'Publications',
  video: 'Video',
  location: 'Map',
  link: 'Link'
};

/**
 * The row of small round icon links under a name.
 *
 * This is deliberately separate from the entry's `url`: `url` is what the card
 * itself opens, and every entry in `links` is an extra destination the reader
 * can choose. That split is the whole point — an editor can send the card to a
 * staff profile and still offer LinkedIn beside it, without either choice
 * costing the other.
 *
 * Entries with no URL are dropped rather than rendered dead, so a half-filled
 * row in the CMS shows what it will actually publish.
 */
const linkRow = (document, links, context) => {
  if (!links.length) return null;
  const row = el(document, 'span', { class: 'card-links' });
  links.forEach((link) => {
    const kind = ICON_SHAPES[link.icon] ? link.icon : 'link';
    const anchor = el(document, 'a', { class: 'card-link' });
    setHref(anchor, link.url);
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener');
    anchor.setAttribute('data-icon', kind);
    // The visible label is an icon, so the accessible name has to carry both
    // what the link is and whose it is — "LinkedIn" alone, twenty-eight times
    // down a screen reader's link list, identifies nothing. An editor-written
    // label is taken as the whole name, though: it already says who, and
    // appending the card's name to it only stutters.
    const name = link.label || (context ? `${ICON_LABELS[kind]} — ${context}` : ICON_LABELS[kind]);
    anchor.setAttribute('title', name);
    anchor.setAttribute('aria-label', name);
    const paint = FILLED_ICONS.has(kind)
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
    anchor.innerHTML =
      `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${paint}>${ICON_SHAPES[kind]}</svg>`;
    row.appendChild(anchor);
  });
  return row;
};

/**
 * How one entry offers its links.
 *
 * The two ways are mutually exclusive, and not by preference: an <a> inside an
 * <a> is invalid HTML and browsers recover by breaking the inner one. So a card
 * cannot both be a link and contain links, and something has to choose. That
 * choice belongs to the editor, not to this function —
 *
 *   auto     the old behaviour: whole-card link until the entry has extra
 *            links, then buttons. Nothing to decide until there is something
 *            to decide.
 *   buttons  always buttons; the name carries the main link.
 *   card     always one big link; extra links are not rendered.
 */
const linkMode = (block, item) => {
  const style = ['buttons', 'card'].includes(block.linkStyle) ? block.linkStyle : 'auto';
  const links = style === 'card' ? [] : (opt(item).links || []).filter((link) => link && link.url);
  const wholeCard = Boolean(item.url) && (style === 'card' || (style === 'auto' && !links.length));
  return { links, wholeCard };
};

/* Stands in for a portrait nobody has uploaded yet. A neutral drawn figure and
 * not a stock face: an entry with no photo must not borrow someone else's. */
const PLACEHOLDER_PORTRAIT = '/assets/placeholder-portrait.svg';

/** An organisation's logo, if it has one and the block is showing them. */
const logoFrame = (document, item, show) => {
  const logo = opt(item.logo);
  if (!show || !logo.image) return null;
  const frame = el(document, 'span', { class: 'org-logo' + (logo.onDark ? ' is-on-dark' : '') });
  frame.appendChild(photo(document, logo, { alt: logo.alt || (item.name ? item.name + ' logo' : '') }));
  return frame;
};

/** The intro sizing/placement controls, applied to a head root at build time. */
const applyTextControls = (root, raw) => {
  const intro = opt(raw);
  const scale = (sel, value) => {
    const node = root.querySelector(sel);
    if (node) node.setAttribute('data-cms-text-scale', String(clamp(value, 0, 200, 100)));
  };
  scale('.eyebrow', intro.eyebrowSize);
  scale('h1', intro.titleSize);
  scale('.lede', intro.ledeSize);
  if (['left', 'center', 'right'].includes(intro.textAlign)) {
    root.setAttribute('data-text-align', intro.textAlign);
  }
  if (['top', 'middle', 'bottom'].includes(intro.textPosition)) {
    root.setAttribute('data-text-position', intro.textPosition);
  }
  const layout = textLayout(intro);
  root.style.setProperty('--cms-text-width', layout.width + '%');
  root.style.setProperty('--cms-text-offset-x', layout.offsetX + '%');
  root.style.setProperty('--cms-text-offset-y', layout.offsetY + '%');
};

/** The page-head cover photo custom properties (mirror of applyHeroLayout). */
const applyCoverControls = (root, raw) => {
  const entry = opt(raw);
  if (!entry.image) return;
  const layout = photoLayout(entry);
  root.style.setProperty('--cover', `url("${String(entry.image).replaceAll('"', '%22')}")`);
  root.style.setProperty('--cms-photo-position', `${layout.x}% ${layout.y}%`);
  root.style.setProperty('--cms-photo-scale', String(layout.scale));
  // The cover is painted on .page-head::before, so a filter here dims the
  // photograph and leaves the headline sitting on top of it untouched.
  if (layout.brightness !== 100) {
    root.style.setProperty('--cms-photo-brightness', layout.brightness + '%');
  }
  root.style.setProperty('--cms-photo-fit', layout.fit);
};

const ytId = (url) => {
  const m =
    String(url || '').match(/[?&]v=([^&]+)/) || String(url || '').match(/youtu\.be\/([^?&]+)/);
  return m ? m[1] : '';
};

/**
 * Look up a legacy translation key inside a block's `i18n` map.
 *
 * The map is addressed by the string path of the field inside the block —
 * "right.paragraphs.0" — but it is STORED with "__" where those dots would be,
 * and that is deliberate. A CMS that holds draft content flattened by "." (as
 * Sveltia does) unflattens {"right.paragraphs.0": k} into
 * {right: {paragraphs: [k]}} when it saves, after which this lookup returns
 * undefined and the string silently loses its curated translation in all 13
 * languages. Keys without dots survive that round trip untouched.
 *
 * Keep the "." form in call sites and in the generated fallback key: only the
 * stored map is escaped.
 */
const i18nKey = (path) => String(path).replaceAll('.', '__');

/* ---------- brand mark ---------- */

/**
 * The sidebar badge, drawn as a section through the ground.
 *
 * Inside the badge is a water table with a recharge mound under the middle,
 * the aquifer filling below it, and a hairline well dropping through the
 * crest — a check dam upstream raising the table under a village well is what
 * the project does, and it is the same curve its own figures solve.
 *
 * The drawing fills the badge and is clipped by it, so water finds its level
 * in whatever silhouette contains it. That is what makes the shape safe to
 * hand to an editor: every option below is the same mark in a different
 * vessel, not a different mark.
 */
export const BRAND_SHAPES = ['circle', 'rounded', 'squircle', 'wellhead'];

const BRAND_TONES = {
  // Palette values only, so no combination can fall outside the site's colours.
  water: { body: 'rgba(120,174,180,.5)', line: '#a8d6da', well: '#b66b43' },
  copper: { body: 'rgba(182,107,67,.48)', line: '#dda57e', well: '#9fd0d4' },
  chalk: { body: 'rgba(255,255,255,.24)', line: 'rgba(255,255,255,.85)', well: '#b66b43' }
};

/* Attribute values are content, and content is written by editors. Anything
 * interpolated into markup as a string goes through here first. */
const attr = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * → { shape, svg }. Unknown values fall back rather than rendering nothing.
 *
 * An uploaded image wins over the drawing. The drawing is still the default,
 * and still the better answer at 34px — but "we have our own logo file" is not
 * a case a fixed set of shapes and tones can ever cover, so the badge accepts
 * one. The shape keeps applying either way: it is the frame, not the artwork.
 */
export const brandMark = (raw) => {
  const brand = opt(raw);
  const shape = BRAND_SHAPES.includes(brand.shape) ? brand.shape : 'circle';
  if (brand.image) {
    const fit = brand.fit === 'contain' ? 'contain' : 'cover';
    // The badge sits inside a button labelled "MARVI home" and its span is
    // aria-hidden, so the image is decorative: an alt here would be read out
    // twice or, worse, fight the button's own name.
    return {
      shape,
      svg: `<img src="${attr(brand.image)}" alt="" data-fit="${fit}" width="44" height="44">`
    };
  }
  const tone = BRAND_TONES[brand.tone] || BRAND_TONES.water;
  // The water table, mounded under the middle — highest where the recharge is,
  // tapering to nothing at the boundaries.
  const table = 'M0 27C8 27 12 20 20 20s12 7 20 7';
  const svg =
    '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">' +
    // The land surface. One line, and it is the line that does the most work:
    // without it a filled mound reads as a hill against a sky, and the mark
    // becomes a sunrise logo. With it, everything below is underground.
    `<path d="M0 11.5h40" stroke="rgba(255,255,255,.32)" stroke-width="1.2"/>` +
    `<path d="${table}V40H0Z" fill="${tone.body}"/>` +
    `<path d="${table}" fill="none" stroke="${tone.line}" stroke-width="1.7"/>` +
    // The well: down from the surface, through the crest, into the water. A
    // shaft, not a staked marker — a stem standing above ground with a ball on
    // top reads as a map pin, which is the one thing this must not be.
    `<path d="M20 11.5V26" stroke="${tone.well}" stroke-width="2.2" stroke-linecap="round"/>` +
    '</svg>';
  return { shape, svg };
};

/* A stable id for a publication section or an archive category: it keys the
 * filter buttons and the translation entries, so it must not change when the
 * heading is retitled — and, crucially, it is what the runtime matches on, so
 * it must survive translation into 13 languages that the label does not. */
const stableKey = (kind) =>
  String(kind || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'other';

/**
 * Group a flat publication list into the page's sections.
 *
 * Publications are stored as one list with a `kind` on each entry; the sections
 * are the groups of that kind, laid out in the order of `block.sections`.
 * Deriving the grouping instead of storing it is what makes the page show every
 * publication exactly once — an entry cannot be filed under two headings, and
 * one whose kind names no section falls into the trailing catch-all rather than
 * disappearing. That matters: an editor is free to type a new kind, and
 * scripts/parity.mjs fails the deploy if any publication stops appearing.
 *
 * A configured section stays on the page when it is empty, showing its own
 * "nothing here yet" line and a chip reading 0 — an empty section advertises
 * that the kind exists and can be filled, which a missing one cannot.
 */
const publicationSections = (block, items) => {
  const configured =
    Array.isArray(block.sections) && block.sections.length
      ? block.sections
      : // No section list: fall back to the kinds actually present, first seen first.
        [...new Set(items.map((i) => i.kind).filter(Boolean))].map((kind) => ({ kind }));

  const byKind = new Map();
  const order = [];
  configured.forEach((entry) => {
    if (!entry || !entry.kind || byKind.has(entry.kind)) return;
    const section = {
      key: stableKey(entry.kind),
      label: entry.title || entry.kind,
      note: entry.note || '',
      empty: entry.empty || '',
      configured: true,
      items: []
    };
    byKind.set(entry.kind, section);
    order.push(section);
  });

  // The catch-all. If a section for kind "Other" was configured, unmatched
  // entries merge into it rather than creating a second one.
  let other = order.find((s) => s.key === 'other');
  items.forEach((item) => {
    const section = byKind.get(item.kind);
    if (section) return section.items.push(item);
    if (!other) {
      other = { key: 'other', label: block.otherLabel || 'Other', note: '', empty: '', items: [] };
      order.push(other);
    }
    other.items.push(item);
  });

  // A configured section stays on the page when it is empty: it advertises
  // that the kind exists and can be filled, and its chip shows a 0. The
  // catch-all is generated rather than configured, so it only ever appears
  // once something has actually landed in it.
  return order.filter((section) => section.items.length || section.configured);
};

/* ---------- block renderers ---------- */
/* Each takes (document, block, ctx) where ctx = { urlFor(pageId), t(path) }.
 * t(path) resolves the data-i18n key: legacy (block.i18n) or generated. */

const pageLink = (document, ctx, { label, page, url, primary, key }) => {
  const a = el(document, 'a', { class: 'button' + (primary ? ' primary' : '') });
  if (url) {
    // An outside site (OurWater, a partner) opens in a new tab.
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  } else {
    a.setAttribute('data-open', page);         // i18n slot + old-link compatibility
    a.setAttribute('href', ctx.urlFor(page));
  }
  a.textContent = (label || '') + ' ';
  if (key) a.setAttribute('data-i18n', key);
  // An outside link already gets its own arrow from the stylesheet.
  if (!url) a.appendChild(arrowIcon(document));
  return a;
};

const proseColumn = (document, col, ctx, side) => {
  const wrap = el(document, 'div', { class: 'prose' });
  if (col.logo && col.logo.image) {
    const logo = el(document, 'img', { class: 'app-logo' });
    logo.src = col.logo.image;
    logo.alt = col.logo.alt || '';
    logo.setAttribute('loading', 'lazy');
    logo.setAttribute('width', '78');
    logo.setAttribute('height', '78');
    wrap.appendChild(logo);
  }
  if (col.lead) {
    wrap.appendChild(el(document, 'p', { class: 'large', text: col.lead, key: ctx.t(`${side}.lead`) }));
  }
  (col.paragraphs || []).forEach((text, i) => {
    wrap.appendChild(el(document, 'p', { text, key: ctx.t(`${side}.paragraphs.${i}`) }));
  });
  if (Array.isArray(col.features) && col.features.length) {
    const list = el(document, 'div', { class: 'feature-list' });
    col.features.forEach((f, i) => {
      const item = el(document, 'div', { class: 'feature-item' });
      item.appendChild(el(document, 'span', { text: f.number || String(i + 1).padStart(2, '0') }));
      const body = el(document, 'div');
      body.appendChild(el(document, 'strong', { text: f.title, key: ctx.t(`${side}.features.${i}.title`) }));
      if (f.text) body.appendChild(el(document, 'small', { text: f.text, key: ctx.t(`${side}.features.${i}.text`) }));
      item.appendChild(body);
      list.appendChild(item);
    });
    wrap.appendChild(list);
  }
  if (Array.isArray(col.actions) && col.actions.length) {
    const actions = el(document, 'div', { class: 'hero-actions' });
    col.actions.forEach((a) => actions.appendChild(pageLink(document, ctx, a)));
    wrap.appendChild(actions);
  }
  return wrap;
};

const splitColumn = (document, raw, ctx, side) => {
  const col = opt(raw);
  if (col.kind === 'dataPanel') {
    const wrap = el(document, 'div', { class: 'image-data-panel reveal' });
    wrap.appendChild(photo(document, col.photo));
    const overlay = el(document, 'div', { class: 'image-data-overlay' });
    overlay.appendChild(el(document, 'strong', { text: col.stat }));
    overlay.appendChild(el(document, 'span', { text: col.caption, key: ctx.t(`${side}.caption`) }));
    wrap.appendChild(overlay);
    return wrap;
  }
  if (col.kind === 'phones') {
    // App screens as phones: the first in front, up to two more fanned out
    // behind it, and the overlay number as a chip floating beside them.
    const shots = (col.photos || []).filter((p) => p && p.image).slice(0, 3);
    const stage = el(document, 'div', { class: 'phone-stage reveal' });
    stage.setAttribute('data-count', String(shots.length));
    shots.forEach((shot, i) => {
      const phone = el(document, 'figure', { class: 'phone phone--' + (i + 1) });
      phone.appendChild(photo(document, shot, { lazy: i > 0 }));
      stage.appendChild(phone);
    });
    if ((col.stat || '').trim()) {
      const badge = el(document, 'p', { class: 'phone-badge' });
      badge.appendChild(el(document, 'strong', { text: col.stat }));
      badge.appendChild(el(document, 'span', { text: col.caption, key: ctx.t(`${side}.caption`) }));
      stage.appendChild(badge);
    }
    return stage;
  }
  if (col.kind === 'image') {
    const wrap = el(document, 'div', { class: (col.look || 'app-shot') + ' reveal' });
    wrap.appendChild(photo(document, col.photo));
    return wrap;
  }
  return proseColumn(document, col, ctx, side);
};

/* Exported so scripts/verify.mjs can assert that this set and the CMS's list
 * of offerable blocks are the same set — neither may drift ahead of the other. */
/** Lower-case, dashed, 60 characters at most: "The MARVI 4-S Strategy" → "the-marvi-4-s-strategy". */
const slugish = (value) =>
  String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/**
 * Line icons for icon cards, drawn on a 32px grid with a 1.75 stroke so they
 * sit with the type rather than shouting over it. Unknown names fall back to
 * the water drop.
 */
const ICONS = {
  approach: '<circle cx="16" cy="16" r="11"/><path d="m11 17 3.5 3.5L21.5 12"/>',
  groundwater: '<path d="M4 20c4-4 8 4 12 0s8-4 12 0"/><path d="M4 26c4-4 8 4 12 0s8-4 12 0"/><path d="M16 4v10M12 10l4 4 4-4"/>',
  people: '<circle cx="12" cy="10" r="4"/><path d="M4 27v-3a8 8 0 0 1 16 0v3"/><circle cx="23" cy="11" r="3"/><path d="M22 18.2a6 6 0 0 1 7 5.8v3"/>',
  tools: '<rect x="9" y="3.5" width="14" height="25" rx="3"/><path d="M14 24.5h4"/><path d="M13 10h6M13 14h6M13 18h4"/>',
  impact: '<path d="M5 27V15M13 27V8M21 27V12M29 27H3"/>',
  knowledge: '<path d="M16 8c-3-2.5-7-3-11-2.5V24c4-.5 8 0 11 2.5 3-2.5 7-3 11-2.5V5.5C23 5 19 5.500 16 8Z"/><path d="M16 8v18.500"/>',
  news: '<path d="M7 5h15v22H9a2 2 0 0 1-2-2V5Z"/><path d="M22 10h4v14a3 3 0 0 1-6 0"/><path d="M11 10h7M11 14h7M11 18h4"/>',
  collaborate: '<path d="m3 15 6-6 5 2 4-2 5 1 6 5"/><path d="m9 9-6 6 9 9c1 1 2.500 1 3.500 0L17 22.500M23 12l6 3-9.500 9.500c-1 1-2.500 1-3.500 0"/><path d="m12 18 3 3M15 15l4 4"/>',
  water: '<path d="M16 3.5S7 14 7 20a9 9 0 0 0 18 0c0-6-9-16.500-9-16.500Z"/><path d="M11.500 20.500a4.500 4.500 0 0 0 4.500 4.500"/>',
  game: '<rect x="3.500" y="9" width="25" height="14" rx="7"/><path d="M10 13v6M7 16h6"/><circle cx="21" cy="14.500" r="1"/><circle cx="24" cy="17.500" r="1"/>',
  video: '<rect x="3.500" y="7" width="25" height="18" rx="3"/><path d="m13 12 7 4-7 4Z"/>',
  publication: '<path d="M8 3.500h11l6 6V28a.5.5 0 0 1-.5.5h-16A.5.5 0 0 1 8 28V3.500Z"/><path d="M19 3.500v6h6M12 15h9M12 19.500h9M12 24h6"/>',
  place: '<path d="M16 28s9-7.500 9-15a9 9 0 0 0-18 0c0 7.500 9 15 9 15Z"/><circle cx="16" cy="13" r="3.500"/>',
};
export const ICON_NAMES = Object.keys(ICONS);
const iconSvg = (name) =>
  `<span class="story-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.water}</svg></span>`;

export const BLOCKS = {
  split(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'split' });
    wrap.appendChild(splitColumn(document, block.left, ctx, 'left'));
    wrap.appendChild(splitColumn(document, block.right, ctx, 'right'));
    return wrap;
  },

  cards(document, block, ctx) {
    const grid = el(document, 'div', { class: 'grid-3' });
    (block.items || []).forEach((item, i) => {
      const card = el(document, 'article', { class: 'project-card' });
      card.appendChild(el(document, 'span', { class: 'card-number', text: item.number || String(i + 1).padStart(2, '0') }));
      card.appendChild(el(document, 'h3', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      if (item.text) card.appendChild(el(document, 'p', { text: item.text, key: ctx.t(`items.${i}.text`) }));
      grid.appendChild(card);
    });
    return grid;
  },

  imagePair(document, block, ctx) {
    // "Phones": app screens shown whole, each in a phone, with its caption.
    if (block.look === 'phones') {
      const tour = el(document, 'div', { class: 'phone-tour' });
      (block.items || []).forEach((item, i) => {
        if (!item || !item.photo?.image) return;
        const figure = el(document, 'figure', { class: 'phone-tour-item reveal' });
        const phone = el(document, 'div', { class: 'phone' });
        phone.appendChild(photo(document, item.photo));
        figure.appendChild(phone);
        if (item.caption) figure.appendChild(el(document, 'figcaption', { text: item.caption, key: ctx.t(`items.${i}.caption`) }));
        tour.appendChild(figure);
      });
      return tour;
    }
    const wrap = el(document, 'div', {
      class: block.look === 'screens' ? 'app-screen-strip' : 'editorial-images'
    });
    // An entry whose photo was never uploaded keeps its slot and shows the
    // stand-in. Rendering it raw produced an <img> with no source — a broken
    // image box with the alt text in it — and dropping it instead re-flowed
    // the row around a gap the editor could not see. The slot is the honest
    // middle: the composition holds, and the empty one is obvious.
    const items = block.items || [];
    // The editorial pair is two slots, deliberately unequal. Three or more
    // would wrap into that asymmetry and look like a mistake, so past two the
    // row becomes even — see .editorial-images[data-count].
    wrap.setAttribute('data-count', String(items.length));
    items.forEach((item, i) => {
      if (!item) return;
      const figure = el(document, 'figure', {
        class: block.look === 'screens' ? undefined : 'editorial-image'
      });
      figure.appendChild(photo(document, item.photo, { placeholder: true }));
      if (item.caption) {
        figure.appendChild(
          el(document, 'figcaption', { class: 'image-note', text: item.caption, key: ctx.t(`items.${i}.caption`) })
        );
      }
      wrap.appendChild(figure);
    });
    return wrap;
  },

  // Three staggered slots of fixed height and unequal width. A missing photo
  // here does not shrink the ribbon, it shifts every following image into the
  // wrong slot — so the slot is kept and filled with the stand-in.
  photoRibbon(document, block) {
    const wrap = el(document, 'div', { class: 'photo-ribbon' });
    (block.items || []).forEach((item) => {
      if (!item) return;
      const figure = el(document, 'figure');
      figure.appendChild(photo(document, item.photo, { placeholder: true }));
      wrap.appendChild(figure);
    });
    return wrap;
  },

  banner(document, block, ctx) {
    // A section heading. Its anchor ("s-…") is what the Header menu and
    // "On this page" jump to. The editor's label colour is not applied: it
    // was chosen for the old dark panels and fails contrast on the new ground.
    const wrap = el(document, 'div', { class: 'section-head' });
    const title = String(block.title || '').trim();
    if (title) {
      wrap.setAttribute('id', 's-' + slugish(title));
      wrap.setAttribute('data-section-anchor', '');
      if (block.tabLabel) wrap.setAttribute('data-tab-label', block.tabLabel);
    }
    if (block.eyebrow) {
      wrap.appendChild(el(document, 'p', { class: 'eyebrow', text: block.eyebrow, key: ctx.t('eyebrow') }));
    }
    wrap.appendChild(el(document, 'h2', { text: block.title, key: ctx.t('title') }));
    if (block.lede) wrap.appendChild(el(document, 'p', { class: 'lede', text: block.lede, key: ctx.t('lede') }));
    return wrap;
  },

  statement(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'home-statement' });
    // With no label and no quote the block is just its figures — the heading
    // above it already says what they are.
    if ((block.label || '').trim() || (block.quote || '').trim()) {
      const grid = el(document, 'div', { class: 'statement-grid' });
      grid.appendChild(el(document, 'p', { class: 'meta', text: block.label, key: ctx.t('label') }));
      grid.appendChild(el(document, 'blockquote', { text: block.quote, key: ctx.t('quote') }));
      wrap.appendChild(grid);
    } else {
      wrap.classList.add('home-statement--figures');
    }
    const row = el(document, 'div', { class: 'metric-row' });
    (block.metrics || []).forEach((m, i) => {
      const metric = el(document, 'div', { class: 'metric' });
      metric.appendChild(el(document, 'strong', { text: m.value }));
      metric.appendChild(el(document, 'span', { text: m.label, key: ctx.t(`metrics.${i}.label`) }));
      row.appendChild(metric);
    });
    wrap.appendChild(row);
    return wrap;
  },

  storyCards(document, block, ctx) {
    const section = el(document, 'section', { class: 'home-explore' });
    if (block.tone === 'sky') section.setAttribute('data-tone', 'sky');
    const heading = String(block.title || '').trim();
    const headingId = 'explore-' + (slugish(heading) || 'section');
    if (heading) {
      section.setAttribute('aria-labelledby', headingId);
      section.setAttribute('id', 's-' + slugish(heading));
      section.setAttribute('data-section-anchor', '');
      if (block.tabLabel) section.setAttribute('data-tab-label', block.tabLabel);
    }
    // A card section may have no heading of its own (it follows a section
    // heading), in which case there is no head to draw.
    if ((block.eyebrow || '').trim() || heading || (block.lede || '').trim()) {
      const head = el(document, 'header', { class: 'explore-head' });
      const headText = el(document, 'div');
      if (block.eyebrow) headText.appendChild(el(document, 'p', { class: 'eyebrow', text: block.eyebrow, key: ctx.t('eyebrow') }));
      if (heading) {
        const h2 = el(document, 'h2', { text: block.title, key: ctx.t('title') });
        h2.id = headingId;
        headText.appendChild(h2);
      }
      head.appendChild(headText);
      if (block.lede) head.appendChild(el(document, 'p', { text: block.lede, key: ctx.t('lede') }));
      section.appendChild(head);
    }
    const icons = block.look === 'icons';
    const grid = el(document, 'div', { class: 'story-grid' + (icons ? ' story-grid--icons' : '') });
    (block.items || []).forEach((item, i) => {
      const card = el(document, 'a', { class: 'story-card' + (icons ? ' story-card--icon' : '') });
      // An outside address wins over the page; a section is appended to it.
      const external = typeof item.url === 'string' && /^https?:\/\//.test(item.url.trim());
      if (external) {
        card.setAttribute('href', item.url.trim());
        card.setAttribute('target', '_blank');
        card.setAttribute('rel', 'noopener');
      } else {
        card.setAttribute('data-open', item.page);
        card.setAttribute('href', ctx.urlFor(item.page) + (item.section ? '#' + String(item.section).replace(/^#/, '') : ''));
      }
      if (icons) card.insertAdjacentHTML('beforeend', iconSvg(item.icon));
      else if (item.photo?.image) card.appendChild(photo(document, item.photo));
      else {
        // No photo: a quiet panel carrying the card's icon, so the row keeps
        // its rhythm without a broken image.
        const blank = el(document, 'span', { class: 'story-blank' });
        blank.setAttribute('aria-hidden', 'true');
        blank.innerHTML = iconSvg(item.icon || 'water');
        card.appendChild(blank);
      }
      const copy = el(document, 'span', { class: 'story-copy' });
      if (item.label) copy.appendChild(el(document, 'span', { class: 'meta', text: item.label, key: ctx.t(`items.${i}.label`) }));
      copy.appendChild(el(document, 'strong', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      if (item.text) copy.appendChild(el(document, 'span', { class: 'story-text', text: item.text, key: ctx.t(`items.${i}.text`) }));
      card.appendChild(copy);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    return section;
  },

  steps(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'process' });
    (block.items || []).forEach((item, i) => {
      const step = el(document, 'div', { class: 'process-step' });
      step.appendChild(el(document, 'h3', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      if (item.text) step.appendChild(el(document, 'p', { text: item.text, key: ctx.t(`items.${i}.text`) }));
      wrap.appendChild(step);
    });
    return wrap;
  },

  framedShot(document, block) {
    const frame = el(document, 'div', { class: 'game-frame' });
    const dots = el(document, 'div', { class: 'game-dots' });
    for (let i = 0; i < 3; i++) dots.appendChild(el(document, 'span'));
    frame.appendChild(dots);
    frame.appendChild(photo(document, block.photo, { lazy: false }));
    return frame;
  },

  mediaStories(document, block) {
    const frag = el(document, 'div', { class: 'media-stories-wrap' });
    const bar = el(document, 'div', { class: 'filter-bar' });
    const n = (block.items || []).length;
    const count = el(document, 'span', { class: 'filter-label', text: `${n} selected ${n === 1 ? 'story' : 'stories'}` });
    count.id = 'media-count';
    bar.appendChild(count);
    const search = el(document, 'input', { class: 'search' });
    search.id = 'media-search';
    search.setAttribute('type', 'search');
    search.setAttribute('placeholder', 'Search stories or publishers…');
    search.setAttribute('aria-label', 'Search media stories');
    bar.appendChild(search);
    frag.appendChild(bar);

    const grid = el(document, 'div', { class: 'media-grid' });
    grid.id = 'media-grid';
    (block.items || []).forEach((item) => {
      const a = el(document, 'a', { class: 'media-card' });
      setHref(a, item.url || '#');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.setAttribute(
        'data-search',
        [item.meta, item.title, item.description].filter(Boolean).join(' ').toLowerCase()
      );
      a.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      a.appendChild(el(document, 'h3', { text: item.title }));
      if (item.description) a.appendChild(el(document, 'p', { text: item.description }));
      a.appendChild(labelWithArrow(document, el(document, 'span', { class: 'read' }), 'Read story'));
      grid.appendChild(a);
    });
    frag.appendChild(grid);
    return frag;
  },

  filmGrid(document, block) {
    const grid = el(document, 'div', { class: 'video-grid' });
    (block.items || []).forEach((item) => {
      const a = el(document, 'a', { class: 'video-card' });
      setHref(a, item.url || '#');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      const wrap = el(document, 'div', { class: 'video-image' });
      const id = ytId(item.url);
      const img = el(document, 'img');
      img.setAttribute('loading', 'lazy');
      if (id) img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      img.alt = item.title ? item.title + ' video thumbnail' : '';
      const play = el(document, 'span', { class: 'play' });
      play.setAttribute('aria-hidden', 'true');
      wrap.append(img, play);
      a.appendChild(wrap);
      a.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      a.appendChild(el(document, 'h3', { text: item.title }));
      grid.appendChild(a);
    });
    return grid;
  },

  photoArchive(document, block, ctx) {
    const frag = el(document, 'div', { class: 'photo-archive-wrap' });
    // Hidden images drop out here, before anything counts or categorises them,
    // so the total, the category chips and the lightbox's next/previous all
    // agree about what the archive contains. Filtering later would leave a
    // chip that matches nothing and a count that overstates the gallery.
    const items = (block.items || []).filter((item) => item && item.visible !== false);
    const tools = el(document, 'div', { class: 'archive-tools' });
    const count = el(document, 'span', {
      class: 'filter-label',
      text: `${items.length} archived ${items.length === 1 ? 'image' : 'images'}`
    });
    count.id = 'gallery-count';
    tools.appendChild(count);
    const filters = el(document, 'div', { class: 'archive-filters' });
    filters.id = 'archive-filters';
    filters.setAttribute('aria-label', 'Filter the image archive');
    const addFilter = (key, label, i18nKey) => {
      const filter = el(document, 'button', { class: 'archive-filter', text: label, key: i18nKey });
      filter.setAttribute('type', 'button');
      // The runtime matches on this attribute, never on the label — labels are
      // translated into 13 languages and would stop matching data-category-key.
      filter.setAttribute('data-filter', key);
      filter.setAttribute('aria-pressed', String(key === 'all'));
      filters.appendChild(filter);
    };
    addFilter('all', block.allLabel || 'All', ctx.t('allLabel'));
    [...new Set(items.map((i) => i.category).filter(Boolean))].forEach((category) => {
      addFilter(stableKey(category), category, ctx.t(`categories.${stableKey(category)}`));
    });
    tools.appendChild(filters);
    frag.appendChild(tools);

    const grid = el(document, 'div', { class: 'gallery-grid' });
    grid.id = 'gallery-grid';
    grid.setAttribute('aria-live', 'polite');
    items.forEach((item, index) => {
      const button = el(document, 'button', { class: 'gallery-item' });
      button.setAttribute('type', 'button');
      // data-category stays the human label: app.mjs writes it into the visible
      // caption alongside the pixel dimensions. Matching uses the key beside it,
      // derived from the same string by the same function as the buttons above,
      // so the two sides cannot drift apart.
      button.setAttribute('data-category', item.category || '');
      button.setAttribute('data-category-key', item.category ? stableKey(item.category) : '');
      button.setAttribute('data-index', String(index));
      button.setAttribute('data-title', item.title || '');
      button.setAttribute('aria-label', 'Open ' + (item.title || 'image'));
      const img = photo(document, item, { alt: item.title || '' });
      img.setAttribute('decoding', 'async');
      button.appendChild(img);
      button.appendChild(el(document, 'span', { text: item.category }));
      grid.appendChild(button);
    });
    frag.appendChild(grid);
    return frag;
  },

  publicationList(document, block, ctx) {
    const frag = el(document, 'div', { class: 'publications-wrap' });
    const items = block.items || [];
    const sections = publicationSections(block, items);

    // Chips carry their count, so the shape of the collection is legible
    // before anything is clicked — including the kinds sitting at zero.
    const filters = el(document, 'div', { class: 'chip-filter' });
    filters.id = 'publication-filters';
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter publications by kind');
    const addChip = (key, label, n, i18nKey) => {
      const chip = el(document, 'button', { class: 'chip-btn' });
      chip.setAttribute('type', 'button');
      // The runtime matches on this attribute, never on the label — labels are
      // translated into 13 languages and would stop matching data-section.
      chip.setAttribute('data-filter', key);
      chip.setAttribute('data-count', String(n));
      chip.setAttribute('aria-pressed', String(key === 'all'));
      chip.appendChild(el(document, 'span', { text: label, key: i18nKey }));
      chip.appendChild(el(document, 'b', { text: String(n) }));
      filters.appendChild(chip);
    };
    addChip('all', block.allLabel || 'All', items.length, ctx.t('allLabel'));
    sections.forEach((s) => addChip(s.key, s.label, s.items.length, ctx.t(`sections.${s.key}.title`)));
    frag.appendChild(filters);

    // Search and the chips intersect rather than replace one another, so
    // picking a kind and then typing narrows within that kind.
    const bar = el(document, 'label', { class: 'filter-bar' });
    bar.appendChild(
      el(document, 'span', { class: 'filter-label', text: block.searchLabel || 'Search', key: ctx.t('searchLabel') })
    );
    const search = el(document, 'input', { class: 'search' });
    search.id = 'publication-search';
    search.setAttribute('type', 'search');
    search.setAttribute('placeholder', block.searchPlaceholder || 'groundwater, water literacy, Hindi…');
    search.setAttribute('aria-label', 'Search publications');
    bar.appendChild(search);
    const count = el(document, 'span', {
      class: 'filter-label',
      text: `${items.length} ${items.length === 1 ? 'publication' : 'publications'}`
    });
    count.id = 'publication-count';
    // The count is the whole announcement when a chip is pressed or a query
    // typed; putting the live region here rather than on the list keeps it short.
    count.setAttribute('aria-live', 'polite');
    bar.appendChild(count);
    frag.appendChild(bar);

    // The list/cards choice is a CSS state on one set of markup, not a second
    // rendering — so filtering, counting and searching cannot disagree between
    // the two views.
    const view = block.defaultView === 'cards' ? 'cards' : 'list';
    const views = el(document, 'div', { class: 'view-toggle' });
    views.id = 'publication-views';
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'Change the layout');
    [['list', block.listLabel || 'List'], ['cards', block.cardsLabel || 'Cards']].forEach(([key, label]) => {
      const button = el(document, 'button', { class: 'view-btn', text: label, key: ctx.t(`views.${key}`) });
      button.setAttribute('type', 'button');
      button.setAttribute('data-view', key);
      button.setAttribute('aria-pressed', String(key === view));
      views.appendChild(button);
    });
    bar.appendChild(views);

    const wrap = el(document, 'div', { class: 'pub-sections' });
    wrap.id = 'publication-sections';
    wrap.setAttribute('data-view', view);
    // <details> rather than a button + aria-expanded: it collapses without
    // JavaScript, is keyboard- and screen-reader-operable for free, and keeps
    // the entries in the DOM while closed — which is what lets the search find
    // them, and what keeps scripts/parity.mjs able to see every title.
    const startOpen = block.startCollapsed === false;
    sections.forEach((section) => {
      const group = el(document, 'details', { class: 'pub-section' });
      group.setAttribute('data-section', section.key);
      if (startOpen) group.setAttribute('open', '');
      const head = el(document, 'summary', { class: 'pub-section-head' });
      head.appendChild(
        el(document, 'h2', {
          class: 'pub-section-title',
          text: section.label,
          key: ctx.t(`sections.${section.key}.title`)
        })
      );
      // A bare number, so it never needs translating. The runtime rewrites it
      // to "2 of 4" while a search is narrowing the section.
      const sectionCount = el(document, 'span', {
        class: 'pub-section-count',
        text: String(section.items.length)
      });
      sectionCount.setAttribute('data-role', 'count');
      sectionCount.setAttribute('data-total', String(section.items.length));
      head.appendChild(sectionCount);
      group.appendChild(head);
      if (section.note) {
        group.appendChild(
          el(document, 'p', {
            class: 'pub-section-note',
            text: section.note,
            key: ctx.t(`sections.${section.key}.note`)
          })
        );
      }
      // Shown only when the kind is genuinely empty and nothing is narrowing
      // the view — under a search it would read as a second, different problem.
      const emptyLine = el(document, 'p', {
        class: 'pub-section-empty',
        text: section.empty || `Nothing listed under ${section.label.toLowerCase()} yet.`,
        key: ctx.t(`sections.${section.key}.empty`)
      });
      if (section.items.length) emptyLine.hidden = true;
      group.appendChild(emptyLine);

      const grid = el(document, 'div', { class: 'pub-grid' });
      section.items.forEach((item) => {
        const card = el(document, 'article', { class: 'pub-card' });
        if (item.kind) card.setAttribute('data-kind', item.kind);
        card.setAttribute('data-section', section.key);
        card.setAttribute(
          'data-search',
          [item.kind, item.meta, item.title, item.description, ...(item.editions || []).map((e) => e && e.label)]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
        );
        card.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
        card.appendChild(el(document, 'h3', { text: item.title }));
        if (item.description) card.appendChild(el(document, 'p', { text: item.description }));
        const links = el(document, 'span', { class: 'pub-links' });
        (item.editions || []).forEach((edition) => {
          if (!edition || !edition.url) return;
          const link = labelWithArrow(document, el(document, 'a'), edition.label || 'Download');
          setHref(link, edition.url);
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener');
          link.setAttribute('aria-label', [item.title, edition.label].filter(Boolean).join(' — '));
          links.appendChild(link);
        });
        if (links.childNodes.length) card.appendChild(links);
        grid.appendChild(card);
      });
      group.appendChild(grid);
      wrap.appendChild(group);
    });
    frag.appendChild(wrap);

    // Belongs to the search alone: a kind that is simply empty already says so
    // in its own section, and showing both reads as two problems, not one fact.
    const noMatch = el(document, 'p', {
      class: 'pub-empty',
      text: block.emptyMessage || 'No publication matches that',
      key: ctx.t('emptyMessage')
    });
    noMatch.id = 'publication-empty';
    noMatch.hidden = true;
    frag.appendChild(noMatch);
    return frag;
  },

  toolList(document, block, ctx) {
    const grid = el(document, 'div', { class: 'tool-grid' });
    grid.id = 'tool-grid';
    (block.items || []).forEach((item) => {
      const card = el(document, 'article', { class: 'tool-card reveal' });
      // A phone app's screenshot is shown whole, in a phone, rather than
      // cropped to the landscape slot a web tool's screenshot fills.
      const asPhone = item.look === 'phone';
      const shot = el(document, 'div', { class: 'tool-shot' + (asPhone ? ' tool-shot--phone' : '') });
      const picture = photo(document, item.photo || {}, { alt: item.name ? item.name + ' screenshot' : '' });
      if (asPhone) {
        const phone = el(document, 'div', { class: 'phone' });
        phone.appendChild(picture);
        shot.appendChild(phone);
      } else {
        shot.appendChild(picture);
      }
      card.appendChild(shot);
      const copy = el(document, 'div', { class: 'tool-copy' });
      copy.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      copy.appendChild(el(document, 'h3', { text: item.name }));
      if (item.description) copy.appendChild(el(document, 'p', { text: item.description }));
      // An external URL wins; otherwise link to the target page.
      const action = el(document, 'a', { class: 'button primary' });
      action.textContent = (item.linkLabel || 'Open') + ' ';
      if (item.url) {
        setHref(action, item.url);
        action.setAttribute('target', '_blank');
        action.setAttribute('rel', 'noopener');
      } else {
        action.setAttribute('data-open', item.target || 'home');
        setHref(action, ctx.urlFor(item.target || 'home'));
      }
      action.appendChild(arrowIcon(document));
      copy.appendChild(action);
      card.appendChild(copy);
      grid.appendChild(card);
    });
    return grid;
  },

  /* An organisation list. Nothing in here is specific to partners — the same
   * block is the supporters list and the funders list, differing only in its
   * tab label and its items. That is why the type is worth keeping general:
   * a new category is a new block, not new code. */
  partnerList(document, block, ctx) {
    // "Logo strip": one row of partner logos (a name where there is no logo)
    // and a link to the full list — for a page that only needs to show who
    // is involved, such as home.
    if (block.look === 'strip') {
      const wrap = el(document, 'div', { class: 'logo-strip-wrap' });
      const strip = el(document, 'ul', { class: 'logo-strip' });
      (block.items || []).filter(Boolean).forEach((item) => {
        const li = el(document, 'li');
        const tile = el(document, item.url ? 'a' : 'span', { class: 'logo-strip-item' + (item.logo?.onDark ? ' is-on-dark' : '') });
        if (item.url) { setHref(tile, item.url); tile.setAttribute('target', '_blank'); tile.setAttribute('rel', 'noopener'); }
        tile.setAttribute('title', item.name || '');
        if (item.logo && item.logo.image) tile.appendChild(photo(document, item.logo, { alt: item.name || '' }));
        else tile.appendChild(el(document, 'span', { class: 'logo-strip-name', text: item.name }));
        li.appendChild(tile);
        strip.appendChild(li);
      });
      wrap.appendChild(strip);
      if (block.morePage) {
        wrap.appendChild(pageLink(document, ctx, { label: block.moreLabel || 'See all', page: block.morePage, key: ctx.t('moreLabel') }));
      }
      return wrap;
    }
    const showLogos = block.logos !== false;
    const grid = el(document, 'div', { class: 'people-grid' });
    // A group whose list is still empty keeps its tab — the tab is the promise
    // that the category exists — but drops the grid's rules, which would
    // otherwise draw a stray line across an empty panel.
    const items = (block.items || []).filter(Boolean);
    if (!items.length) grid.classList.add('is-empty');
    items.forEach((item) => {
      const { links, wholeCard } = linkMode(block, item);
      const card = el(document, wholeCard ? 'a' : 'article', { class: 'people-card' });
      if (wholeCard) {
        setHref(card, item.url);
        card.setAttribute('target', '_blank');
        card.setAttribute('rel', 'noopener');
      }
      const logo = logoFrame(document, item, showLogos);
      if (logo) {
        card.classList.add('has-logo');
        card.appendChild(logo);
      }
      card.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      const h3 = el(document, 'h3');
      if (item.url && !wholeCard) {
        const a = labelWithArrow(document, el(document, 'a'), item.name || '');
        setHref(a, item.url);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
        h3.appendChild(a);
      } else {
        h3.textContent = item.name || '';
        if (wholeCard) h3.appendChild(arrowIcon(document));
      }
      card.appendChild(h3);
      const row = linkRow(document, links, item.name);
      if (row) card.appendChild(row);
      grid.appendChild(card);
    });
    return grid;
  },

  portraitBand(document, block, ctx) {
    // Only genuinely empty entries are dropped. A person with no photo yet is
    // still a person on the team: they get the placeholder figure and keep
    // their name, role, links and place in the running order. Filtering them
    // out — which is what this did — loses them silently, and a name missing
    // from a team page is not a failure anyone notices in time.
    const items = (block.items || []).filter((item) => item && (item.name || item.image));
    const band = el(document, 'div', { class: 'portrait-band' });
    // The band draws its dividers as a background showing through 1px gaps in
    // a four-column grid. That is exactly right at 28 portraits and wrong at
    // two: the columns nobody filled become a grey slab. Below four, the cards
    // carry their own edges instead.
    if (items.length < 4) band.setAttribute('data-sparse', '');
    items.forEach((item) => {
      const { links, wholeCard: wholeCardLink } = linkMode(block, item);
      const card = el(document, wholeCardLink ? 'a' : 'article', { class: 'portrait-card' });
      if (wholeCardLink) {
        setHref(card, item.url);
        card.setAttribute('target', '_blank');
        card.setAttribute('rel', 'noopener');
      }
      const details = [item.name, item.title, item.affiliation].filter(Boolean).join(', ');
      card.setAttribute('aria-label', details + (wholeCardLink ? ' — open profile' : ''));
      // The runtime filters and sorts on these, never on rendered text —
      // labels are translated per language and would stop matching. Honorifics
      // are dropped from the sort key only — the card still shows the full
      // name — or everyone with a doctorate would file under D.
      card.setAttribute(
        'data-name',
        (item.name || '').toLowerCase().replace(/^((adj\.?\s+)?(a\/)?prof\.?|dr\.?|mr\.?|mrs\.?|ms\.?|miss)\s+/, '')
      );
      card.setAttribute('data-aff', item.affiliation || '');
      card.setAttribute(
        'data-search',
        [item.name, item.title, item.affiliation].filter(Boolean).join(' ').toLowerCase()
      );
      card.appendChild(
        item.image
          ? photo(document, item, { alt: item.name ? 'Portrait of ' + item.name : 'MARVI team member portrait' })
          // The card's own aria-label already names the person, so the stand-in
          // is decorative — announcing "no photo" would only add noise.
          : photo(document, { image: PLACEHOLDER_PORTRAIT }, { alt: '' })
      );
      const info = el(document, 'span', { class: 'portrait-card-info' });
      const name = el(document, 'strong', { text: item.name || 'MARVI team member' });
      if (item.url && !wholeCardLink) {
        const anchor = el(document, 'a', { class: 'portrait-name-link' });
        setHref(anchor, item.url);
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener');
        anchor.appendChild(name);
        info.appendChild(anchor);
      } else {
        info.appendChild(name);
      }
      if (item.title) info.appendChild(el(document, 'span', { text: item.title }));
      if (item.affiliation) info.appendChild(el(document, 'small', { text: item.affiliation }));
      const linkIcons = linkRow(document, links, item.name);
      if (linkIcons) info.appendChild(linkIcons);
      card.appendChild(info);
      band.appendChild(card);
    });
    if (block.filters === false || items.length < 2) return band;

    // Filter + sort controls, same shape as the publications bar. Everything
    // below only ever reorders or hides the cards above — a reader without
    // JavaScript sees the full band in its authored order.
    //
    // The controls are addressed by class inside their own .people-directory,
    // and every id is suffixed with the block's uid. That is the difference
    // between "the people page has a filter bar" and "any portrait band can
    // have one": collaborators, supporters and whatever tab is added next each
    // filter their own cards, because nothing here is page-wide any more.
    band.classList.add('people-band');
    const wrap = el(document, 'div', { class: 'people-directory' });

    const bar = el(document, 'div', { class: 'filter-bar' });
    const searchLabel = el(document, 'label', { class: 'filter-label', text: 'Search', key: ctx.t('ui.search') });
    searchLabel.setAttribute('for', `people-search-${ctx.uid}`);
    bar.appendChild(searchLabel);
    const search = el(document, 'input', { class: 'search' });
    search.id = `people-search-${ctx.uid}`;
    search.classList.add('people-search');
    search.setAttribute('type', 'search');
    search.setAttribute('placeholder', 'name, role or organisation…');
    search.setAttribute('aria-label', 'Search people');
    bar.appendChild(search);

    // Ten-plus organisations is too many for chips without the filter bar
    // outweighing the directory, so affiliation is a select (the AIWC rule).
    const affiliations = new Map();
    items.forEach((item) => {
      if (item.affiliation) {
        affiliations.set(item.affiliation, (affiliations.get(item.affiliation) || 0) + 1);
      }
    });
    const affField = el(document, 'div', { class: 'sort-field' });
    const aff = el(document, 'select');
    aff.id = `people-aff-${ctx.uid}`;
    aff.classList.add('people-aff');
    aff.setAttribute('aria-label', 'Filter by affiliation');
    const allOption = el(document, 'option', { text: `All affiliations (${affiliations.size})` });
    allOption.value = '';
    aff.appendChild(allOption);
    [...affiliations.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([name, n]) => {
        const option = el(document, 'option', { text: `${name} (${n})` });
        option.value = name;
        aff.appendChild(option);
      });
    affField.appendChild(aff);
    bar.appendChild(affField);

    const sortField = el(document, 'div', { class: 'sort-field' });
    const sortLabel = el(document, 'label', { class: 'filter-label', text: 'Sort', key: ctx.t('ui.sort') });
    sortLabel.setAttribute('for', `people-sort-${ctx.uid}`);
    sortField.appendChild(sortLabel);
    const sort = el(document, 'select');
    sort.id = `people-sort-${ctx.uid}`;
    sort.classList.add('people-sort');
    [
      ['shuffle', 'Shuffled', ctx.t('ui.sortShuffled')],
      ['featured', 'Featured', ctx.t('ui.sortFeatured')],
      ['name', 'Name A–Z', ctx.t('ui.sortName')],
      ['affiliation', 'Affiliation', ctx.t('ui.sortAffiliation')]
    ].forEach(([value, text, i18nKey]) => {
      const option = el(document, 'option', { text, key: i18nKey });
      option.value = value;
      sort.appendChild(option);
    });
    sortField.appendChild(sort);
    bar.appendChild(sortField);

    const count = el(document, 'span', {
      class: 'filter-label',
      text: `${items.length} ${items.length === 1 ? 'person' : 'people'}`
    });
    count.id = `people-count-${ctx.uid}`;
    count.classList.add('people-count');
    count.setAttribute('aria-live', 'polite');
    bar.appendChild(count);
    wrap.appendChild(bar);

    wrap.appendChild(band);

    // A long band opens one row deep with the button that reveals the rest.
    // Rendered here rather than injected, so a reader without JavaScript sees
    // the full list and no button — app.mjs is what collapses the band.
    const revealRow = el(document, 'div', { class: 'reveal-row' });
    const reveal = el(document, 'button', {
      class: 'reveal-all',
      text: `Show all ${items.length} people`
    });
    reveal.id = `people-reveal-${ctx.uid}`;
    reveal.classList.add('people-reveal');
    reveal.setAttribute('type', 'button');
    reveal.setAttribute('hidden', '');
    revealRow.appendChild(reveal);
    wrap.appendChild(revealRow);

    const empty = el(document, 'p', {
      class: 'filter-label',
      text: 'No people match that filter.',
      key: ctx.t('ui.empty')
    });
    empty.id = `people-empty-${ctx.uid}`;
    empty.classList.add('people-empty');
    empty.setAttribute('hidden', '');
    wrap.appendChild(empty);
    return wrap;
  },

  sourceNote(document, block) {
    const p = el(document, 'p');
    if (block.style) p.setAttribute('style', block.style);
    (block.parts || []).forEach((part) => {
      if (part.link) {
        const a = el(document, 'a', { text: part.link.label });
        setHref(a, part.link.url || '#');
        if (part.link.download) a.setAttribute('download', '');
        if (part.link.external) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        }
        p.appendChild(a);
      } else {
        p.appendChild(document.createTextNode(part.text || ''));
      }
    });
    return p;
  },

  video(document, block) {
    return BLOCKS.filmGrid(document, { items: [block] });
  },

  embed(document, block) {
    if (!/^https?:\/\/\S+$/i.test(String(block.url || ''))) return null;
    const wrap = el(document, 'section', { class: 'cms-block cms-block-embed' });
    const frame = el(document, 'iframe');
    frame.src = block.url;
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('title', block.title || 'Embedded content');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('style', 'width:100%;aspect-ratio:16/9;border:0;border-radius:12px');
    wrap.appendChild(frame);
    return wrap;
  },

  /* --- the CMS "flexible section" types, markup-identical to the old
   *     renderFlexibleSections so their existing CSS applies --- */

  text(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-text' });
    cmsCopy(document, section, block);
    return section;
  },

  imageText(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-imageText' });
    section.setAttribute('data-photo-side', block.photoSide || 'left');
    cmsPhoto(document, section, block.photo || {});
    cmsCopy(document, section, block);
    return section;
  },

  gallery(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-gallery' });
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    const gallery = el(document, 'div', { class: 'cms-block-gallery' });
    (block.photos || []).forEach((entry) => {
      const figure = el(document, 'figure');
      figure.appendChild(photo(document, entry, { alt: '', placeholder: true }));
      gallery.appendChild(figure);
    });
    section.appendChild(gallery);
    return section;
  },

  callout(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-callout' });
    section.setAttribute('data-tone', block.tone || 'blue');
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    cmsParagraphs(document, section, block.body);
    return section;
  },

  button(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-button' });
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    const link = labelWithArrow(document, el(document, 'a', { class: 'button primary' }), block.label || 'Learn more');
    setHref(link, block.url || '#');
    section.appendChild(link);
    return section;
  }
};

const cmsParagraphs = (document, root, value) => {
  String(value || '').split(/\n\s*\n/).filter(Boolean).forEach((paragraph) => {
    root.appendChild(el(document, 'p', { text: paragraph.trim() }));
  });
};
const cmsCopy = (document, section, block) => {
  const copy = el(document, 'div', { class: 'cms-block-copy' });
  copy.setAttribute('data-align', block.align || 'left');
  if (block.eyebrow) copy.appendChild(el(document, 'p', { class: 'eyebrow', text: block.eyebrow }));
  if (block.heading) copy.appendChild(el(document, 'h2', { text: block.heading }));
  cmsParagraphs(document, copy, block.body);
  section.appendChild(copy);
};
const cmsPhoto = (document, section, entry) => {
  const frame = el(document, 'div', { class: 'cms-block-photo' });
  frame.appendChild(photo(document, entry, { alt: '' }));
  section.appendChild(frame);
};

export const BLOCK_TYPES = Object.keys(BLOCKS);

/* The "flexible section" types render appended after the section body inside
 * a .cms-sections wrapper — that is where their CSS expects them. */
const FLEX_TYPES = new Set(['text', 'imageText', 'gallery', 'callout', 'button', 'embed']);

/* ---------- page renderers ---------- */

const standardHead = (document, page, { index, total }) => {
  const head = el(document, 'header', { class: 'page-head' });
  const inner = el(document, 'div', { class: 'page-head-copy' });
  const intro = page.intro || {};
  if (intro.eyebrow != null) inner.appendChild(el(document, 'p', { class: 'eyebrow', text: intro.eyebrow }));
  inner.appendChild(el(document, 'h1', { text: intro.title || page.menuName }));
  if (intro.lede != null) inner.appendChild(el(document, 'p', { class: 'lede', text: intro.lede }));
  head.appendChild(inner);
  applyTextControls(head, intro);
  // The header photograph is painted behind the title, edge to edge, under a
  // dark scrim — the field-note look of the earlier MARVI site.
  if (page.heroImage?.image) {
    head.classList.add('has-cover');
    const media = el(document, 'figure', { class: 'page-head-media' });
    media.appendChild(photo(document, page.heroImage, { alt: '', lazy: false }));
    head.appendChild(media);
  }
  return head;
};

const homeHero = (document, page, ctx) => {
  const hero = page.hero || {};
  const intro = page.intro || {};
  const t = (path) => hero.i18n?.[i18nKey(path)];

  const wrap = el(document, 'div', { class: 'home-hero' });
  const copy = el(document, 'div', { class: 'hero-copy' });
  const inner = el(document, 'div', { class: 'hero-copy-inner' });
  inner.appendChild(el(document, 'p', { class: 'eyebrow', text: intro.eyebrow }));
  inner.appendChild(multiline(document, el(document, 'h1'), intro.title));
  inner.appendChild(el(document, 'p', { class: 'lede', text: intro.lede }));
  const actions = el(document, 'div', { class: 'hero-actions' });
  (hero.actions || []).forEach((a) => actions.appendChild(pageLink(document, ctx, a)));
  inner.appendChild(actions);
  copy.appendChild(inner);
  applyTextControls(copy, intro);
  wrap.appendChild(copy);

  const stage = el(document, 'div', { class: 'hero-image-stage' });
  if (hero.stageAlt) stage.setAttribute('aria-label', hero.stageAlt);
  stage.appendChild(photo(document, page.heroImage || {}, { alt: hero.imageAlt || '', lazy: false, className: 'hero-image-main' }));
  if (hero.label) {
    stage.appendChild(multiline(document, el(document, 'div', { class: 'hero-image-label', key: t('label') }), hero.label));
  }
  if (hero.caption) {
    stage.appendChild(multiline(document, el(document, 'div', { class: 'hero-image-caption', key: t('caption') }), hero.caption));
  }
  wrap.appendChild(stage);
  // With no header photo the hero is the words alone, on navy.
  if (!page.heroImage?.image) wrap.classList.add('home-hero--text');
  return wrap;
};

/**
 * Render one page into a <section class="panel"> element.
 * ctx: { index, total, urlFor(pageId) }
 */
export function renderPage(document, page, ctx) {
  const section = el(document, 'section', { class: 'panel' });
  section.id = 'panel-' + page.slug;
  section.setAttribute('data-panel', page.slug);
  section.setAttribute('role', 'tabpanel');
  section.setAttribute('tabindex', '0');

  const blockCtx = (block, i) => ({
    urlFor: ctx.urlFor,
    // Unique per block, so a block needing element ids (a label must point at
    // its own control) can appear as many times on a page as the editor adds
    // without any two instances colliding.
    uid: `${page.slug}-b${i}`,
    // The generated fallback keeps the dotted path: it is a key, not a lookup.
    t: (path) => block.i18n?.[i18nKey(path)] || `page.${page.slug}.b${i}.${path}`
  });

  const core = [];
  const flex = [];
  (page.blocks || []).forEach((block, i) => {
    const render = BLOCKS[block?.type];
    // `visible: false` is a draft switch: the block keeps its place, its
    // content and its translations, and simply does not ship. Without it the
    // only way to hold a half-written section back is to delete it.
    if (!render || block.visible === false) return;
    const ctxI = blockCtx(block, i);
    const node = render(document, block, ctxI);
    if (!node) return;
    // The generic CMS blocks normally collect below the page body. A tab label
    // overrides that and pulls the block into the strip where it was authored,
    // so any block type can become a tab.
    FLEX_TYPES.has(block.type) && !block.tabLabel
      ? flex.push(node)
      : core.push({ node, tab: block.tabLabel || null, key: ctxI.t('tabLabel'), i });
  });
  const coreNodes = toneBands(document, groupTabs(document, core, page.slug), page.blocks || []);

  if (page.template === 'home') {
    section.appendChild(homeHero(document, page, ctx));
    const homeBody = el(document, 'div', { class: 'home-body' });
    const holder = el(document, 'div', { class: 'section-body' });
    coreNodes.forEach((n) => holder.appendChild(n));
    homeBody.appendChild(holder);
    if (flex.length) homeBody.appendChild(flexWrap(document, flex));
    section.appendChild(homeBody);
    return section;
  }

  // The page head sits outside the content column so its photograph can run
  // the full width of the window; its text keeps to the column.
  section.appendChild(standardHead(document, page, ctx));
  const wrap = el(document, 'div', { class: 'content-wrap' });
  const body = el(document, 'div', { class: 'section-body' });
  coreNodes.forEach((n) => body.appendChild(n));
  wrap.appendChild(body);
  if (flex.length) wrap.appendChild(flexWrap(document, flex));
  section.appendChild(wrap);
  return section;
}

/**
 * Fold each consecutive run of blocks carrying a `tabLabel` into one tabbed
 * group: a tablist followed by one panel per block. Panels arrive visible and
 * stacked — app.mjs is what collapses them to the selected tab, so a reader
 * without JavaScript still gets every block in authored order. A run of one
 * labelled block gets no tab chrome; a label with nothing to switch to is
 * just noise.
 */
const groupTabs = (document, entries, slug) => {
  const out = [];
  for (let k = 0; k < entries.length; k++) {
    if (!entries[k].tab) {
      out.push(entries[k].node);
      continue;
    }
    const run = [];
    while (k < entries.length && entries[k].tab) run.push(entries[k++]);
    k--;
    if (run.length < 2) {
      out.push(run[0].node);
      continue;
    }
    const group = el(document, 'div', { class: 'block-tabs' });
    const bar = el(document, 'div', { class: 'tab-bar' });
    bar.setAttribute('role', 'tablist');
    group.appendChild(bar);
    run.forEach((entry, j) => {
      const id = `blocktab-${slug}-${entry.i}`;
      const tab = el(document, 'button', { class: 'tab-btn', text: entry.tab, key: entry.key });
      tab.id = id + '-tab';
      tab.setAttribute('type', 'button');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(j === 0));
      tab.setAttribute('aria-controls', id);
      bar.appendChild(tab);
      const panel = el(document, 'div', { class: 'tab-panel' });
      panel.id = id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', id + '-tab');
      panel.setAttribute('tabindex', '0');
      panel.appendChild(entry.node);
      group.appendChild(panel);
    });
    out.push(group);
  }
  return out;
};

/**
 * Background bands. A section heading (banner) can carry a tone — "sky",
 * "deep" or "sand" — which colours that heading and every block after it, up
 * to the next heading (or the next titled card section). Consecutive headings
 * with the same tone share one band. Bands are plain wrappers; untoned blocks
 * stay direct children of the section body.
 *
 * `nodes` is the output of groupTabs (one node per authored block, or per tab
 * group), so a node is matched to its block through the data attribute the
 * renderers leave on banners and titled card sections.
 */
const BAND_TONES = new Set(['sky', 'deep', 'sand']);
const toneBands = (document, nodes, blocks) => {
  const toneByAnchor = new Map();
  (blocks || []).forEach((b) => {
    const title = String(b?.title || '').trim();
    if (b?.type === 'banner' && title && BAND_TONES.has(b.tone)) toneByAnchor.set('s-' + slugish(title), b.tone);
  });
  if (!toneByAnchor.size) return nodes;
  const out = [];
  let band = null;
  for (const node of nodes) {
    const isHeading = node.hasAttribute?.('data-section-anchor');
    const isTitledCards = node.classList?.contains('home-explore') && isHeading;
    if (isTitledCards) band = null;
    if (isHeading && !isTitledCards) {
      const tone = toneByAnchor.get(node.getAttribute('id'));
      if (!tone) band = null;
      else if (!band || band.getAttribute('data-tone') !== tone) {
        band = el(document, 'div', { class: 'tone-band' });
        band.setAttribute('data-tone', tone);
        out.push(band);
      }
    }
    if (band) band.appendChild(node);
    else out.push(node);
  }
  return out;
};

const flexWrap = (document, nodes) => {
  const wrap = el(document, 'div', { class: 'cms-sections' });
  nodes.forEach((n) => wrap.appendChild(n));
  return wrap;
};
