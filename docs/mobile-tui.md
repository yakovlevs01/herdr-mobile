# Mobile TUI fork

This fork keeps Ovis's computer/workspace/agent sidebar and Herdr transport, and
opens live terminals by default. It is intended for iPhone use through Tailscale
with Linux and macOS hosts.

- Tap the terminal cursor row to type. Taps elsewhere click TUI controls without raising the keyboard.
- Tap the fixed keyboard button to type, and tap it again to hide the keyboard.
- Swipe inside a TUI region to scroll it. The region where the swipe starts owns
  the entire stroke; releasing a swipe does not click. Flicks coast briefly and stop on
  the next touch or key. Reduced-motion preference disables coasting.
- Escape, Tab, arrows and Enter are first in the default service-key row.
  Swipe the key row sideways for modifiers and Ctrl+C; the keyboard button stays.
- Pinch still changes terminal text size. Existing custom key layouts are preserved.
- An interrupted connection never replays a touch action. Reconnecting restores the
  existing Herdr session; a page reload starts with the keyboard closed.

## Local development

```sh
bun install --frozen-lockfile
bun run build
HOST=127.0.0.1 PORT=7318 HERDR_WEB_STATE_DIR="$HOME/.local/state/herdr-mobile" \
  HERDR_SOCKET="/absolute/path/to/herdr.sock" bun run server
```

Use `bun run server`, not the upstream managed updater: an upstream auto-update
would replace this fork. Use a separate state directory and port alongside an
existing install. Preserve the upstream MIT license and attribution.

For an installed phone web app, use a separate Tailscale Serve HTTPS port pointing
to the loopback listener. Do not replace the existing app's Serve mapping. The
bridge can import the host's saved Herdr machines; SSH still travels through the
existing Tailscale aliases. Keep authentication and pairing enabled as upstream
provides them. Do not expose the listener on all interfaces.

## Repeatable browser checks

```sh
bun node_modules/playwright-core/cli.js install chromium webkit
bun run check fast
UI_EVIDENCE_DIR=/absolute/path/to/evidence bun run test:mobile
```

`test:mobile` builds current source and creates an isolated Herdr with temporary
configuration. It checks actual bytes received by a raw PTY, tap/swipe/cancel
behavior, keyboard focus, Unicode input, reload, short viewports and rotation.
It also runs desktop mouse/arrow, pinch, held-key, sticky-modifier and customizable
key-bar regressions. Chromium uses
trusted touch gestures. WebKit uses native touchscreen taps and DOM event replay
for swipes/cancellations because Playwright has no WebKit multi-touch protocol.
Neither desktop engine emulates the real iOS software keyboard or Safari chrome.

To test the actual installed Grill TUI as well:

```sh
GRILL_MOBILE_TEST=1 UI_EVIDENCE_DIR=/absolute/path/to/evidence bun run test:mobile
```

The optional check discovers `~/.codex/skills/grill-ui` and its installed venv,
or accepts `GRILL_SKILL_DIR` and `GRILL_PYTHON`. It starts a fresh Grill session,
replaces only that session's Codex executable with a local test stub, selects an
answer, writes a message, scrolls a long reply and question, and submits a round.
Assertions read its final submission. It does not call a model, send the real
parent agent a message, or touch any real Grill session.

For manual inspection with a browser agent, set `MOBILE_QA_HOLD=1` when running
`bun run check run --build bun scripts/grill-mobile-regression.ts`. After passing,
the script prints its loopback URL and waits up to 20 minutes for a `done` file in
its printed temporary directory. Closing the inspection cleans up only its own
workspace, browser and servers. Mobile emulation must include touch support and
`(pointer: coarse)`, not just a narrow viewport.
