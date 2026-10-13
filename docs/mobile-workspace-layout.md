# Mobile workspace layout verification

Baseline: `cbdf54a184c8e46fcf61379998af6bcb8404cd29`.

Changes apply at widths up to 768px. The 1440px layout retains its original typography and spacing. Assignment identity and page title are separated; campaign status/deadline and slot status/deadline share consistent rows. Header, card spacing, editor controls, dialogs, and filters use a compact touch layout. Inputs use 16px text to avoid iOS focus zoom. Primary controls retain at least 44px touch targets.

The closed sidebar inherits hidden visibility. Its old `transition: all` also transitioned inherited visibility on navigation buttons, preventing immediate focus after opening. Sidebar movement and button appearance now transition only their relevant properties; opening focuses the first navigation control, and Escape restores the menu trigger.

## Same-fixture Chrome measurements (CSS pixels)

| Student viewport | Header before → after | Heading before → after | Assignment card before → after |
| --- | --- | --- | --- |
| 390px | 66 → 56 | 33.6 → 26.4 | 799.7 → 594.8 |
| 768px | 78 → 56 | 33.6 → 26.4 | 644.3 → 543.1 |
| 1440px | 78 → 78 | 57.6 → 57.6 | 396.2 → 396.2 |

Cards include a long campaign title, two assignment slots, status, deadline, description and actions. No assignment data is removed. Screenshots use identical 900px viewport height and fixture data.

## Reproducible checks

Build with `node pridedesk/build.mjs`, then from `worker/` run:

`node node_modules/@playwright/test/cli.js test --config playwright.mobile.config.js`

Chrome and WebKit cover student/admin at 360, 390, 430, 768 and 1440px. Tests check horizontal overflow, sidebar opening/focus/Escape, long titles and 30 student rows, editor draft preservation/save/submit, admin review/save, all admin menu routes, filter dropdown viewport bounds and keyboard close, 16px form input text, photo dialog bounds, and a 500px-high viewport representing reduced keyboard space. Tests use isolated mocked APIs and never write production data.

Physical Android/iOS devices, actual mobile keyboard behavior, native OS select popups, and assistive technology remain unverified. WebKit is a desktop automation engine, not an iPhone device test. API/authentication/cache logic and desktop CSS are unchanged.
