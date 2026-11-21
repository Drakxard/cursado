/** Inline, theme-independent illustrations; the active ink comes from --study-ink. */
export function studyPenArt(highlighter = false): string {
  return `<svg class="study-pen-art" aria-hidden="true" viewBox="0 0 36 64" fill="none">
    <defs><linearGradient id="${highlighter ? 'marker' : 'pencil'}-body"><stop stop-color="#bcbcbc"/><stop offset=".38" stop-color="#fff"/><stop offset=".65" stop-color="#eee"/><stop offset="1" stop-color="#aaa"/></linearGradient></defs>
    ${highlighter
      ? '<path d="M12 3h12v13H12z" fill="var(--study-ink,#a3ef49)"/><path d="M12 15h12l7 15v32H5V30z" fill="url(#marker-body)"/><path d="M5 40h26v22H5z" fill="var(--study-ink,#a3ef49)"/><path d="M10 42h5v20h-5z" fill="#fff" opacity=".35"/>'
      : '<path d="M18 2 30 28H6z" fill="url(#pencil-body)"/><path d="m18 2 5 11H13z" fill="var(--study-ink,#202020)"/><path d="M6 28h24v35H6z" fill="url(#pencil-body)"/><path d="M8 29h20" stroke="#999"/>'}
  </svg>`;
}
