#!/usr/bin/env node
/**
 * Auto-translate missing / changed site strings into the 13 target languages.
 *
 * Runs in CI (see .github/workflows/translate.yml). It:
 *  1. Collects the English source for every translatable key. Nav labels and
 *     page intros come from the registry (content/pages/*.json); body strings
 *     come from RENDERING each page and harvesting its data-i18n /
 *     data-i18n-alt attributes. Because the renderer itself is the source,
 *     the translator and the site can never disagree about which keys exist.
 *  2. Compares against the hidden `en` block in content/i18n.json — the
 *     English each existing translation was made from.
 *  3. Translates only NEW or CHANGED keys (and keys missing in a language).
 *  4. Writes results (and the refreshed `en` block) back to content/i18n.json.
 *
 * Providers (pick via env):
 *  - ANTHROPIC_API_KEY set          → Claude via the official SDK (default
 *    model claude-opus-5; override with TRANSLATE_MODEL). Server-side
 *    fallbacks are enabled so a safety-classifier decline is retried on
 *    another model inside the same call.
 *  - MODELS_ENDPOINT + MODELS_TOKEN → any OpenAI-compatible chat endpoint
 *    (MODELS_MODEL selects the model). This was GitHub Models, which was
 *    retired on 2026-07-30 and now answers 410; the hook is kept because the
 *    same shape fits any other OpenAI-compatible provider.
 *  - otherwise, if a `codex` binary is on PATH → the Codex CLI, run locally on
 *    whatever subscription the machine is signed in with. No key to store and
 *    no free tier to be retired. CI runners have no codex binary, so there it
 *    simply reports what is untranslated — which is the point: translating is
 *    a thing you do on a laptop and commit, not a live dependency of a deploy.
 *    Set TRANSLATE_MODEL to pin a model if the default declines a batch.
 *
 * Run it by hand with:  node scripts/auto-translate.mjs
 *
 * No-op (exit 0, no file change) when nothing needs translating.
 * Fails soft on provider errors: the site keeps its existing translations —
 * English is always the runtime fallback.
 *
 * I18N_PATH overrides the output file (used by scripts/test-translate.mjs).
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { buildRegistry, buildNav, loadNavConfig } from '../src/registry.mjs';
import { renderPage } from '../src/templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_PATH = process.env.I18N_PATH || join(ROOT, 'content/i18n.json');

const TARGET_LANGS = ['es', 'hi', 'lo', 'zh-Hant', 'th', 'jv', 'zh-Hans', 'ar', 'pt', 'fr', 'bn', 'ru', 'id'];
const LANG_NAMES = {
  es: 'Spanish', hi: 'Hindi', lo: 'Lao (Lao script only)', 'zh-Hant': 'Traditional Chinese',
  th: 'Thai', jv: 'Javanese (romanized Basa Jawa, Latin script)', 'zh-Hans': 'Simplified Chinese',
  ar: 'Arabic (Modern Standard)', pt: 'Portuguese', fr: 'French', bn: 'Bengali', ru: 'Russian',
  id: 'Indonesian'
};

/* ---- 1. gather the English source for every key ---- */

function collectEnglish() {
  const en = {};
  const pages = buildRegistry(ROOT);
  const template = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8')).document;

  // Sidebar label (chrome-level, lives in the template). The redesign has no
  // sidebar, so this finds nothing and the old key simply stays unused.
  const navLabel = template.querySelector('.sidebar .nav-label');
  if (navLabel) en['ui.explore'] = navLabel.textContent.trim();

  const home = pages[0];
  // Header menu labels (content/navigation.json). A label that is a page's own
  // name reuses nav.<slug>, collected just below; every other label has its
  // own key, which only the menu knows about.
  for (const tab of buildNav(pages, loadNavConfig(ROOT))) {
    for (const entry of [tab, ...tab.items]) if (entry.label && !entry.key.startsWith('nav.' + (entry.page?.slug ?? '\u0000'))) en[entry.key] = entry.label;
  }
  for (const page of pages) {
    en['nav.' + page.slug] = page.menuName;
    const intro = page.intro || {};
    if (page.slug === home.slug) {
      if (intro.eyebrow) en['hero.eyebrow'] = intro.eyebrow;
      if (intro.title) en['hero.title'] = intro.title;
      if (intro.lede) en['hero.body'] = intro.lede;
      const actions = page.hero?.actions || [];
      if (actions[0]?.label) en['hero.btn1'] = actions[0].label;
      if (actions[1]?.label) en['hero.btn2'] = actions[1].label;
    } else {
      if (intro.eyebrow) en['sec.' + page.slug + '.eyebrow'] = intro.eyebrow;
      if (intro.title) en['sec.' + page.slug + '.title'] = intro.title;
      if (intro.lede) en['sec.' + page.slug + '.lede'] = intro.lede;
    }

    // Body strings: render the page and harvest what the renderer tagged.
    const { document } = parseHTML('<!doctype html><body></body>');
    const section = renderPage(document, page, {
      index: 1,
      total: pages.length,
      urlFor: () => '/'
    });
    section.querySelectorAll('[data-i18n]').forEach((n) => {
      const text = n.textContent.trim();
      if (text) en[n.getAttribute('data-i18n')] = text;
    });
    section.querySelectorAll('[data-i18n-alt]').forEach((n) => {
      const text = (n.getAttribute('alt') || '').trim();
      if (text) en[n.getAttribute('data-i18n-alt')] = text;
    });
  }
  return en;
}

