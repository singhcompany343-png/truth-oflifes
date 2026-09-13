TRUTH.OFLIFES — DIRECT RESOURCE UPLOAD FINAL v6

ROOT FIX: server.js uses express.json() before /api/resources. The previous raw-binary upload was being consumed by express.json(), so the resource parser received no file bytes. This version skips JSON parsing for non-JSON POST/PUT resource uploads and lets direct-pdf.js read the binary stream.

Supports PDF, PPT, PPTX, DOC, DOCX, XLS, XLSX up to 15 MB. Existing URL resources remain supported.

Replace only admin.html and direct-pdf.js. Do NOT replace server.js.
Render start command: node -r ./direct-pdf.js server.js
After deploy, hard refresh Chrome.
