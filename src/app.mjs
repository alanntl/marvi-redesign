/**
 * Browser-only behaviour: menu, search, motion, gallery, lightbox, directories.
 *
 * Content and translation are baked in at build time (see hydrate.mjs), so
 * nothing here fetches copy or swaps languages — the language switcher is a
 * plain navigation now. Each built page carries only its own panel, so every
 * lookup below must tolerate its target being absent.
 */


/* ---------- motion ----------
 * Light and arrival-only. Blocks float up as they scroll into view and the
 * figures count up once; everything else is CSS (the motion block in
 * index.html). With reduced motion requested nothing is hidden or animated:
 * blocks are simply there and the figures show their final values. */

const REVEAL =
  '.story-card, .process-step, .metric, .partner-country, .section-head, .explore-head, ' +
  '.split > *, .cms-block-callout, .tool-card, .home-statement, .media-card, .video-card, .pub-card, .people-card, .project-card';

function countUp(node) {
  if (!node || node.dataset.counted) return;
  node.dataset.counted = '1';
  const match = node.textContent.trim().match(/^(\d[\d,]*)(.*)$/s);
  if (!match) return;
  const end = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(end) || end < 2) return;
  // A year (2012) is a date, not a quantity: counting it up from zero reads
  // as nonsense. Leave it standing.
  if (!match[1].includes(',') && !match[2].trim() && end >= 1900 && end <= 2100) return;
  // Keep the figure written the way the editor wrote it: 2908 stays 2908,
  // 65,000 keeps its comma.
  const grouped = match[1].includes(',');
  const format = (n) => (grouped ? n.toLocaleString('en-US') : String(n));
  const started = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - started) / 1300, 1);
    node.textContent = format(Math.round(end * (1 - Math.pow(1 - progress, 3)))) + match[2];
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupMotion() {
  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target;
        node.classList.add('is-in');
        if (node.matches('.metric')) countUp(node.querySelector('strong'));
        node.querySelectorAll('.metric strong').forEach(countUp);
        observer.unobserve(node);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
  );
  document.querySelectorAll(REVEAL).forEach((node, index) => {
    node.style.setProperty('--d', (index % 4) * 90 + 'ms');
    node.classList.add('will-reveal');
    observer.observe(node);
  });
}

/**
 * Apply the CMS text-size percentages.
 *
 * The percentage is carried on the element as data-cms-text-scale, so this
 * needs no content lookup — it just resolves the designed size (a clamp(), so
 * viewport-dependent) and scales it. The build deliberately ships these
 * unsized: the value can only be computed where CSS is actually resolved,
 * which is why it re-runs on resize.
 */
function refreshTextScales() {
  document.querySelectorAll('[data-cms-text-scale]').forEach((node) => {
    const percentage = Number(node.dataset.cmsTextScale) || 0;
    if (!percentage || percentage === 100) return;
    node.style.fontSize = '';
    const baseline = Number.parseFloat(getComputedStyle(node).fontSize);
    if (Number.isFinite(baseline)) node.style.fontSize = (baseline * percentage) / 100 + 'px';
  });
}

function showReveals(root) {
  root.querySelectorAll('.reveal').forEach((element, index) => {
    window.setTimeout(() => element.classList.add('is-visible'), Math.min(index * 90, 420) + 60);
  });
}

/* ---------- image archive + publications ---------- */
/* Grids, filter buttons and counts are prerendered by the build; this only
 * wires behaviour onto them. */

/* `allKey` is the value that means "show everything". Publications have their
 * own driver (setupPublications) because they also carry a search and a layout
 * switch; this stays the simple one-axis filter the image archive needs. */
function wireFilters({ filterWrap, grid, itemSel, categoryAttr, count, noun, allKey = 'All' }) {
  if (!filterWrap || !grid) return;
  const buttons = [...filterWrap.querySelectorAll('.archive-filter')];
  buttons.forEach((filter) => {
    filter.addEventListener('click', () => {
      // Prefer the data attribute: button labels are translated into 13
      // languages, so matching on what the button says stops working the
      // moment the page is not in English.
      const category = filter.getAttribute('data-filter') ?? filter.textContent.trim();
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === filter)));
      let visible = 0;
      grid.querySelectorAll(itemSel).forEach((item) => {
        const match = category === allKey || item.getAttribute(categoryAttr) === category;
        item.hidden = !match;
        if (match) visible++;
      });
      if (count) count.textContent = `${visible} ${visible === 1 ? noun[0] : noun[1]}`;
    });
  });
}

