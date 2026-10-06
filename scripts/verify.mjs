/**
 * Post-build checks. Fails loudly rather than shipping a subtly broken site.
 * Asserts the things that break silently: missing metadata, panels leaking
 * across URLs, relative paths that only resolve at the root, missing files.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { load as parseYaml } from 'js-yaml';
import { buildRegistry, urlFor } from '../src/registry.mjs';
import { BLOCKS } from '../src/templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
// Same rule as the build: a CNAME is a domain root; otherwise the address
// comes from content/site.json `url` + `base` (a preview copy).
const SITE = existsSync(join(ROOT, 'content/site.json')) ? JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8')) : {};
const HAS_CNAME = existsSync(join(ROOT, 'CNAME'));
const BASE = HAS_CNAME ? '' : String(SITE.base || '').replace(/\/$/, '');
const SITE_URL = (HAS_CNAME
  ? 'https://' + readFileSync(join(ROOT, 'CNAME'), 'utf8').trim()
  : String(SITE.url || 'http://localhost').replace(/\/$/, '')) + BASE;
// A site path on disk: strip the base path a preview copy carries.
const onDisk = (ref) => join(OUT, BASE && ref.startsWith(BASE + '/') ? ref.slice(BASE.length) : ref);

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

/* Warnings are for content an editor left half-finished. They are printed but
 * do not fail the build: a picture nobody uploaded yet is a page that is not
 * ready, not a site that cannot ship, and blocking every deploy on one unsaved
 * field would make the CMS feel like a minefield. */
const warnings = [];

const PAGES = buildRegistry(ROOT);
const template = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8')).document;
const LANGS = [...template.querySelectorAll('#lang-select option')].map((o) => o.value);

