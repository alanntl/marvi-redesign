#!/usr/bin/env node
/**
 * Reuse existing translations for repeated English — no translation service.
 *
 * When a sentence that is already translated appears somewhere new (a block
 * copied to another page, a page heading reused as a section heading), the
 * new spot gets a new key, and until now it fell back to English in all 13
 * languages until the paid translation job ran again.
 *
 * This copies the translation across instead, but only where it is certainly
 * right: the new key's English must be *exactly* the English the existing
 * translation was made from (content/i18n.json keeps that in its `en` block).
 * The copied entry records the same English, so scripts/auto-translate.mjs
 * sees it as current and never re-sends it.
 *
 * Reads the built English pages, so run it after `npm run build`:
 *
 *   npm run build && node scripts/reuse-translations.mjs && npm run build
 *
 * Prints what it filled in; changes nothing when there is nothing to reuse.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { buildRegistry } from '../src/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const I18N_PATH = join(ROOT, 'content/i18n.json');
const i18n = JSON.parse(readFileSync(I18N_PATH, 'utf8'));
const LANGS = Object.keys(i18n).filter((l) => l !== 'en');
const source = i18n.en || {};

if (!existsSync(OUT)) {
  console.error('No _site/ — run `npm run build` first.');
  process.exit(1);
}

/* English for every key on the site: body strings from the built pages,
 * page intros (the sec.* / hero.* slots) from the page files. */
const english = {};
const isLangDir = (name) => LANGS.includes(name);
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return dir === OUT && isLangDir(f) ? [] : walk(p);
  return f === 'index.html' ? [p] : [];
});
for (const file of walk(OUT)) {
  const { document } = parseHTML(readFileSync(file, 'utf8'));
  document.querySelectorAll('[data-i18n]').forEach((n) => {
    const text = n.textContent.trim();
    if (text) english[n.getAttribute('data-i18n')] ??= text;
  });
}
const pages = buildRegistry(ROOT);
for (const page of pages) {
  const intro = page.intro || {};
  if (page.slug === pages[0].slug) continue; // the hero keys are the original ones
  for (const part of ['eyebrow', 'title', 'lede']) {
    if (intro[part]) english[`sec.${page.slug}.${part}`] ??= intro[part];
  }
}

/* Index every existing translation by the English it was made from. */
const byEnglish = new Map();
for (const [key, text] of Object.entries(source)) {
  const clean = String(text).trim();
  if (!byEnglish.has(clean)) byEnglish.set(clean, key);
}

let filled = 0;
const report = [];
for (const [key, text] of Object.entries(english)) {
  const donor = byEnglish.get(text);
  if (!donor || donor === key) continue;
  let used = false;
  for (const lang of LANGS) {
    if (i18n[lang]?.[key] != null && source[key] === text) continue; // already current
    const t = i18n[lang]?.[donor];
    if (t == null) continue;
    i18n[lang][key] = t;
    used = true;
  }
  if (used) {
    source[key] = text;
    filled++;
    report.push(`  ${key}  ←  ${donor}  “${text.slice(0, 60)}${text.length > 60 ? '…' : ''}”`);
  }
}

if (!filled) {
  console.log('Nothing to reuse: every repeated sentence already has its translations.');
} else {
  i18n.en = source;
  writeFileSync(I18N_PATH, JSON.stringify(i18n, null, 2) + '\n');
  console.log(`Reused existing translations for ${filled} key(s), in ${LANGS.length} languages:`);
  console.log(report.join('\n'));
}
