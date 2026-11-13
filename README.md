# DeepStats Mobile — Vercel PWA

## What is implemented
- Installable dark-navy Android PWA, five navigation tabs.
- Live statistics and BEST OF THE DAY from `СТАТИСТИКА` / `СЕЛЕКЦИИ`.
- Date-filtered selections, A–F summary from `ДНЕВЕН ЦЕНТЪР`.
- Build from selections in the **same match**, save to a separate `MOBILE_BUILDS` tab; history of app-created builders.
- Private API protected by an application access code; Google credentials stay on the server.
- Service worker caches **only app assets**; match data are not persisted offline.

## Deployment
1. Create a **private** GitHub repository and upload the files from this folder to the repository root.
2. In Google Cloud Console, enable Google Sheets API and create a service account. Create a JSON key and keep it private.
3. Share the existing Google spreadsheet with the service-account `client_email` as **Editor**. This is required to save builders.
4. Import the GitHub repository into Vercel. Choose framework **Other**, root directory `/`, no build command, output directory `public` (if Vercel asks for output directory). Set environment variables from `.env.example` in Vercel Project Settings → Environment Variables. Use the JSON `private_key` value as `GOOGLE_PRIVATE_KEY`; if pasted as literal `\\n`, the backend converts it.
5. Deploy and open the `https://...vercel.app` URL in Chrome on Android. Choose ⋮ → Add to Home screen → Install.
6. Test stats, date-filtered selections, and saving **one test builder**. Confirm it appears in `MOBILE_BUILDS` and in History.

## Important boundaries
- The existing 7 tabs are never modified by this code. The first write creates `MOBILE_BUILDS` and appends a row.
- Existing formulas and statistical summaries do **not yet include** `MOBILE_BUILDS`. Integration with original builder accounting needs a separate mapping/reconciliation step to prevent double counting.
- This version does not implement editing or settling builders, automatic result settlement, custom strategy filter creation, or all advanced strategy/builder functions. These require further development and testing against the original sheet formulas.
- Do not upload the service account JSON or `.env` files to GitHub. The access token is a lightweight personal gate, not full multi-user authentication. Keep the repo private and use a long unique token.
- If the spreadsheet's column layout changes, update the mappings in `api/data.js`.