function setupArchive() {
  const grid = document.getElementById('gallery-grid');
  wireFilters({
    filterWrap: document.getElementById('archive-filters'),
    grid,
    itemSel: '.gallery-item',
    categoryAttr: 'data-category-key',
    count: document.getElementById('gallery-count'),
    noun: ['archived image', 'archived images'],
    allKey: 'all'
  });
  // The old runtime appended pixel dimensions to each label once the image
  // loaded; keep that touch. This reads data-category, not the key beside it:
  // the caption is for a reader, so it wants the label, not the slug.
  grid?.querySelectorAll('.gallery-item img').forEach((image) => {
    const label = image.parentElement.querySelector('span');
    const annotate = () => {
      if (label && image.naturalWidth && image.naturalHeight) {
        label.textContent =
          image.parentElement.getAttribute('data-category') +
          ' · ' + image.naturalWidth + '×' + image.naturalHeight;
      }
    };
    if (image.complete) annotate();
    else image.addEventListener('load', annotate);
  });
}

/* Every token must appear somewhere in the entry, so "book hindi" narrows
 * rather than widens; word order and which field matched do not matter. */
const matchesQuery = (haystack, query) =>
  query.split(/\s+/).every((token) => haystack.includes(token));

/**
 * Publications: a chip row that filters by kind, a text search, and a
 * list/cards layout switch.
 *
 * The chips and the search INTERSECT rather than replace one another, so
 * choosing a kind and then typing narrows within that kind instead of silently
 * discarding it. Everything is recomputed from the two pieces of state on every
 * change rather than toggled incrementally: with two inputs that is cheap, and
 * it removes the whole class of bug where the visible list disagrees with the
 * controls above it.
 */
function setupPublications() {
  const list = document.getElementById('publication-sections');
  const filters = document.getElementById('publication-filters');
  if (!list || !filters) return;
  const search = document.getElementById('publication-search');
  const count = document.getElementById('publication-count');
  const noMatch = document.getElementById('publication-empty');
  const views = document.getElementById('publication-views');
  let kind = 'all';
  // Whatever the build authored is the resting state to return to.
  const restingOpen = new Map(
    [...list.querySelectorAll('.pub-section')].map((g) => [g, g.open])
  );

  const apply = () => {
    const query = search ? search.value.trim().toLowerCase() : '';
    const searching = query.length > 0;
    let shown = 0;
    let scope = 0;

    list.querySelectorAll('.pub-section').forEach((group) => {
      const kindOK = kind === 'all' || kind === group.getAttribute('data-section');
      const cards = [...group.querySelectorAll('.pub-card')];
      if (kindOK) scope += cards.length;

      let visible = 0;
      cards.forEach((card) => {
        const hit =
          kindOK && (!searching || matchesQuery(card.getAttribute('data-search') || '', query));
        card.hidden = !hit;
        if (hit) visible++;
      });
      shown += visible;

      const countNode = group.querySelector('[data-role="count"]');
      if (countNode) {
        const total = countNode.getAttribute('data-total') || String(cards.length);
        countNode.textContent = searching && kindOK ? `${visible} of ${total}` : total;
      }

      const emptyLine = group.querySelector('.pub-section-empty');
      if (!kindOK) {
        // Filtered out by kind — not a result of zero, so say nothing.
        group.hidden = true;
      } else if (visible > 0) {
        group.hidden = false;
        if (emptyLine) emptyLine.hidden = true;
      } else if (searching) {
        // Repeating "no theses yet" under every query would be noise; the
        // page-level line covers a search that matches nothing.
        group.hidden = true;
      } else {
        // Genuinely empty kind, nothing narrowing the view: show it and say so.
        group.hidden = false;
        if (emptyLine) emptyLine.hidden = false;
      }

      // Sections rest collapsed. A search has to open the ones holding matches
      // or it would look broken; picking a single kind opens that one, since
      // asking for it is asking to see it. Returning to All resets to rest,
      // which also discards any manual toggling — predictable, and the same
      // "recompute from state" rule the rest of this function follows.
      if (searching) group.open = visible > 0;
      else if (kind !== 'all') group.open = kindOK;
      else group.open = restingOpen.get(group) ?? false;
    });

    if (noMatch) noMatch.hidden = shown > 0 || !searching;
    if (count) {
      count.textContent = searching
        ? `${shown} of ${scope}`
        : `${scope} ${scope === 1 ? 'publication' : 'publications'}`;
    }
  };

  filters.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    kind = chip.getAttribute('data-filter');
    filters
      .querySelectorAll('[data-filter]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
    apply();
  });
  if (search) search.addEventListener('input', apply);

  // The layout switch is a state on one set of markup, not a second rendering,
  // so filtering and counting behave identically in both views.
  if (views) {
    views.addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      list.setAttribute('data-view', button.getAttribute('data-view'));
      views
        .querySelectorAll('[data-view]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    });
  }

  apply();
}

