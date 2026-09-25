# truth.oflifes — Secure Backend

This version replaces browser-only demo storage with PostgreSQL + JWT admin authentication.

## Setup
1. Create a PostgreSQL/Supabase database.
2. Run `schema.sql` in the SQL editor.
3. Copy `.env.example` to `.env` and fill in the database URL and secrets.
4. Run `npm install`.
5. Run `npm run seed-admin`.
6. Run `npm start`.

## API
- `POST /api/admin/login`
- `GET /api/resources`
- `POST /api/resources` (admin)
- `DELETE /api/resources/:id` (admin)
- `POST /api/requests`
- `POST /api/collaborations`
- `GET /api/requests` (admin)
- `GET /api/collaborations` (admin)

Telegram: https://t.me/+q3-9PiVKzbYyYWVl

Never commit `.env`. Use a strong admin password and JWT secret.


## Student learning module (additive update)

- New student portal: `/learning` (uses the existing student login token).
- New migration: `learning-migration.sql`. Back up the database first, then run this SQL against the existing PostgreSQL database. It creates new learning tables and seeds the 20-subject catalog; it does not drop or overwrite the existing users, resources, requests, or collaborations tables.
- The quiz API only unlocks a subject when 100 active question records have been curated and inserted for that subject. It does not fabricate medical MCQs or claim placeholder content is medically reviewed. Each presented question is timed server-side for 50 seconds; answer keys are not sent to the browser.
- The portal includes authenticated subject/notes/certificate views. Existing resource downloads continue to use the existing authenticated download endpoint.
- Admin endpoints added: `POST /api/admin/users` (create student) and `PATCH /api/admin/users/:id/status` (soft deactivate/reactivate; no hard deletion). Existing users and their learning records are retained.
- Certificate verification: `/api/learning/certificates/verify/:code`. Certificates are educational quiz-completion records, not professional licenses or accredited qualifications.

### Before production

1. Back up PostgreSQL and uploaded files.
2. Apply `learning-migration.sql` to the existing database.
3. Set a strong `JWT_SECRET` and `DATABASE_URL` in the hosting environment; do not use the fallback development secret in production.
4. Add and medically review 100 original questions per subject before unlocking each quiz.
5. Run smoke tests with a test account before announcing launch. No production database or live deployment is modified by generating this project archive.
