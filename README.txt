truth.oflifes — Direct Resource File Upload

Supported direct uploads (maximum 15 MB):
- PDF
- PPT / PPTX
- DOC / DOCX
- XLS / XLSX

The server validates file signatures, so Android/Chrome generic MIME types do not cause false rejections.
Files are stored in PostgreSQL BYTEA. PDFs open inline; Office files download as attachments.
Existing URL resources remain supported.

Keep the existing server.js and other project files.
Render start command:
node -r ./direct-pdf.js server.js

Do not replace the existing database or remove existing resource data.