function setupLightbox() {
  const grid = document.getElementById('gallery-grid');
  const lightbox = document.getElementById('lightbox');
  if (!grid || !lightbox) return;
  const lightboxImage = document.getElementById('lightbox-image');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxClose = document.getElementById('lightbox-close');

  const closeLightbox = () => {
    lightbox.hidden = true;
    lightboxImage.removeAttribute('src');
  };
  grid.addEventListener('click', (event) => {
    const button = event.target.closest('.gallery-item');
    if (!button) return;
    const img = button.querySelector('img');
    const title = button.getAttribute('data-title') || img.alt;
    const category = button.getAttribute('data-category') || '';
    lightboxImage.src = img.src;
    lightboxImage.alt = title;
    lightboxCaption.textContent = category + ' · ' + title;
    lightboxImage.onload = () => {
      lightboxCaption.textContent =
        category + ' · ' + lightboxImage.naturalWidth + '×' + lightboxImage.naturalHeight;
    };
    lightbox.hidden = false;
    lightboxClose.focus();
  });
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });
}

/* ---------- media search ---------- */

function setupMediaSearch() {
  const search = document.getElementById('media-search');
  const count = document.getElementById('media-count');
  if (!search) return;
  const cards = [...document.querySelectorAll('.media-card')];
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const match =
        !query ||
        card.textContent.toLowerCase().includes(query) ||
        (card.dataset.search || '').includes(query);
      card.hidden = !match;
      if (match) visible++;
    });
    if (count) count.textContent = visible + (visible === 1 ? ' story' : ' stories');
  });
}

/**
 * People: affiliation chips, a text search and a sort order over the portrait
 * band — the AIWC directory pattern, sized down for a single band. Chips and
 * search intersect (publications rule); sorting reorders the live cards in
 * place, and "featured" restores the authored order captured at load. The
 * markup arrives complete and ordered from the build, so without JavaScript
 * the full band simply stands as authored.
 */
function setupPeople() {
  document.querySelectorAll('.people-directory').forEach(setupPeopleDirectory);
}

/**
 * One directory over one band. Everything is looked up inside `root`, so a
 * page can carry as many of these as it has portrait bands — collaborators,
 * supporters, anything added later — each filtering only its own cards. The
 * previous version reached for page-wide ids, which quietly limited the whole
 * feature to whichever band happened to come first.
 */
