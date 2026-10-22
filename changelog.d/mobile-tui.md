### Changed
- This mobile fork opens agent panes in Terminal by default. The keyboard has a fixed explicit toggle; terminal taps and service keys do not open it. Navigation keys precede modifiers in the default key bar.

### Fixed
- Touch taps send one mouse press/release to the TUI. Swipes, cancellations and pinches cannot become clicks; a swipe keeps scrolling the panel where it started.
- Service-key taps are delivered at touch release, including in WebKit where preventing focus can suppress the compatibility click. Held arrows still repeat without an extra release key.