let checked = 0;
for (const lang of LANGS) {
  for (const page of PAGES) {
    const rel = urlFor(lang, page, PAGES).replace(/^\//, '');
    const file = join(OUT, rel, 'index.html');
    const where = `${lang}/${page.slug}`;
    if (!existsSync(file)) { failures.push(`missing: ${where}`); continue; }
    const { document } = parseHTML(readFileSync(file, 'utf8'));
    checked++;

    // exactly one panel, the right one
    const panels = [...document.querySelectorAll('[data-panel]')];
    check(panels.length === 1, `${where}: expected 1 panel, found ${panels.length}`);
    check(panels[0]?.getAttribute('data-panel') === page.slug, `${where}: wrong panel emitted`);

    // metadata
    const title = document.querySelector('title')?.textContent || '';
    check(title.length > 5, `${where}: title missing`);
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    check(desc.length > 20, `${where}: description missing or too short`);
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
    check(canonical === SITE_URL + urlFor(lang, page, PAGES), `${where}: canonical "${canonical}"`);
    const alts = document.querySelectorAll('link[rel="alternate"]').length;
    check(alts === LANGS.length + 1, `${where}: ${alts} alternates, expected ${LANGS.length + 1}`);
    check(!!document.querySelector('meta[property="og:image"]'), `${where}: og:image missing`);
    check(document.documentElement.getAttribute('lang') === lang, `${where}: <html lang> wrong`);
    if (lang === 'ar') {
      check(document.querySelectorAll('[dir="rtl"]').length > 0, `${where}: no rtl marking`);
    }

    // no relative paths (they 404 one directory down)
    const bad = [...document.querySelectorAll('[src], link[href], a[href]')]
      .map((n) => n.getAttribute('src') || n.getAttribute('href'))
      .filter((v) => v && !/^(https?:|data:|mailto:|tel:|#|\/)/.test(v));
    check(bad.length === 0, `${where}: relative paths: ${bad.slice(0, 3).join(', ')}`);

    // A root-relative path that begins with a hostname is not a path — it is an
    // external address that lost its scheme, and it will 404 on this site
    // instead of reaching the site it names. The check above waves it through
    // precisely because the leading slash makes it look well-formed, which is
    // how a dead LinkedIn link once shipped with every check green.
    const hostish = [...document.querySelectorAll('a[href]')]
      .map((n) => n.getAttribute('href'))
      .filter((v) => /^\/(www\.|[a-z0-9-]+\.(com|org|net|edu|gov|io|co|au|in)\b)/i.test(v || ''));
    check(hostish.length === 0,
      `${where}: href looks like a URL missing its scheme: ${hostish.slice(0, 3).join(', ')}`);
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const badCss = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]
      .map((m) => m[2]).filter((v) => !/^(https?:|data:|\/|#)/.test(v));
    check(badCss.length === 0, `${where}: relative CSS url(): ${badCss.slice(0, 2).join(', ')}`);

    // header menu: the logo is home, every other published page is reachable
    // from the menu, links are real links, and the current page is marked
    const navLinks = [...document.querySelectorAll('[data-site-nav] a[data-tab]')];
    const reachable = new Set(navLinks.map((a) => a.getAttribute('data-tab')));
    if (document.querySelector('a.brand[href]')) reachable.add(PAGES[0].slug);
    const unreachable = PAGES.filter((p) => !reachable.has(p.slug)).map((p) => p.slug);
    check(unreachable.length === 0, `${where}: header menu does not reach ${unreachable.join(', ')} — add them under Site-wide → Header menu in the CMS`);
    check(navLinks.every((a) => !a.getAttribute('href')?.startsWith('#')), `${where}: menu not fully linkified`);
    if (page.slug !== PAGES[0].slug) {
      check(!!document.querySelector('[data-site-nav] a[aria-current="page"], [data-site-nav] .is-current'), `${where}: menu does not mark the current page`);
    }

    // scripts: no inline leftovers, exactly one app module, files exist
    check(document.querySelectorAll('script:not([src])').length === 0,
      `${where}: inline script survived`);
    const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    check(scripts.length === 1 && scripts[0] === BASE + '/assets/app.mjs',
      `${where}: scripts are ${JSON.stringify(scripts)} — without the app module the menus, search and filters do not work`);
    scripts.forEach((ref) => {
      if (ref.startsWith('/')) check(existsSync(onDisk(ref)), `${where}: missing ${ref}`);
    });

    // prerender must never bake a font-size (the invisible-headline class of bug)
    const baked = [...document.querySelectorAll('[data-cms-text-scale]')]
      .filter((n) => (n.getAttribute('style') || '').includes('font-size'));
    check(baked.length === 0, `${where}: prerendered font-size on ${baked.length} node(s)`);
  }
}

// sitemap + robots exist and agree with the registry
check(existsSync(join(OUT, 'sitemap.xml')), 'sitemap.xml missing');
check(existsSync(join(OUT, 'robots.txt')), 'robots.txt missing');
if (existsSync(join(OUT, 'sitemap.xml'))) {
  const locs = (readFileSync(join(OUT, 'sitemap.xml'), 'utf8').match(/<loc>/g) || []).length;
  check(locs === PAGES.length * LANGS.length, `sitemap lists ${locs} URLs, expected ${PAGES.length * LANGS.length}`);
}

/* ---------- the CMS can edit everything the site renders ----------
 *
 * Decap and Sveltia write back only the fields their config declares. So a key
 * that lives in content/ but not in admin/config.yml is not merely uneditable:
 * the next time anyone opens that page in the CMS and hits save, it is DROPPED,
 * silently, along with whatever it was rendering. Adding a field to a renderer
 * and forgetting the config is therefore a data-loss bug with a delay on it,
 * and this is the check that refuses to let it ship.
 */
const config = parseYaml(readFileSync(join(ROOT, 'admin/config.yml'), 'utf8'));
const collection = (name) => config.collections.find((c) => c.name === name);
const byName = (fields) => new Map((fields || []).map((f) => [f.name, f]));

/** Walk a value against the field that is supposed to describe it. */
const auditValue = (value, field, where) => {
  if (value == null || !field) return;
  // Hidden fields are the escape hatch for machine-written data (each block's
  // i18n map): declared, round-tripped, never shown. Their shape is ours.
  if (field.widget === 'hidden') return;
  if (field.widget === 'object') return auditFields(value, field.fields, where);
  if (field.widget === 'list' && Array.isArray(value)) {
    value.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;   // list of scalars
      const at = `${where}[${i}]`;
      if (field.types) {
        const key = field.typeKey || 'type';
        const type = field.types.find((t) => t.name === item[key]);
        if (!type) return check(false, `${at}: no CMS block type "${item[key]}"`);
        return auditFields(item, type.fields, `${at} (${item[key]})`, [key]);
      }
      auditFields(item, field.fields, at);
    });
  }
};

const auditFields = (value, fields, where, extra = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const declared = byName(fields);
  for (const key of Object.keys(value)) {
    if (extra.includes(key)) continue;
    const field = declared.get(key);
    if (!field) { check(false, `${where}: "${key}" is not in admin/config.yml — the CMS would drop it on save`); continue; }
    auditValue(value[key], field, `${where}.${key}`);
  }
};

/* An `image` key that exists but is empty is the shape a CMS entry takes when
 * someone filled in the caption and never uploaded the picture. The image
 * blocks show a stand-in so the row keeps its shape, which is better than a
 * broken box and better than a silent gap — but a stand-in on the live site is
 * still something nobody meant to publish, so name it. */
const emptyImages = (value, where) => {
  if (Array.isArray(value)) return value.forEach((v, i) => emptyImages(v, `${where}[${i}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (key === 'image' && v === '') warnings.push(`${where}.image is empty — a placeholder is showing in its place`);
    else emptyImages(v, `${where}.${key}`);
  }
};

const pageFields = collection('pages').fields;
for (const file of readdirSync(join(ROOT, 'content/pages')).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(ROOT, 'content/pages', file), 'utf8'));
  auditFields(data, pageFields, file);
  emptyImages(data, file);
}
const siteFile = collection('site').files.find((f) => f.file === 'content/site.json');
if (existsSync(join(ROOT, 'content/site.json'))) {
  auditFields(JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8')), siteFile.fields, 'site.json');
}

/* Every block type the renderer knows must also be offerable in the CMS —
 * otherwise it is a block nobody can ever add. */
const cmsTypes = new Set(byName(pageFields).get('blocks').types.map((t) => t.name));
const renderable = Object.keys(BLOCKS);
const unofferable = renderable.filter((t) => !cmsTypes.has(t));
check(unofferable.length === 0, `renderer has block types the CMS cannot add: ${unofferable.join(', ')}`);
const unrenderable = [...cmsTypes].filter((t) => !renderable.includes(t));
check(unrenderable.length === 0, `CMS offers block types the renderer ignores: ${unrenderable.join(', ')}`);

if (warnings.length) {
  console.warn(`\n${warnings.length} warning(s) — the build still ships:`);
  warnings.forEach((w) => console.warn('  ! ' + w));
}

if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s):`);
  failures.slice(0, 25).forEach((f) => console.error('  ✗ ' + f));
  if (failures.length > 25) console.error(`  … and ${failures.length - 25} more`);
  process.exit(1);
}
console.log(`All checks passed across ${checked} built pages.`);
