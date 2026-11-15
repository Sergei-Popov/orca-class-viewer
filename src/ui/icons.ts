// Inline 16×16 icons drawn with `currentColor`, so they follow the theme.

const paths = {
  chevron: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  package: '<path d="M8 1.75 13.75 4.6v6.8L8 14.25 2.25 11.4V4.6z"/><path d="M2.4 4.7 8 7.5l5.6-2.8M8 7.5v6.6"/>',
  classfile: '<rect x="2" y="2" width="12" height="12" rx="3"/><path d="M9.9 6.1a2.4 2.4 0 1 0 0 3.8"/>',
  inner: '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.6" stroke-dasharray="2.2 1.6"/><path d="M9.6 6.35a2.1 2.1 0 1 0 0 3.3"/>',
  folder: '<path d="M1.75 4.25c0-.55.45-1 1-1h3.4l1.5 1.6h5.6c.55 0 1 .45 1 1v6.4c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z"/>',
  root: '<path d="M1.75 4.25c0-.55.45-1 1-1h3.4l1.5 1.6h5.6c.55 0 1 .45 1 1v6.4c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z"/><path d="M7.4 7.6 6 9l1.4 1.4M9.6 7.6 11 9l-1.4 1.4"/>',
  file: '<path d="M4 1.75h4.9l3.35 3.35v8.65c0 .28-.22.5-.5.5H4a.5.5 0 0 1-.5-.5V2.25c0-.28.22-.5.5-.5z"/><path d="M8.75 1.9v3.35h3.35"/>',
  text: '<path d="M4 1.75h4.9l3.35 3.35v8.65c0 .28-.22.5-.5.5H4a.5.5 0 0 1-.5-.5V2.25c0-.28.22-.5.5-.5z"/><path d="M8.75 1.9v3.35h3.35M5.75 8.25h4.5M5.75 10.75h4.5"/>',
  image: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.25"/><circle cx="5.5" cy="6.25" r="1.25"/><path d="m2.25 12 3.6-3.6 2.4 2.4 2.1-2.1 3.4 3.4"/>',
  archive: '<rect x="1.75" y="2.25" width="12.5" height="3.25" rx=".75"/><path d="M2.75 5.5v7.25c0 .55.45 1 1 1h8.5c.55 0 1-.45 1-1V5.5M6.5 8.25h3"/>',
  manifest: '<path d="M4 1.75h4.9l3.35 3.35v8.65c0 .28-.22.5-.5.5H4a.5.5 0 0 1-.5-.5V2.25c0-.28.22-.5.5-.5z"/><path d="M8.75 1.9v3.35h3.35M5.75 8.25h1.5M8.75 8.25h1.5M5.75 10.75h1.5M8.75 10.75h1.5"/>',
  save: '<path d="M8 2v8.25M4.75 7 8 10.25 11.25 7M2.5 11.5v1.75c0 .41.34.75.75.75h9.5c.41 0 .75-.34.75-.75V11.5"/>',
  copy: '<rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.25"/><path d="M10.75 5.25V3.5c0-.69-.56-1.25-1.25-1.25H3.5c-.69 0-1.25.56-1.25 1.25v6c0 .69.56 1.25 1.25 1.25h1.75"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.5 3.5"/>',
  up: '<path d="M4 10 8 6l4 4"/>',
  down: '<path d="m4 6 4 4 4-4"/>',
  close: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>',
  expand: '<path d="m4.5 6 3.5-3.5L11.5 6M4.5 10l3.5 3.5 3.5-3.5"/>',
  collapse: '<path d="m4.5 2.5 3.5 3.5 3.5-3.5M4.5 13.5 8 10l3.5 3.5"/>',
  warning: '<path d="M8 1.75 1.5 13.25h13z"/><path d="M8 6.25v3.5M8 11.5v.25"/>',
  info: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.75v.25"/>',
  open: '<path d="M1.75 4.25c0-.55.45-1 1-1h3.4l1.5 1.6h5.6c.55 0 1 .45 1 1v1.4"/><path d="M1.75 4.5v7.75c0 .55.45 1 1 1h9.6l2-5.75H4.1l-2 5.5"/>',
  arrow: '<path d="M3 8h9.5M9 4.5 12.5 8 9 11.5"/>',
  layers: '<path d="m8 2 6 3-6 3-6-3z"/><path d="m2 8 6 3 6-3M2 11l6 3 6-3"/>',
  module: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'
}

export type IconName = keyof typeof paths

export function icon(name: IconName, className = ''): string {
  return `<svg class="cv-icon ${className}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`
}
