# Appearance palettes

The app includes fourteen locally bundled themes. Select **Appearance** in the header to preview and switch themes; the choice is saved on this PC. Light, Catppuccin Latte, Marshmallow, Pewter and Pebble use light native controls and request a light Windows title bar. The remaining themes use dark mode. The light/dark scheme controls native widgets; Pewter and Pebble deliberately use mid-tone grey surfaces.

Jacob requested two alternatives between bright light themes and deep dark themes:

| Theme | Character | Main surfaces and treatment |
| --- | --- | --- |
| **Pewter** | Serious, restrained | Cool grey canvas `#b4b9bf`, raised grey cards `#c8cdd2`, dark ink and steel-blue accents. Existing compact corner geometry; no decorative gradient. |
| **Pebble** | Fun, soft | Warm grey canvas `#c4bebf`, cards `#d6d0cf`, dusty lavender, peach and mint accents. Rounded cards/forms, pill buttons, a muted budget gradient and soft help popups. |

Both avoid white main surfaces and keep dark readable text. Pewter's budget caption was darkened after the measured contrast initially fell below 4.5:1. Checks now cover the 14-theme picker, persistence, native scheme requests, help, validation states and compact layout, plus brightness bounds on the new palettes' actual rendered surfaces. See [grey-theme QA](qa/QA_2026-11-04_grey_themes.md).

Marshmallow is an original pastel theme: a cream canvas, lavender navigation and buttons, blush budget card, peach spending card, and mint income card. Dark plum text keeps values and labels legible. Rounded cards, dialogs, inputs, and pill-shaped buttons are scoped to this theme in `src/appearance.css`; the miniature preview reflects the palette and softer geometry. Table density and professional interface wording remain consistent.

The original Light, Dark, Slate, Neon, Synthwave, and Robotic Terminal palettes are joined by five adaptations of established community palettes:

| Theme            | Palette reference                                                                            | App treatment                                                        |
| ---------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Catppuccin Mocha | [Catppuccin palette](https://github.com/catppuccin/catppuccin#-palette)                      | Mocha base, mantle, crust, mauve, and pastel accents                 |
| Catppuccin Latte | [Catppuccin palette](https://github.com/catppuccin/catppuccin#-palette)                      | Latte surfaces and mauve accents; darker status text for legibility  |
| Gruvbox          | [Gruvbox](https://github.com/morhetz/gruvbox)                                                | Dark variant with warm gray, cream, amber, and muted teal            |
| Tokyo Night      | [Tokyo Night palette](https://github.com/tokyo-night/tokyo-night-vscode-theme#color-palette) | Night canvas, raised navy surfaces, blue and violet accents          |
| Dracula          | [Dracula palette](https://draculatheme.com/contribute#color-palette)                         | Charcoal surfaces, purple actions, pink highlights, and cyan details |

These are independent application adaptations. Surface layers, muted text, and status colors are adjusted where necessary for readable financial tables and forms. No upstream code, logos, fonts, or external theme packages are bundled. The app's layout, category icons, and financial behavior remain consistent across themes.

`src/themes.ts` defines each theme's stable ID and light/dark scheme. `src/themes.css` maps palettes to semantic colors used by the interface and miniature previews. Both browser controls and native title-bar requests use the catalog's scheme, including when switching between the five light-scheme palettes and dark palettes. Existing saved theme IDs remain valid. Pebble shares Marshmallow's scoped soft geometry in `src/appearance.css`; its distinct grey palette applies equally to previews and real views.