/* ---- 2. providers ---- */

const SYSTEM_PROMPT =
  'You are a professional translator for a non-profit groundwater project (MARVI, India/Australia). ' +
  'Translate short website UI strings accurately, naturally and concisely, in the correct script for each language. ' +
  'Keep these proper nouns UNCHANGED in every language: MARVI, MyWell, Bhujal Jankaars, YINMIK; keep place names ' +
  '(Rajasthan, Gujarat, Dharta, Meghraj) and all numbers/units unchanged. Preserve any leading "01 · " numbering ' +
  'and any line breaks (\\n) in the source. Return ONLY strict JSON, no prose, no code fences.';

const userPrompt = (strings) =>
  `Translate each of these strings into these languages: ${TARGET_LANGS.map((l) => `${l} (${LANG_NAMES[l]})`).join(', ')}.\n` +
  `Return a JSON object mapping each key to an object of { "<langCode>": "<translation>" } for all ${TARGET_LANGS.length} languages.\n\n` +
  `Strings (key -> English):\n${JSON.stringify(strings, null, 2)}`;

const parseJson = (text) => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
};

async function translateBatchAnthropic(entries) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const strings = Object.fromEntries(entries.map((e) => [e.key, e.english]));
  const response = await client.beta.messages.create({
    model: process.env.TRANSLATE_MODEL || 'claude-opus-5',
    max_tokens: 16000,
    // Translation batches are mechanical work — low effort keeps it cheap.
    output_config: { effort: 'low' },
    // A safety-classifier decline is retried on Anthropic's recommended
    // fallback model inside the same call instead of failing the run.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt(strings) }]
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('translation request was declined by safety classifiers');
  }
  const text = response.content.find((b) => b.type === 'text')?.text || '';
  return parseJson(text);
}

async function translateBatchOpenAICompatible(entries) {
  const strings = Object.fromEntries(entries.map((e) => [e.key, e.english]));
  const res = await fetch(process.env.MODELS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MODELS_TOKEN}`
    },
    body: JSON.stringify({
      model: process.env.MODELS_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(strings) }
      ]
    })
  });
  if (!res.ok) throw new Error(`translation API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return parseJson(data.choices[0].message.content);
}

/**
 * The Codex CLI, driven locally — no API key, no service to configure, and no
 * free tier to be retired out from under us. It runs on whatever Codex
 * subscription the machine is already signed in with, which makes it the
 * provider for translating by hand on a laptop rather than in CI. The runner
 * has no codex binary, so CI simply reports what is untranslated and moves on.
 *
 * --output-last-message is what makes this parseable: the agent's chatter goes
 * to stdout, and only its final answer to the file we read.
 */
