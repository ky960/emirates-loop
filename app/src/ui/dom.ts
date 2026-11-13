export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Tagged template that escapes interpolations, for building HTML safely. Use raw() to opt out. */
export class Raw { constructor(public s: string) {} }
export const raw = (s: string) => new Raw(s);
const esc = (v: unknown): string => {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(esc).join("");
  if (v === null || v === undefined || v === false) return "";
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
};
export function html(strings: TemplateStringsArray, ...vals: unknown[]): Raw {
  let s = strings[0];
  vals.forEach((v, i) => { s += esc(v) + strings[i + 1]; });
  return new Raw(s);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, ms = 2800) {
  const e = $("toast");
  e.textContent = text;
  e.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (e.hidden = true), ms);
}

/** Modal sheet. Resolves with the id of the button pressed (data-act), or null if dismissed. */
export function sheet(content: Raw, opts: { dismissable?: boolean } = {}): Promise<string | null> {
  const wrap = $("sheet"), body = $("sheetBody");
  body.innerHTML = content.s;
  wrap.hidden = false;
  const first = body.querySelector<HTMLElement>("[data-act]");
  first?.focus();
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      wrap.hidden = true;
      body.innerHTML = "";
      wrap.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (t) done(t.dataset.act!);
      else if (e.target === wrap && opts.dismissable !== false) done(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && opts.dismissable !== false) done(null); };
    wrap.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
  });
}

/** Read a CSS custom property from :root. */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
