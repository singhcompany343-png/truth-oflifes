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
