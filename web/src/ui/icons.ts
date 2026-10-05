// Inline SVG icons for buttons. Stroke icons on a 24×24 grid that inherit
// `currentColor`, so they follow the button's text color in every state.

export type IconName = 'undo' | 'restart' | 'hint' | 'symbols' | 'player' | 'remove';

const PATHS: Readonly<Record<IconName, string>> = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  restart:
    '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  hint:
    '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/>',
  symbols:
    '<circle cx="7" cy="7" r="3.2"/><path d="M17 3.8 20.4 10h-6.8Z"/><rect x="3.8" y="14" width="6.4" height="6.4" rx="1"/><path d="m17 13.6 3.4 3.4-3.4 3.4-3.4-3.4Z"/>',
  player:
    '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  remove: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
};

/** An `<svg>` element for `name`, hidden from assistive technology. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  svg.innerHTML = PATHS[name];
  return svg;
}
