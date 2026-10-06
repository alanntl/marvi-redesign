/*
 * Design preview switcher (staging copy only — see variants.css).
 *
 * A Design dropdown with previous / next buttons at the foot of every page.
 * The choice is applied before first paint by a small inline script in
 * <head> (from ?design= or the last one picked); this file draws the bar
 * and keeps the address and the saved choice in step, so a link to a page
 * with ?design=… shows exactly that design.
 */
const DESIGNS = [
  [
    "Earlier MARVI",
    [
      [
        "field",
        "Field note — paper, ink and copper (current)"
      ],
      [
        "original",
        "Original — paper with the deep teal band"
      ]
    ]
  ],
  [
    "Earthy",
    [
      [
        "monsoon",
        "Monsoon — leaf green and the logo lime"
      ],
      [
        "terracotta",
        "Terracotta — clay red, photo beside the headline"
      ],
      [
        "neem",
        "Neem — olive, photos pinned like field notes"
      ],
      [
        "mud",
        "Mud & moss — brown ink, moss accents, strong rules"
      ]
    ]
  ],
  [
    "Warm & bright",
    [
      [
        "marigold",
        "Marigold — saffron and brown, rounded and soft"
      ],
      [
        "sandstone",
        "Sandstone — rose stone, arched photos"
      ],
      [
        "wheat",
        "Wheat — gold field, short letterbox hero"
      ],
      [
        "dusk",
        "Dusk — aubergine and copper, centred hero"
      ]
    ]
  ],
  [
    "Bold — coloured top bar, drawn background",
    [
      [
        "laterite",
        "Laterite — red-earth top bar, ochre action"
      ],
      [
        "bandhani",
        "Bandhani — deep red with tie-dye dots"
      ],
      [
        "charcoal",
        "Charcoal & lime — dark bar, the logo lime"
      ],
      [
        "contour",
        "Contour — earth tones over drawn contour lines"
      ]
    ]
  ],
  [
    "Elegant",
    [
      [
        "editorial",
        "Editorial — ivory, black and oxblood, serif headings"
      ]
    ]
  ]
];
const DEFAULT = "field";
const root = document.documentElement;
const flat = DESIGNS.flatMap(([, list]) => list);

const apply = (value) => {
  if (value === DEFAULT) root.removeAttribute("data-design");
  else root.setAttribute("data-design", value);
  try { localStorage.setItem("marvi-design", value); } catch { /* the address still carries it */ }
  const url = new URL(location.href);
  if (value === DEFAULT) url.searchParams.delete("design"); else url.searchParams.set("design", value);
  history.replaceState(null, "", url);
  count.textContent = (flat.findIndex(([v]) => v === value) + 1) + " / " + flat.length;
};

const bar = document.createElement("div");
bar.className = "design-switcher";
bar.setAttribute("role", "group");
bar.setAttribute("aria-label", "Design preview");
const label = Object.assign(document.createElement("label"), { htmlFor: "design-select", textContent: "Design" });
const select = Object.assign(document.createElement("select"), { id: "design-select" });
for (const [group, list] of DESIGNS) {
  const og = Object.assign(document.createElement("optgroup"), { label: group });
  for (const [value, text] of list) og.appendChild(Object.assign(document.createElement("option"), { value, textContent: text }));
  select.appendChild(og);
}
const step = (text, name, delta) => {
  const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
  b.setAttribute("aria-label", name);
  b.addEventListener("click", () => {
    const i = flat.findIndex(([v]) => v === select.value);
    select.value = flat[(i + delta + flat.length) % flat.length][0];
    apply(select.value);
  });
  return b;
};
const count = Object.assign(document.createElement("span"), { className: "design-count" });
select.value = root.getAttribute("data-design") || DEFAULT;
select.addEventListener("change", () => apply(select.value));
bar.append(label, step("\u2039", "Previous design", -1), select, step("\u203A", "Next design", 1), count);
document.body.appendChild(bar);
document.body.classList.add("has-design-switcher");
count.textContent = (flat.findIndex(([v]) => v === select.value) + 1) + " / " + flat.length;

// Links to other pages keep the design being compared.
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[href]");
  const d = root.getAttribute("data-design");
  if (!a || !d || a.target === "_blank") return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  url.searchParams.set("design", d);
  a.href = url.toString();
}, true);
