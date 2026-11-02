# Accessibility

OPNduck tries to be usable by as many people as possible. This page says what is supported, what is not, and how
to report a barrier.

## What works today

- **Keyboard:** the app is built from normal buttons, inputs and links, so Tab, Enter, Space and Escape work, there
  is a visible focus outline, and a command palette (default `Ctrl+Space`, rebindable in Settings > Keybinds)
  reaches every tool and page.
- **Terminal app:** the TUI (`opnduck-tui`) runs in any terminal, needs no mouse, and works over SSH.
- **Themes:** 26 themes, including a plain Monochrome theme, so you can pick the contrast that suits you.
- **Reduced motion:** when your system asks for reduced motion, the animated icons and the falling background
  pixels stop, and theme changes switch without the transition.
- **Labels:** many buttons and icon-only controls carry text labels for screen readers.

## Known limitations

- Some cards (the visual trimmer, the plugin wheel) rely on a pointer for fine control. Typing times works instead
  for the trimmer.
- Plugin cards are made by other people and may not follow these rules.
- Screen reader support has had little testing, and progress bars may not announce their value yet. Please tell me
  what does not work.

## Reporting a barrier

Open an issue with the **Bug report** form and say "accessibility" in the title. Describe the tool you use (screen
reader, keyboard only, magnifier, switch) and what you could not do.
