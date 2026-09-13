TRUTH.OFLIFES — DIRECT PDF UPLOAD (FINAL)

This package keeps PDF upload INSIDE the existing admin.html.

FILES
1. admin.html — current admin dashboard with direct PDF picker + subject/chapter selection.
2. direct-pdf.js — stores uploaded PDFs in PostgreSQL BYTEA and serves protected PDFs.
3. package.json — start command preloads direct-pdf.js.

IMPORTANT FIX
Android/Chrome may report a selected PDF as application/octet-stream. The browser and server now validate the actual PDF header (%PDF) instead of rejecting a genuine PDF because of its MIME metadata.

DEPLOY
1. Replace your GitHub admin.html with this package's admin.html.
2. Add direct-pdf.js to the repository root.
3. In your EXISTING package.json, change ONLY the start script to:
   node -r ./direct-pdf.js server.js
   Keep all your existing dependencies and other scripts.
4. Commit/push and let Render redeploy.
5. Login to the normal admin dashboard. Choose Subject -> Chapter -> PDF -> Add Resource.

STORAGE
- New PDFs are stored directly in PostgreSQL.
- Maximum PDF size: 15 MB.
- Existing URL resources can continue working during migration.
- Download route remains login protected and records downloads.

No separate PDF upload page is required.