async function translateBatchCodex(entries) {
  const strings = Object.fromEntries(entries.map((e) => [e.key, e.english]));
  const out = join(tmpdir(), `marvi-translate-${process.pid}-${entries[0].key.replace(/\W/g, '')}.json`);
  const result = spawnSync(
    'codex',
    [
      'exec',
      '--ephemeral',            // no session files for a mechanical batch
      '--skip-git-repo-check',
      '-s', 'read-only',        // it needs to answer, not to touch the repo
      // Only pin a model when asked. Naming one that this CLI version does not
      // know fails before the prompt is ever sent, and the names change; the
      // signed-in default is the one guaranteed to exist. Set TRANSLATE_MODEL
      // if a particular model declines the batch.
      ...(process.env.TRANSLATE_MODEL ? ['-m', process.env.TRANSLATE_MODEL] : []),
      '--output-last-message', out,
      '-'
    ],
    {
      input: SYSTEM_PROMPT + '\n\n' + userPrompt(strings),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    }
  );
  if (result.error) throw new Error(`codex could not be run: ${result.error.message}`);
  if (!existsSync(out)) {
    throw new Error(`codex wrote no answer (exit ${result.status}): ${(result.stderr || '').slice(0, 300)}`);
  }
  const text = readFileSync(out, 'utf8');
  rmSync(out, { force: true });
  return parseJson(text);
}

const codexAvailable = () => spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0;

const provider = process.env.ANTHROPIC_API_KEY
  ? { name: 'anthropic (' + (process.env.TRANSLATE_MODEL || 'claude-opus-5') + ')', run: translateBatchAnthropic }
  : process.env.MODELS_ENDPOINT && process.env.MODELS_TOKEN
    ? { name: 'openai-compatible (' + process.env.MODELS_MODEL + ')', run: translateBatchOpenAICompatible }
    : codexAvailable()
      ? { name: 'codex CLI (' + (process.env.TRANSLATE_MODEL || 'default model') + ')', run: translateBatchCodex }
      : null;

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/* ---- 3. main ---- */

(async () => {
  const en = collectEnglish();
  const i18n = JSON.parse(readFileSync(I18N_PATH, 'utf8'));

  // One-time: record the current English as the baseline WITHOUT translating,
  // so existing (hand-reviewed) translations are kept and only future edits act.
  if (process.argv.includes('--seed')) {
    i18n.en = en;
    writeFileSync(I18N_PATH, JSON.stringify(i18n, null, 2) + '\n');
    console.log(`Seeded en baseline with ${Object.keys(en).length} keys.`);
    process.exit(0);
  }

  const prevEn = i18n.en || {}; // English each existing translation was made from

  const todo = [];
  for (const [key, english] of Object.entries(en)) {
    if (!english) continue;
    const changed = prevEn[key] !== english;
    const missing = TARGET_LANGS.some((l) => !i18n[l] || i18n[l][key] == null);
    if (changed || missing) todo.push({ key, english });
  }

  if (!todo.length) {
    console.log('Nothing to translate — all strings up to date.');
    process.exit(0);
  }
  if (!provider) {
    console.log(
      `${todo.length} string(s) need translation, but no provider is configured ` +
      '(set ANTHROPIC_API_KEY, or MODELS_ENDPOINT + MODELS_TOKEN + MODELS_MODEL). ' +
      'Leaving translations unchanged; English remains the fallback.'
    );
    process.exit(0);
  }
  console.log(`Translating ${todo.length} changed/missing string(s) via ${provider.name}...`);

  try {
    for (const batch of chunk(todo, 12)) {
      const out = await provider.run(batch);
      for (const { key } of batch) {
        const row = out[key];
        if (!row) { console.warn(`  no result for ${key}`); continue; }
        for (const l of TARGET_LANGS) {
          if (row[l] != null) { (i18n[l] ||= {})[key] = row[l]; }
        }
      }
    }
  } catch (err) {
    // Fail soft: a provider outage (e.g. GitHub Models retirement brownouts)
    // must not redden the pipeline — untranslated strings stay English and
    // retry automatically on the next run.
    console.warn(`Auto-translate skipped (provider error, will retry next run): ${err.message}`);
    process.exit(0);
  }

  // Refresh the baseline only for keys that fully translated, so a partial
  // failure retries next run instead of silently sticking at English.
  i18n.en ||= {};
  for (const { key, english } of todo) {
    const complete = TARGET_LANGS.every((l) => i18n[l] && i18n[l][key] != null);
    if (complete) i18n.en[key] = english;
  }
  // Keys that no longer exist keep their translations harmlessly; prune the
  // baseline so a re-added key retranslates.
  for (const key of Object.keys(i18n.en)) {
    if (!(key in en)) delete i18n.en[key];
  }

  writeFileSync(I18N_PATH, JSON.stringify(i18n, null, 2) + '\n');
  console.log(`Updated ${I18N_PATH === join(ROOT, 'content/i18n.json') ? 'content/i18n.json' : I18N_PATH} (${todo.length} strings across ${TARGET_LANGS.length} languages).`);
})();
