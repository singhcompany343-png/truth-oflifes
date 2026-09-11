truth.oflifes — ALL-IN-ONE FINAL UPDATE

Replace these 4 files in GitHub:
1. index.html
2. server.js
3. admin.html
4. forgot-password.html

Then Commit changes and wait for Render to deploy.

Included:
- User forgot-password request flow
- User profile + email update
- User password change
- Download history + download tracking
- Admin download analytics + popular resources
- Existing admin visitors/users/resources/request/collaboration features
- All medical subjects in admin upload + filters
- Search, edit/delete, notifications, reset controls
- SEO/meta/mobile polish
- Existing visitor counter and login preserved

Checked/fixed before packaging:
- Admin subject filter is present and wired to its JavaScript.
- User download tracking no longer references an undefined variable.
- Visitor API supports both /api/visit and /api/visits.
- Admin user list returns email.
- Legacy /api/admin/login uses admins.password_hash correctly.
- server.js and all embedded HTML JavaScript pass syntax checks.
