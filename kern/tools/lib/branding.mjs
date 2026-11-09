// Branding helpers: WCAG contrast and generation of the CSS variables file.

const SYSTEM_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(hexA, hexB) {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// Pairs that carry text and must reach WCAG AA (4.5:1).
export const CONTRAST_PAIRS = [
  ['text', 'hintergrund'],
  ['text', 'flaeche'],
  ['auf_primaer', 'primaer'],
];

export function fontFileUrl(file) {
  return `schriften/${file}`;
}

export function brandingCss(branding) {
  const { farben, schrift } = branding;
  const lines = ['/* Automatisch erzeugt – nicht von Hand bearbeiten. */'];

  const family = schrift.familie === 'system'
    ? SYSTEM_FONT_STACK
    : `"${schrift.familie}", ${SYSTEM_FONT_STACK}`;

  if (schrift.familie !== 'system') {
    for (const f of schrift.dateien) {
      lines.push(
        '@font-face {',
        `  font-family: "${schrift.familie}";`,
        `  src: url("${fontFileUrl(f.datei)}") format("woff2");`,
        `  font-weight: ${f.gewicht};`,
        `  font-style: ${f.stil};`,
        '  font-display: swap;',
        '}',
      );
    }
  }

  lines.push(
    ':root {',
    `  --color-primary: ${farben.primaer};`,
    `  --color-on-primary: ${farben.auf_primaer};`,
    `  --color-accent: ${farben.akzent};`,
    `  --color-bg: ${farben.hintergrund};`,
    `  --color-surface: ${farben.flaeche};`,
    `  --color-text: ${farben.text};`,
    `  --color-border: ${farben.rahmen};`,
    `  --font-family: ${family};`,
    // Absolute path: url() inside custom properties resolves against the stylesheet that uses it.
    `  --logo-url: url("/kunde/${branding.logo}");`,
    '}',
    '',
  );
  return lines.join('\n');
}
