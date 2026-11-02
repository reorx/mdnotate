// mdnotate app icon and the two kept alternatives, drawn as SVG on Apple's
// macOS icon grid: a 1024 canvas with an 824 body inset 100 and a 185.4 corner
// radius. The body sits slightly above centre so its drop shadow stays on canvas.
// Each export returns a complete SVG string; `export.mjs` writes them to disk.
// Rationale and history: kb/docs/app-icon.md.

const BODY = 'M285.4,100H738.6A185.4,185.4 0 0 1 924,285.4V738.6A185.4,185.4 0 0 1 738.6,924H285.4A185.4,185.4 0 0 1 100,738.6V285.4A185.4,185.4 0 0 1 285.4,100Z'

// Every icon shares the body, its drop shadow and a clip, so ids are prefixed per icon.
function frame(id, { bg, defs = '', content, border = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<defs>
<filter id="${id}-sh" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".26"/></filter>
<clipPath id="${id}-clip"><path d="${BODY}"/></clipPath>
${defs}
</defs>
<path d="${BODY}" fill="${bg}" filter="url(#${id}-sh)"/>
<g clip-path="url(#${id}-clip)">${content}</g>
${border ? `<path d="${BODY}" fill="none" stroke="${border}" stroke-width="2"/>` : ''}
</svg>
`
}

// A line of text, drawn as a pill.
const bar = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`

// A highlighter stroke with chisel-cut ends, slanted by k.
const marker = (x0, x1, y0, y1, k, fill, extra = '') =>
  `<path d="M${x0 + k},${y0}L${x1 + k},${y0}L${x1},${y1}L${x0},${y1}Z" fill="${fill}" ${extra}/>`

// The chosen icon. The body is the page itself: a heading, five lines of text,
// one of them run over by the amber highlighter, and an orange comment bubble in
// the right margin pointing back at it. Amber and orange are the app's own
// highlight and accent colours. The text column is kept narrow so the bubble can
// be large enough to read as a bubble at Dock sizes.
export function mdnotate() {
  const x = 190
  const content = `
${bar(x, 270, 200, 48, '#26241f')}
${bar(x, 376, 400, 32, '#d4cfc4')}
${marker(172, 560, 430, 510, 22, '#ffc83a')}
${bar(x, 454, 370, 32, '#6e5a1f')}
${bar(x, 532, 400, 32, '#d4cfc4')}
${bar(x, 610, 330, 32, '#d4cfc4')}
${bar(x, 688, 230, 32, '#d4cfc4')}
<g filter="url(#m-bub)">
<path d="M672,390H818A42,42 0 0 1 860,432V508A42,42 0 0 1 818,550H712L640,606L656,550A42,42 0 0 1 630,508V432A42,42 0 0 1 672,390Z" fill="#ff7a2e"/>
</g>
${bar(668, 436, 152, 24, '#fff')}
${bar(668, 480, 100, 24, '#fff')}`
  return frame('m', {
    bg: 'url(#m-bg)',
    border: 'rgba(0,0,0,.07)',
    defs: `<linearGradient id="m-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1eee8"/></linearGradient>
<filter id="m-bub" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#a8430a" flood-opacity=".28"/></filter>`,
    content,
  })
}

// Optical variant for the 16 pt / 32 px Finder sizes. Keep the page, palette
// and heading/highlight/bubble composition, but remove the thin body text and
// enlarge the remaining marks so they survive rasterisation at native pixels.
export function mdnotateSmall() {
  const content = `
${bar(190, 260, 250, 72, '#26241f')}
${marker(166, 560, 422, 550, 26, '#ffc83a')}
${bar(190, 462, 344, 48, '#6e5a1f')}
<g filter="url(#s-bub)">
<path d="M674,374H812A56,56 0 0 1 868,430V526A56,56 0 0 1 812,582H714L628,646L646,576A56,56 0 0 1 618,526V430A56,56 0 0 1 674,374Z" fill="#ff7a2e"/>
</g>
${bar(660, 422, 164, 36, '#fff')}
${bar(660, 492, 112, 36, '#fff')}`
  return frame('s', {
    bg: 'url(#s-bg)',
    border: 'rgba(0,0,0,.07)',
    defs: `<linearGradient id="s-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1eee8"/></linearGradient>
<filter id="s-bub" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#a8430a" flood-opacity=".28"/></filter>`,
    content,
  })
}

// Alternative C: a page and a speech bubble fused into one white silhouette
// (folded corner top right, bubble tail bottom left) on a blue field.
export function pageBubble() {
  const page = 'M318,212H624L744,332V676Q744,712 708,712H462L332,812L364,712H318Q282,712 282,676V248Q282,212 318,212Z'
  const x = 342
  const content = `
<rect x="0" y="0" width="1024" height="1024" fill="url(#c-glow)"/>
<path d="${page}" fill="#fff" filter="url(#c-pg)"/>
<path d="M624,212V304Q624,332 652,332H744Z" fill="#d3ddef"/>
${bar(x, 292, 180, 42, '#1d2a40')}
${bar(x, 380, 340, 28, '#cbd5e5')}
${marker(326, 644, 428, 500, 18, '#ffc83a')}
${bar(x, 450, 296, 28, '#6e5a1f')}
${bar(x, 520, 340, 28, '#cbd5e5')}
${bar(x, 590, 236, 28, '#cbd5e5')}`
  return frame('c', {
    bg: 'url(#c-bg)',
    defs: `<linearGradient id="c-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fa0ff"/><stop offset="1" stop-color="#2a68ec"/></linearGradient>
<radialGradient id="c-glow" cx=".5" cy="0" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<filter id="c-pg" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#0a2a7a" flood-opacity=".35"/></filter>`,
    content,
  })
}

// Alternative D: risograph overprint. Markdown's "#" in blue ink, a fluorescent
// yellow highlighter stroke and a pink note, each layer multiplied over the
// others (yellow on blue prints green, pink on blue prints purple), on paper
// with a light grain.
export function risoHash() {
  const ink = 'style="mix-blend-mode:multiply"'
  const content = `
<g ${ink}>
<g transform="translate(-5,4)" stroke="#1f6fd1" stroke-width="86" stroke-linecap="round" fill="none">
<line x1="446" y1="262" x2="398" y2="762"/>
<line x1="642" y1="262" x2="594" y2="762"/>
<line x1="300" y1="414" x2="748" y2="414"/>
<line x1="282" y1="612" x2="730" y2="612"/>
</g>
</g>
<g ${ink}>${marker(196, 800, 462, 566, 26, '#ffe14a', 'transform="rotate(-5 512 512)"')}</g>
<g ${ink}><path d="M682,176H836A44,44 0 0 1 880,220V306A44,44 0 0 1 836,350H730L660,410L676,350A44,44 0 0 1 638,306V220A44,44 0 0 1 682,176Z" fill="#ff5ca8"/></g>
<rect x="0" y="0" width="1024" height="1024" filter="url(#d-grain)" opacity=".5" ${ink}/>`
  return frame('d', {
    bg: '#f3f0ea',
    border: 'rgba(0,0,0,.06)',
    defs: `<filter id="d-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .32  0 0 0 0 .28  0 0 0 .55 -.12"/></filter>`,
    content,
  })
}

// Output path (relative to this directory) → drawing.
export const ICONS = {
  'mdnotate.svg': mdnotate,
  'mdnotate-small.svg': mdnotateSmall,
  'alternatives/page-bubble.svg': pageBubble,
  'alternatives/riso-hash.svg': risoHash,
}
