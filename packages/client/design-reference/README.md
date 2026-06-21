# Design reference — north star

`Foreman_AI_Factory_Companion.html` is the **north-star prototype** for the Phase 3
UI, built with Claude Design. It is a target for look and feel — colour, type,
density, mood — **not** a template to copy markup from. Open it in a browser to
see the intended design.

The palette and typography distilled from it live in
[`../design-tokens.css`](../design-tokens.css), the single source of truth for the
visual language. Phase 3 components should consume those tokens, not literal
values from this file.

## Notes for implementation

- **Core palette:** background `#0d0c09`, surface `#0f0e0b`, border `#1a1612`,
  amber accent `#c87830`. Full scales (depths, text greys, semantic colours) are
  in `design-tokens.css`.
- **Fonts:** IBM Plex Mono (labels/numbers), Barlow (body), Barlow Condensed
  (condensed headings). The prototype names them but does not load them — Phase 3
  must self-host/bundle the web fonts (no CDN, to suit the app's needs).
- The prototype is a static mock; behaviour (streaming chat, live work-order
  state, history navigation) comes from the Phase 2 backend.
