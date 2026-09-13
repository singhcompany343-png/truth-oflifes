TRUTH.OFLIFES — DIRECT PDF PATCH

Files:
1. direct-pdf.js
2. admin-pdf-upload.html
3. package.json

What it does:
- Stores new PDFs directly in PostgreSQL (BYTEA).
- Keeps old URL-based resources working.
- Protects /api/resources/:id/download with login.
- Serves direct PDFs inline from your own website.
- Keeps resource download analytics.
- Admin upload page: /admin-pdf-upload.html
- Maximum PDF size: 15 MB.

Deployment:
Replace package.json, add direct-pdf.js and admin-pdf-upload.html, then redeploy.
First login at /admin.html, then open /admin-pdf-upload.html on the same domain.

NOTE:
This patch was prepared because the connected GitHub integration currently returns
403 Resource not accessible by integration when attempting to write to the repository.
No GitHub files were changed by this chat.
