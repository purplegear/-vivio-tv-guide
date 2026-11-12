# VIVIO TV Guide — Free, no subscription

**Complete code package, NOT a currently deployed live website.** No hosting fees or paid EPG API required by the project. Automatic refresh and GitHub Pages depend on public GitHub repositories and the availability/terms of third-party EPG feeds. Actual upstream EPG data has not been fetched from this execution environment, so coverage must be verified after first scheduled job.

## Intended mobile app

- 🇫🇷 France, 🇧🇬 Bulgaria, 🇬🇧 United Kingdom
- "Now" and 24-hour schedule with swiping, date navigation, programme detail, search and local favourites
- Silver-grey gradient sidebar, Light / Dark main content
- Real programme records only; empty/error state if data source fails
- Local broadcaster time (Europe/Paris, Europe/Sofia, Europe/London) regardless of the user's mobile timezone

## Publish using GitHub Free

1. Create **a new PUBLIC repository** named `vivio-tv-guide` in the user's own GitHub account; do **not** make unrelated private repositories public. Ensure the GitHub connector is authorised for that new repository if using it to push files.
2. Upload this project's contents to the repository root (`docs/`, `scripts/`, `tests/`, `.github/`, `server.js`, `package.json` and `.gitignore`). Do not upload the ZIP as a single ZIP file.
3. In GitHub **Settings → Pages**, choose **GitHub Actions** as the publishing source. The same workflow both refreshes the listings and deploys the website. The webpage URL will be `https://<USERNAME>.github.io/vivio-tv-guide/`, once publishing completes.
4. Push to `main` starts the initial deployment; if necessary run **Actions → Update & publish VIVIO TV Guide → Run workflow** once. It then updates four times daily while GitHub Actions and the free sources are available.

If Actions has been disabled or source URLs fail, the app shows an error; it does not invent a show. For an accurate personal channel catalogue, users can request additional authorised TV-guide providers.

## Data sources

The allowlisted free XMLTV sources are in `server.js` under `FEEDS`: XMLTV France, EPGTalk UK, MEGA EPG Bulgaria, M3U Edit, iptv-org Vivacom BG, Freeview, epg.pw and others. They are community-provided, not official guaranteed broadcaster APIs; channel counts, refresh rates, and right to redistribute may vary. Before publicly redistributing programme text, verify each provider's licence/terms. The site indicates unavailable channels clearly.

GitHub Actions workflow: `.github/workflows/update-guide.yml` (runs every six hours, no passwords). It downloads, merges and normalizes EPG, then publishes compact **per-day JSON** at `docs/data/{FR,BG,GB}/YYYY-MM-DD.json`. The data is sent to browsers from GitHub Pages, not downloaded directly from EPG sites. On a refresh failure, existing JSON files are retained.

## Local quality checks

```bash
npm test
node scripts/build-data.js
```

`npm test` is entirely offline and uses synthetic input *only in test code*. The shipping `docs/data` directory contains **no fabricated TV schedules**.

> GitHub Pages and public-repository GitHub Actions may be free within GitHub's current limits; there is no implied guarantee that the source services will remain free/available or that every desired TV channel is covered.