function setupPeopleDirectory(root) {
  const band = root.querySelector('.people-band');
  const sort = root.querySelector('.people-sort');
  if (!band || !sort) return;
  const search = root.querySelector('.people-search');
  const aff = root.querySelector('.people-aff');
  const count = root.querySelector('.people-count');
  const empty = root.querySelector('.people-empty');
  const reveal = root.querySelector('.people-reveal');
  const cards = [...band.children];
  let open = false;

  // Shuffled on load so nobody is permanently first; the order holds for the
  // visit and reshuffles on the next one. Picking any other sort replaces it.
  const shuffled = cards.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const sortKey = (card, mode) =>
    mode === 'affiliation'
      ? (card.dataset.aff || '') + ' ' + (card.dataset.name || '')
      : card.dataset.name || '';

  // "One row" is whatever the grid actually fits on its first line, so it is
  // read back from layout rather than assumed, and remeasured on resize.
  // Both this and the preview cut below walk the live DOM order — walking the
  // authored array would keep the same authored-first faces in the preview no
  // matter how the band is shuffled or sorted.
  const firstRowCount = () => {
    const visible = [...band.children].filter((c) => !c.hidden);
    if (!visible.length) return 0;
    const top = visible[0].offsetTop;
    return visible.filter((c) => c.offsetTop === top).length || visible.length;
  };

  const apply = () => {
    const query = search ? search.value.trim().toLowerCase() : '';
    const mode = sort.value;
    const ordered =
      mode === 'shuffle'
        ? shuffled
        : mode === 'featured'
          ? cards
          : cards.slice().sort((a, b) => sortKey(a, mode).localeCompare(sortKey(b, mode)));
    ordered.forEach((card) => band.appendChild(card));

    let shown = 0;
    cards.forEach((card) => {
      const hit =
        (!aff || !aff.value || card.dataset.aff === aff.value) &&
        (!query || matchesQuery(card.dataset.search || '', query));
      card.hidden = !hit;
      if (hit) shown++;
    });

    let previewed = shown;
    if (!open) {
      const perRow = firstRowCount();
      let seen = 0;
      [...band.children].forEach((card) => {
        if (card.hidden) return;
        seen++;
        if (seen > perRow) card.hidden = true;
      });
      previewed = Math.min(perRow, shown);
    }

    if (reveal) {
      reveal.hidden = shown <= previewed && !open;
      reveal.textContent = open
        ? 'Show fewer'
        : `Show all ${shown} ${shown === 1 ? 'person' : 'people'}`;
      reveal.setAttribute('aria-expanded', String(open));
    }
    if (empty) empty.hidden = shown > 0;
    if (count) {
      count.textContent =
        shown === cards.length
          ? `${cards.length} ${cards.length === 1 ? 'person' : 'people'}`
          : `${shown} of ${cards.length}`;
    }
  };

  if (reveal) reveal.addEventListener('click', () => { open = !open; apply(); });
  if (search) search.addEventListener('input', apply);
  if (aff) aff.addEventListener('change', apply);
  sort.addEventListener('change', apply);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(apply, 150);
  });

  apply();
}

/**
 * Tabbed block groups (people / partner organisations). The build stacks
 * every panel visible; this collapses each group to its first tab. Roving
 * arrow keys per the tablist pattern — focus follows selection.
 */
function setupBlockTabs() {
  document.querySelectorAll('.block-tabs').forEach((group) => {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const panels = [...group.querySelectorAll(':scope > [role="tabpanel"]')];
    if (tabs.length < 2) return;
    const select = (index) => {
      tabs.forEach((tab, j) => {
        tab.setAttribute('aria-selected', String(j === index));
        tab.tabIndex = j === index ? 0 : -1;
      });
      panels.forEach((panel, j) => {
        panel.hidden = j !== index;
      });
    };
    tabs.forEach((tab, j) => tab.addEventListener('click', () => select(j)));
    group.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
      const next = (current + step + tabs.length) % tabs.length;
      select(next);
      tabs[next].focus();
      event.preventDefault();
    });
    select(0);
  });
}

/* ---------- chrome ---------- */

