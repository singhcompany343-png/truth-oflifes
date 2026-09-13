truth.oflifes — Direct PDF FINAL FIX

Replace ONLY:
  direct-pdf.js

Do NOT replace server.js.

Render Start Command:
  node -r ./direct-pdf.js server.js

This version is intentionally JSON/Base64 only because the current admin.html
sends:
  { title, type, subject, chapter, description, file_name, file_data }

It raises the JSON limit to 22 MB, decodes the PDF, checks the %PDF signature,
stores it in PostgreSQL BYTEA, and serves it inline.

Maximum PDF size: 15 MB.
