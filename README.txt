TRUTH.OFLIFES - Direct Resource Upload FINAL v4

Fixes:
- Android/Chrome PDF upload parsing fixed.
- Accepts normal Data URLs, URL-encoded payloads and raw base64.
- Removes harmless payload characters before base64 decoding.
- Validates actual file signature, not browser MIME type.
- PDF, PPT, PPTX, DOC, DOCX, XLS, XLSX supported.
- Maximum file size 15 MB.
- Direct PostgreSQL BYTEA storage.
- Existing URL resources remain supported.

Deploy both admin.html and direct-pdf.js.
Start command:
node -r ./direct-pdf.js server.js

Do not replace server.js with this package.
