truth.oflifes — Direct Resource Upload FINAL

Files included:
- admin.html — current admin UI with subject/chapter dropdown and resource upload
- direct-pdf.js — upload/storage/download layer for PDF, PPT/PPTX, DOC/DOCX, XLS/XLSX
- package.json

IMPORTANT
1. Replace the deployed admin HTML with admin.html.
2. Add direct-pdf.js beside server.js.
3. Keep the existing server.js; change only the Render Start Command to:
   node -r ./direct-pdf.js server.js
4. Redeploy and hard-refresh Chrome.

Upload handling is tolerant of Android/Chrome MIME differences and accepts both normal
data URLs and raw base64 payloads, then validates the actual file signature.
Maximum file size: 15 MB.
