truth.oflifes — Direct PDF FINAL FIX

Replace ONLY these two files in the repo:
1) admin.html
2) direct-pdf.js

Keep Render Start Command as: npm start
The existing npm start script should run:
node -r ./direct-pdf.js server.js

This version is for DIRECT PDF upload/storage only.
- PDF max 15 MB
- PostgreSQL BYTEA storage
- Login-protected opening/download
- Download tracking preserved
- Existing URL resources remain supported by the server fallback
- Mobile Chrome file reading validation improved
- Chapter fallback lists retained in admin.html
