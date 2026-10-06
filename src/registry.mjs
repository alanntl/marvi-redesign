/**
 * The page registry: which pages exist, in what order.
 *
 * Every page is a file in content/pages/ — the twelve that shipped with the
 * site and anything created in the CMS, one shape for all. Order is the
 * `order` field (set in the CMS); ties and missing values fall back to
 * alphabetical so a hand-added file still lands somewhere sensible.
 *
 * Shared by build, verify and (later) the translator so they can never
 * disagree about what the site contains.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function buildRegistry(root) {
  const dir = join(root, 'content/pages');
  if (!existsSync(dir)) return [];
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const id = f.replace(/\.json$/, '');
      let data = {};
      try {
        data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch (err) {
        throw new Error(`content/pages/${f} is not valid JSON: ${err.message}`);
      }
      return {
        id,
        slug: data.slug || id,
        menuName: data.menuName || id,
        order: Number.isFinite(data.order) ? data.order : 500,
        published: data.published !== false,
        template: data.template || 'standard',
        ...data
      };
    })
    .filter((p) => p.published);
  pages.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return pages;
}

/**
 * The header menu, as editors set it in the CMS (Site-wide → Header menu,
 * stored in content/navigation.json):
 *
 *   { tabs: [{ label, page, button?, items?: [{ label, page?, section?, url? }] }] }
 *
 * A tab opens its own page and, when it has items, a dropdown. An item opens a
 * page, a section of a page (`section` is the heading's anchor, e.g.
 * "s-the-marvi-4-s-strategy") or an outside address (`url`). The home page is
 * never a tab; the logo is its link.
 *
 * Translations: a label that is exactly a page's menu name reuses that page's
 * existing `nav.<slug>` key, so the 13 existing translations of the page
 * names keep working. Any other label is new English and carries its own
 * `nav.label.<slug>.<n>` key, which the translation job fills in later.
 *
 * Returns tabs with `page` resolved to page records; items carry `page`
 * (a record) or `url`. Items naming a page that does not exist are dropped
 * rather than rendered as dead links.
 */
export function loadNavConfig(root) {
  const file = join(root, 'content/navigation.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { tabs: [] };
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export function buildNav(pages, navConfig = {}) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const placed = new Set(pages[0] ? [pages[0].slug] : []);
  const keyFor = (label, page, fallback) => (page && sameName(label, page.menuName) ? 'nav.' + page.slug : fallback);
  const nav = [];
  (navConfig.tabs || []).forEach((tab, ti) => {
    const page = bySlug.get(tab.page);
    if (!page) return;
    placed.add(page.slug);
    const items = [];
    (tab.items || []).forEach((item, ii) => {
      const url = typeof item.url === 'string' && /^https?:\/\//.test(item.url.trim()) ? item.url.trim() : null;
      const target = item.page ? bySlug.get(item.page) : null;
      if (!url && !target) return;
      if (target) placed.add(target.slug);
      const label = item.label || target?.menuName || url;
      items.push({
        label,
        key: url || item.section ? `nav.label.${ti}.${ii}` : keyFor(label, target, `nav.label.${ti}.${ii}`),
        page: url ? null : target,
        section: !url && item.section ? String(item.section).replace(/^#/, '') : null,
        url,
      });
    });
    const label = tab.label || page.menuName;
    nav.push({ label, key: keyFor(label, page, `nav.label.${ti}`), page, button: tab.button === true, items });
  });
  const unlisted = pages.filter((p) => !placed.has(p.slug));
  return unlisted.length ? placeUnlistedPages(nav, unlisted) : nav;
}

/**
 * Where a page goes when the Header menu does not mention it — typically a
 * page an editor has just created in the CMS. Before the header existed every
 * page appeared in the side rail on its own, so the CMS has to keep working
 * that way: a new page must never be unreachable, and never stop the site
 * publishing (verify fails the build when a published page is missing from
 * the header). It joins the first tab's dropdown, where an editor can see it
 * and move it in the Header menu.
 */
export function placeUnlistedPages(nav, unlisted) {
  const fallback = nav.find((tab) => !tab.button) || nav[0];
  if (!fallback) return nav;
  for (const page of unlisted) {
    fallback.items.push({ label: page.menuName, key: 'nav.' + page.slug, page, section: null, url: null });
  }
  return nav;
}

/** The tab a page sits under (for its breadcrumb), or null for tab pages and home. */
export const navParentOf = (nav, slug) =>
  nav.find((tab) => tab.page.slug !== slug && tab.items.some((item) => item.page?.slug === slug && !item.section))?.page || null;

/** URL path for a page in a language. The home page owns the root. */
export const urlFor = (lang, page, pages) => {
  const home = pages ? pages[0] : null;
  const slug = home && page.slug === home.slug ? '' : page.slug + '/';
  return lang === 'en' ? '/' + slug : '/' + lang + '/' + slug;
};