function setupMenu() {
  const menuButton = document.querySelector('.menu-toggle');
  if (menuButton) {
    menuButton.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.querySelector('.menu-toggle-text').textContent = open ? 'Close' : 'Menu';
    });
  }

  // Submenus open on hover for a mouse (CSS) and on the chevron button for
  // touch and keyboard. Only one is open at a time.
  const items = [...document.querySelectorAll('.nav-item.has-menu')];
  const close = (except) => items.forEach((item) => {
    if (item === except) return;
    item.classList.remove('is-open');
    item.querySelector('.nav-more')?.setAttribute('aria-expanded', 'false');
  });
  items.forEach((item) => {
    const more = item.querySelector('.nav-more');
    more?.addEventListener('click', () => {
      const open = !item.classList.contains('is-open');
      close(item);
      item.classList.toggle('is-open', open);
      more.setAttribute('aria-expanded', String(open));
    });
    item.addEventListener('focusout', (event) => {
      if (!item.contains(event.relatedTarget)) close();
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.nav-item.has-menu')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = items.find((item) => item.classList.contains('is-open'));
    if (open) {
      close();
      open.querySelector('.nav-more')?.focus();
    } else if (document.body.classList.contains('menu-open')) {
      menuButton?.click();
      menuButton?.focus();
    }
  });
}

/* ---------- site search ----------
 * The header's search button opens a panel over the page. The index
 * (assets/search.json: pages, sections, researchers, partners and
 * publications) is fetched the first time it opens, then every keystroke is a
 * local filter: all words must match, and title matches rank first. */
function setupSearch() {
  const panel = document.getElementById('search-panel');
  const toggle = document.querySelector('.search-toggle');
  if (!panel || !toggle) return;
  const input = panel.querySelector('#site-search');
  const results = panel.querySelector('#search-results');
  const base = document.body.dataset.base || '';
  let index = null;
  let lastFocus = null;

  const load = async () => {
    if (index) return index;
    try {
      const res = await fetch(base + '/assets/search.json');
      index = (await res.json()).map((e) => ({ ...e, hay: [e.t, e.x, e.s, e.k].filter(Boolean).join(' ').toLowerCase(), title: e.t.toLowerCase() }));
    } catch {
      index = [];
    }
    return index;
  };

  const hint = (text) => {
    results.textContent = '';
    const li = document.createElement('li');
    li.className = 'search-hint';
    li.textContent = text;
    results.appendChild(li);
  };

  const run = async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return hint('Type at least two letters — a topic, a researcher, an institution or a paper.');
    const words = q.split(/\s+/);
    const found = (await load())
      .filter((e) => words.every((w) => e.hay.includes(w)))
      .map((e) => ({ e, score: (e.title.startsWith(q) ? 3 : 0) + words.filter((w) => e.title.includes(w)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
    if (!found.length) return hint(`Nothing matches “${input.value.trim()}”. Try fewer or shorter words.`);
    results.textContent = '';
    for (const { e } of found) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = e.u;
      for (const [cls, text] of [['k', e.k], ['t', e.t], ['x', e.x]]) {
        if (!text) continue;
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        a.appendChild(span);
      }
      li.appendChild(a);
      results.appendChild(li);
    }
  };

  const open = () => {
    lastFocus = document.activeElement;
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    input.focus();
    run();
  };
  const close = () => {
    panel.hidden = true;
    document.body.style.overflow = '';
    lastFocus?.focus();
  };

  toggle.addEventListener('click', open);
  panel.querySelector('.search-close').addEventListener('click', close);
  panel.addEventListener('click', (event) => { if (event.target === panel) close(); });
  input.addEventListener('input', run);
  // A result that only jumps within the current page leaves the panel open
  // over it; close on any click on a result.
  results.addEventListener('click', (event) => { if (event.target.closest('a')) close(); });
  document.addEventListener('keydown', (event) => {
    if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); close(); }
    const typing = /^(input|textarea|select)$/i.test(event.target.tagName || '') || event.target.isContentEditable;
    if (panel.hidden && event.key === '/' && !typing) { event.preventDefault(); open(); }
  });
}

// Each language is its own URL, so switching is a navigation rather than a
// re-render. data-lang-base is written by the build as the current page's
// path within its language, so the choice lands on the same page.
function setupLanguageSwitcher() {
  const select = document.getElementById('lang-select');
  if (!select) return;
  select.addEventListener('change', () => {
    const lang = select.value;
    const slugPath = select.getAttribute('data-lang-base') || '';
    const base = select.getAttribute('data-site-base') || '';
    window.location.href = base + (lang === 'en' ? '/' + slugPath : '/' + lang + '/' + slugPath);
  });
}

/* ---------- boot ---------- */

// Before per-page URLs existed the site routed on #slug. Anyone arriving from
// an old bookmark or shared link lands on the home page with a stale fragment;
// send them to the real URL instead of silently showing the wrong section.
/* On a phone the bar of a tab's pages scrolls sideways; bring this page's
 * entry into view so a later page (Training & capacity building) is not
 * hidden off the edge. Only the bar moves, never the page. */
function setupSubnav() {
  const current = document.querySelector('.subnav .is-current');
  const list = current && current.closest('ul');
  if (!list || list.scrollWidth <= list.clientWidth + 1) return;
  const box = list.getBoundingClientRect();
  const item = current.getBoundingClientRect();
  list.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
}

function redirectLegacyHash() {
  const hash = location.hash.slice(1);
  if (!hash) return false;
  const link = document.querySelector('[data-site-nav] a[data-tab="' + CSS.escape(hash) + '"]:not([data-section])');
  const href = link && link.getAttribute('href');
  if (!href || href === location.pathname) return false;
  location.replace(href);
  return true;
}

if (!redirectLegacyHash()) {
  refreshTextScales();
  let scaleFrame = 0;
  window.addEventListener('resize', () => {
    if (scaleFrame) return;
    scaleFrame = requestAnimationFrame(() => {
      scaleFrame = 0;
      refreshTextScales();
    });
  });
  setupMotion();
  setupSubnav();
  setupMenu();
  setupSearch();
  setupLanguageSwitcher();
  setupMediaSearch();
  setupArchive();
  setupPublications();
  setupPeople();
  setupBlockTabs();
  setupLightbox();
  showReveals(document);
}
