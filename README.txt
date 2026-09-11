truth.oflifes — FINAL COMPLETE PACKAGE

Replace these files in the GitHub main branch:
1. index.html
2. server.js
3. admin.html
4. forgot-password.html

Features included:
- User + Admin login
- User registration with recovery email
- User Forgot Password request
- Admin password-reset request list and user password reset
- User profile, email update and change password
- Notes/PPT resources with download tracking
- Admin resource add/edit/delete
- User search
- Subject/type filters
- Resource and collaboration request approval/rejection
- Notifications
- Visitor counter and 30-day activity chart
- Download analytics/popular resources
- Legacy database migration compatibility
- /api/visit and /api/visits compatibility

Forgot-password flow:
User submits Instagram username + registered email.
The request appears in Admin > Password Reset Requests.
Admin can reset the user's password from the Users list.
No external email service is required for this flow.

Validation:
server.js and all inline JavaScript blocks passed Node syntax checks.
