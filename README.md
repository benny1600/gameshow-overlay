# Game Show Overlay Starter v2

A Netlify + React + Ably starter for controlling 10 guest lower-thirds in live streams.

## What changed in v2

- bigger game-show style control page
- selected-guest control panel
- live preview panel
- hotkeys for fast reveals during the show
- quick-answer buttons for THIS / THAT / YES / NO
- selected card highlight so you can see who you are working on

## What it does

- `/` = control dashboard
- `/overlay/1` through `/overlay/10` = guest overlay pages
- secure-ish starter auth flow using a Netlify Function to mint Ably token requests
- per-guest label, answer text, theme, show/hide, and clear
- show all / hide all / clear all buttons
- keyboard shortcuts for live operation

## Hotkeys

These only work when you are not typing in a field.

- `1-9` and `0` = toggle Guest 1-10
- `Shift + 1-9` and `Shift + 0` = set that guest to `THIS` and show it
- `Alt + 1-9` and `Alt + 0` = set that guest to `THAT` and show it
- `R` = reveal all
- `H` = hide all
- `Shift + C` = clear all

## Why this setup

Ably recommends token authentication for clients instead of exposing your private API key in the browser. Netlify Functions can securely access runtime environment variables, so the browser asks your function for auth and never sees the secret key.

## Local setup

1. Install dependencies:
   npm install

2. Create a `.env` file or set a Netlify environment variable:
   ABLY_API_KEY=your-app-id.key-id:secret

3. Run locally:
   npm run dev

If you want local Netlify Functions to behave exactly like production, use Netlify CLI.

## Deploy to Netlify

1. Push this folder to GitHub.
2. Create a new Netlify site from the repo.
3. In Netlify, add an environment variable named `ABLY_API_KEY`.
4. Make sure the variable scope includes **Functions**.
5. Deploy.

## OBS setup

- Add your guest camera as usual.
- Add a Browser Source above it with the matching overlay URL:
  - `https://your-site.netlify.app/overlay/1`
  - `https://your-site.netlify.app/overlay/2`
  - and so on through `/overlay/10`
- Recommended browser source size: `1920x1080`
- The page background is transparent, so it should sit cleanly on top of video.

## Step-by-step live workflow

1. Open your control page.
2. Put each guest overlay URL into the matching browser source in OBS.
3. On the control page, click **Select** on the guest you want to work on.
4. Type their label and answer, or use the quick buttons for THIS / THAT / YES / NO.
5. Click **Show / Update** to push that guest live.
6. During the show, use hotkeys for speed:
   - press `3` to toggle Guest 3
   - press `Shift + 3` to instantly make Guest 3 say `THIS`
   - press `Alt + 3` to instantly make Guest 3 say `THAT`
7. Use `R` for a big all-at-once reveal.
8. Use `H` to hide every lower third.
9. Use `Shift + C` between rounds to clear everybody.

## Easy upgrades next

- password-protect the control page
- separate name and answer into different overlay layers
- add score, buzzer state, or timer fields
- add lock/prep mode so answers can be staged without going live
- add per-round presets
