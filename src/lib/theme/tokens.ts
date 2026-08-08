import tokens from '../../../design-system/tokens.json';

export type Tokens = typeof tokens;

export function getTokens(): Tokens {
  return tokens;
}

function firstFamilyName(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/g, '');
}

const GOOGLE_FONT_WEIGHTS = '400;500;600;700;800';

/** Same mechanism as the Frontend: a font swap is a tokens.json edit. */
export function googleFontsHref(t: Tokens = tokens): string {
  const families = Array.from(
    new Set(
      [t.typography.fontFamily.heading, t.typography.fontFamily.body, t.typography.fontFamily.mono]
        .map(firstFamilyName)
        .filter(Boolean)
    )
  );
  const params = families
    .map((name) => `family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${GOOGLE_FONT_WEIGHTS}`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/**
 * Renders tokens.json into CSS custom properties for both the dark default
 * (:root) and the light-mode override (html:not(.dark)) — the dashboard's
 * existing dark/light toggle already swaps these variable names, this just
 * sources their values from tokens.json instead of a hardcoded literal.
 */
export function buildThemeCss(t: Tokens = tokens): string {
  const d = t.dashboard.dark;
  const l = t.dashboard.light;
  const type = t.typography;
  return `
:root {
  --minimal-bg-value: ${d.bg};
  --minimal-border-value: ${d.border};
  --minimal-muted-value: ${d.muted};
  --minimal-accent-value: ${d.accent};
  --minimal-row-value: ${d.row};
  --white-value: ${d.white};
  --black-value: ${d.black};
  --brand-primary: ${t.colors.brand.primary};
  --brand-secondary: ${t.colors.brand.secondary};
  --brand-accent: ${t.colors.brand.accent};
  --brand-highlight: ${t.colors.brand.highlight};
  --font-sans: ${type.fontFamily.body};
  --font-heading: ${type.fontFamily.heading};
  --font-mono: ${type.fontFamily.mono};
}
html:not(.dark) {
  --minimal-bg-value: ${l.bg};
  --minimal-border-value: ${l.border};
  --minimal-muted-value: ${l.muted};
  --minimal-accent-value: ${l.accent};
  --minimal-row-value: ${l.row};
  --white-value: ${l.white};
  --black-value: ${l.black};
}
`.trim();
}
