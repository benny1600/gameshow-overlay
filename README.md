# Game Show Overlay v4

Netlify + Ably starter for 10 guest overlays with a host control page and separate guest answer pages.

## What's new in v4
- Host controls the display label, color, reveal timing, and visibility.
- Guests submit answers from `/guest/1` through `/guest/10`.
- Host sees submitted-answer indicators and pending answers.
- `Show / Update` moves the latest guest submission to the on-air overlay.
- Color picker plus preset swatches.
- Quick YES / NO buttons remain on the control page.

## Routes
- `/` → host control page
- `/overlay/1` ... `/overlay/10` → browser source overlays
- `/guest/1` ... `/guest/10` → guest answer pages

## Netlify setup
1. Connect the repo to Netlify.
2. Add `ABLY_API_KEY` in environment variables.
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Deploy.

## OBS setup
Add each overlay page as a Browser Source:
- `https://your-site.netlify.app/overlay/1`
- ...
- `https://your-site.netlify.app/overlay/10`

Use 1920x1080 for each browser source.

## Guest workflow
1. Give each guest their own guest URL.
2. They enter an answer and submit.
3. The host sees `Answered` on the control page.
4. The host clicks `Show / Update` when ready.

## Host hotkeys
- `1-9` / `0` → select + toggle that guest
- `Shift + 1-9` / `0` → reveal that guest's latest submitted answer
- `R` → reveal all latest submitted answers
- `H` → hide all
- `Shift + C` → clear everything
