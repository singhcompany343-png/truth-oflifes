# truth.oflifes — Final Medical Learning Build

## Included
- Professional dark medical homepage matching the approved preview direction.
- 22 subjects / 472 chapters.
- 50 unique MCQs per chapter from `mcq-bank.json` (23,600 questions total).
- Random 20-question and full 50-question tests.
- 12-minute timer for 20-question tests and 30-minute timer for 50-question tests.
- Instant correct/incorrect answer feedback and explanations.
- Attempt history and wrong-question revision.
- Student progress dashboard: subject progress, chapter completion, scores, continue learning and weak chapters.
- 50-question certificate eligibility at 40/50 (80%); certificate includes student name, subject, chapter and score when applicable.
- Certificate history and PDF download.
- Notes/PPT open without login; download requires login.
- Chapter layout: Notes & PPT → Videos → Extra Topics → MCQ.
- Homepage has no standalone Study Videos section; videos are linked to chapters and the Video Library.
- Other → Extra Topics displays the 10 starter video topics.
- Global search for resources and chapter/MCQ learning areas.
- Admin MCQ audit: subject/chapter counts and exact duplicate checker.
- Admin resource, user, video/topic and request management.
- Automatic learning database migration and MCQ seeding on server startup.

## Deploy
Use the normal Render Node service. The package start command is:

`node server.js`

Admin seed command is available as `npm run seed-admin`. Set `DATABASE_URL`, `ADMIN_USERNAME` (optional; defaults to `admin`) and `ADMIN_PASSWORD` in Render. The command is safe to run repeatedly. The server also verifies the chapter bank and seeds missing questions on startup.
