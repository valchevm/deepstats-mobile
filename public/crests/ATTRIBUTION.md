# DeepStats crest sources and coverage

DeepStats displays football club marks only for team identification. Club insignia remain trademarks of their respective owners.

## Sources
1. `JoseArroyave/football-logos` (country folders of club SVGs; repository describes MIT distribution):
   https://github.com/JoseArroyave/football-logos
2. `TheSportsDB` (badge API), used when no unambiguous SVG match is found:
   https://www.thesportsdb.com/

Files are cached locally in `public/crests/`. `manifest.json` maps an exact team label to a locally cached verified badge. `coverage.json` is produced by `scripts/download-crests.py` and records incomplete team coverage. No club is considered covered unless the file really exists. A generated initials shield is clearly a fallback, **not an official crest**.

## Refresh
`.github/workflows/team-crests.yml` runs on Monday, can be manually dispatched and also runs after changes to the refresh script/workflow/team list. The job fetches badges, checks MIME signatures for raster images and SVG syntax/safety, and commits refreshed files and a coverage report.

Never match by partial names when clubs in different countries could collide; country context and authoritative club IDs should be added before resolving remaining ambiguous names. Never equate a national flag to a club logo.

As of the first 2026-11-16 successful automatic import, the report listed **277/450** names with local images; this is a historical snapshot, not a guarantee of current or complete club coverage. To review live coverage, check `coverage.json` in this directory.

