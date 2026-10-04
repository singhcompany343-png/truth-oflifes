const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");
const MCQ_BANK = require("./mcq-bank.json");

const app = express();

app.use(cors());
app.use(express.json({ limit: "40mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "truth-oflifes-secret";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// =========================
// DATABASE SETUP
// =========================

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      instagram_username TEXT UNIQUE NOT NULL,
      email TEXT,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT,
      chapter TEXT,
      description TEXT,
      file_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      name TEXT,
      instagram_username TEXT,
      type TEXT,
      subject TEXT,
      message TEXT,
      chapter TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS collaborations (
      id SERIAL PRIMARY KEY,
      name TEXT,
      instagram_username TEXT,
      email TEXT,
      source TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      visitor_key TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT,
      token_hash TEXT,
      expires_at TIMESTAMP,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS resource_downloads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
      downloaded_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Migrate older users tables safely.
  // Some older deployments used `username` and/or `password_hash`
  // instead of the current `instagram_username` and `password` columns.
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS instagram_username TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email TEXT;
  `);

  // If an older table has `username`, copy it into the new column.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'username'
      ) THEN
        UPDATE users
        SET instagram_username = username
        WHERE instagram_username IS NULL
          AND username IS NOT NULL;
      END IF;
    END $$;
  `);

  // Keep existing users' old password hashes usable.
  await pool.query(`
    UPDATE users
    SET password = password_hash
    WHERE password IS NULL
      AND password_hash IS NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL;
  `);

  // Allows old rows with NULL usernames while keeping new usernames unique.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_instagram_username_unique
    ON users(instagram_username)
    WHERE instagram_username IS NOT NULL;
  `);

  // Older databases may have resources tables without the chapter column.
  await pool.query(`ALTER TABLE resources ADD COLUMN IF NOT EXISTS chapter TEXT;`);

  // Final resource-type migration: older databases restricted resources to Notes/PPT only.
  // Replace that legacy constraint with the full set supported by the admin uploader.
  await pool.query(`ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_type_check;`);
  await pool.query(`
    ALTER TABLE resources
      ADD CONSTRAINT resources_type_check
      CHECK (type IN ('Notes','PPT','DOC','Image','Video','Question Paper','Study Material','Other'))
  `);
  await pool.query(`ALTER TABLE resources ADD COLUMN IF NOT EXISTS file_data TEXT;`);
  await pool.query(`ALTER TABLE resources ADD COLUMN IF NOT EXISTS file_name TEXT;`);
  await pool.query(`ALTER TABLE resources ADD COLUMN IF NOT EXISTS mime_type TEXT;`);

  // Direct PDF storage: allow legacy databases where file_url was NOT NULL.
  await pool.query(`
    ALTER TABLE resources
      ALTER COLUMN file_url DROP NOT NULL;
  `);

  // Older databases may have requests/collaborations tables without the
  // Instagram username columns. Add them safely for the admin dashboard.
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS name TEXT;
  `);
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS instagram_username TEXT;
  `);
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS type TEXT;
  `);
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS subject TEXT;
  `);
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS message TEXT;
  `);
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS chapter TEXT;
  `);
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
  `);
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  `);
  await pool.query(`
    ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  `);
  await pool.query(`
    ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS name TEXT;
  `);
  await pool.query(`
    ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS instagram_username TEXT;
  `);
  await pool.query(`
    ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS email TEXT;
  `);
  await pool.query(`
    ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS source TEXT;
  `);
  await pool.query(`
    ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS message TEXT;
  `);
  await pool.query(`
    ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
  `);
  // Normalize legacy request columns so optional form fields can be empty.
  // Older deployments may have stricter NOT NULL/default constraints.
  await pool.query(`
    ALTER TABLE requests
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN name DROP NOT NULL,
      ALTER COLUMN instagram_username DROP NOT NULL,
      ALTER COLUMN type DROP NOT NULL,
      ALTER COLUMN subject DROP NOT NULL,
      ALTER COLUMN chapter DROP NOT NULL,
      ALTER COLUMN message DROP NOT NULL,
      ALTER COLUMN status DROP NOT NULL;
  `);
  await pool.query(`
    ALTER TABLE requests
      ALTER COLUMN status SET DEFAULT 'pending',
      ALTER COLUMN created_at SET DEFAULT NOW();
  `);

  await pool.query(`UPDATE requests SET status='pending' WHERE status IS NULL;`);
  // Legacy collaboration tables can contain older NOT NULL columns.
  // Make existing form fields nullable so the current form can submit safely.
  await pool.query(`
    ALTER TABLE collaborations
      ALTER COLUMN name DROP NOT NULL,
      ALTER COLUMN instagram_username DROP NOT NULL,
      ALTER COLUMN email DROP NOT NULL,
      ALTER COLUMN contact DROP NOT NULL,
      ALTER COLUMN source DROP NOT NULL,
      ALTER COLUMN message DROP NOT NULL,
      ALTER COLUMN status DROP NOT NULL,
      ALTER COLUMN created_at DROP NOT NULL;
  `);

  await pool.query(`UPDATE collaborations SET status='pending' WHERE status IS NULL;`);


  // Learning platform tables are created automatically so Render deployments do not
  // require a separate manual SQL migration.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learning_subjects (
      id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT UNIQUE NOT NULL,
      sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS learning_questions (
      id BIGSERIAL PRIMARY KEY, subject_id INT NOT NULL REFERENCES learning_subjects(id) ON DELETE CASCADE,
      chapter TEXT NOT NULL DEFAULT 'General', question TEXT NOT NULL,
      options JSONB NOT NULL CHECK (jsonb_typeof(options)='array' AND jsonb_array_length(options)=4),
      correct_index SMALLINT NOT NULL CHECK(correct_index BETWEEN 0 AND 3),
      explanation TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'basic',
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(subject_id, chapter, question)
    );
    CREATE INDEX IF NOT EXISTS learning_questions_chapter_idx ON learning_questions(subject_id, chapter, active);
    CREATE TABLE IF NOT EXISTS learning_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INT NOT NULL REFERENCES learning_subjects(id) ON DELETE CASCADE,
      chapter TEXT, question_count INT NOT NULL DEFAULT 50, duration_seconds INT NOT NULL DEFAULT 1800,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ, score INT,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','abandoned'))
    );
    CREATE TABLE IF NOT EXISTS learning_attempt_items (
      id BIGSERIAL PRIMARY KEY, attempt_id UUID NOT NULL REFERENCES learning_attempts(id) ON DELETE CASCADE,
      question_id BIGINT NOT NULL REFERENCES learning_questions(id) ON DELETE CASCADE, position INT NOT NULL,
      presented_at TIMESTAMPTZ, answered_at TIMESTAMPTZ, selected_index SMALLINT CHECK(selected_index BETWEEN 0 AND 3),
      is_correct BOOLEAN, UNIQUE(attempt_id, position), UNIQUE(attempt_id, question_id)
    );
    CREATE TABLE IF NOT EXISTS learning_certificates (
      id BIGSERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INT REFERENCES learning_subjects(id) ON DELETE SET NULL, attempt_id UUID REFERENCES learning_attempts(id) ON DELETE SET NULL,
      chapter TEXT, certificate_code TEXT UNIQUE NOT NULL, score INT NOT NULL, max_score INT NOT NULL,
      percentage NUMERIC(5,2) NOT NULL, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      certificate_type TEXT NOT NULL DEFAULT 'subject' CHECK(certificate_type IN ('subject','chapter','all_subjects'))
    );
    CREATE TABLE IF NOT EXISTS learning_user_status (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      deactivated_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;`);
  await pool.query(`ALTER TABLE learning_attempts ADD COLUMN IF NOT EXISTS chapter TEXT;`);
  await pool.query(`ALTER TABLE learning_attempts ADD COLUMN IF NOT EXISTS duration_seconds INT NOT NULL DEFAULT 1800;`);
  await pool.query(`ALTER TABLE learning_certificates ADD COLUMN IF NOT EXISTS chapter TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS learning_subjects_name_unique ON learning_subjects(name);`);
  let questionUniqueIndexReady=true;
  try{await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS learning_questions_subject_chapter_question_unique ON learning_questions(subject_id,chapter,question);`);}catch(e){questionUniqueIndexReady=false;console.warn('MCQ unique index could not be created; using duplicate-safe seed filtering.',e.message);}
  await pool.query(`DO $$ DECLARE r record; BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='learning_certificates' AND column_name='certificate_type') THEN FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='learning_certificates'::regclass AND pg_get_constraintdef(oid) ILIKE '%certificate_type%' LOOP EXECUTE format('ALTER TABLE learning_certificates DROP CONSTRAINT %I',r.conname); END LOOP; END IF; END $$;`);
  await pool.query(`ALTER TABLE learning_certificates ADD CONSTRAINT learning_certificates_certificate_type_check CHECK(certificate_type IN ('subject','chapter','all_subjects'));`).catch(()=>{});
  await pool.query(`INSERT INTO learning_subjects(slug,name,sort_order) VALUES ${Object.keys(CHAPTER_MAP).map((_,i)=>`($${i*2+1},$${i*2+2},${i+1})`).join(',')} ON CONFLICT(name) DO UPDATE SET slug=EXCLUDED.slug,sort_order=EXCLUDED.sort_order`, Object.keys(CHAPTER_MAP).flatMap(n=>[n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),n]));
  await pool.query(`UPDATE learning_subjects SET active=false WHERE name <> ALL($1::text[])`, [Object.keys(CHAPTER_MAP)]);
  await pool.query(`UPDATE learning_subjects SET active=true WHERE name = ANY($1::text[])`, [Object.keys(CHAPTER_MAP)]);
  await pool.query(`INSERT INTO learning_user_status(user_id,is_active) SELECT id,true FROM users ON CONFLICT(user_id) DO NOTHING;`);
  const qCount = await pool.query(`SELECT COUNT(*)::int AS n FROM learning_questions`);
  const bank = Array.isArray(MCQ_BANK.questions) ? MCQ_BANK.questions : [];
  const bankChapters = new Set(bank.map(q=>q.subject+'|'+q.chapter)).size;
  const qCoverage = await pool.query(`SELECT COUNT(*)::int n FROM (SELECT subject_id,chapter FROM learning_questions WHERE active=true GROUP BY subject_id,chapter HAVING COUNT(*)>=50) x`);
  if (qCount.rows[0].n < bank.length || qCoverage.rows[0].n < bankChapters) {
    const subjects = await pool.query(`SELECT id,name FROM learning_subjects`);
    const ids = Object.fromEntries(subjects.rows.map(r=>[r.name,r.id]));
    for(let start=0; start<bank.length; start+=500){
      const batch=bank.slice(start,start+500), vals=[], args=[];
      batch.forEach(q=>{
        const sid=ids[q.subject]; if(!sid) return;
        const base=args.length; args.push(sid,q.chapter,q.question,JSON.stringify(q.options),q.correct_index,q.explanation||'Review the chapter concepts and the correct option.');
        vals.push(`($${base+1},$${base+2},$${base+3},$${base+4}::jsonb,$${base+5},$${base+6},'basic',true)`);
      });
      if(vals.length){
        if(questionUniqueIndexReady) await pool.query(`INSERT INTO learning_questions(subject_id,chapter,question,options,correct_index,explanation,difficulty,active) VALUES ${vals.join(',')} ON CONFLICT(subject_id,chapter,question) DO NOTHING`,args);
        else {
          const existing=await pool.query(`SELECT subject_id,chapter,question FROM learning_questions WHERE active=true`);
          const seen=new Set(existing.rows.map(x=>x.subject_id+'|'+x.chapter+'|'+x.question));
          const keep=[]; for(let i=0;i<batch.length;i++){const q=batch[i],sid=ids[q.subject],key=sid+'|'+q.chapter+'|'+q.question;if(sid&&!seen.has(key)){keep.push(q);seen.add(key);}}
          if(keep.length){const av=[],aa=[];keep.forEach(q=>{const sid=ids[q.subject],base=aa.length;aa.push(sid,q.chapter,q.question,JSON.stringify(q.options),q.correct_index,q.explanation||'Review the chapter concepts and the correct option.');av.push(`($${base+1},$${base+2},$${base+3},$${base+4}::jsonb,$${base+5},$${base+6},'basic',true)`);});await pool.query(`INSERT INTO learning_questions(subject_id,chapter,question,options,correct_index,explanation,difficulty,active) VALUES ${av.join(',')}`,aa);}
        }
      }
    }
    console.log(`Seeded learning MCQs: ${bank.length}`);
  }

  console.log("Database ready");
}

// =========================
// AUTH MIDDLEWARE
// =========================

function maybeAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) { req.user = null; return next(); }
  try { req.user = jwt.verify(header.substring(7), JWT_SECRET); } catch (error) { req.user = null; }
  next();
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Login required" });
  }

  const token = header.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired login" });
  }
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Admin login required" });
  }

  const token = header.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired login" });
  }
}

// =========================
// PAGES
// =========================

app.get("/hero-medical-visual.jpg", (req,res)=>res.sendFile(path.join(__dirname,"hero-medical-visual.jpg")));

app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.sendFile(path.join(__dirname, "index.html"));
});

// Static educational pages — serve the actual page instead of redirecting to home.
// This fixes the brief blank/return-to-home behavior seen on mobile when opening
// Quiz, Learning, Student, Videos and policy pages.
const pageRoutes = {
  "/learning": "learning.html",
  "/learning.html": "learning.html",
  "/quiz": "quiz.html",
  "/quiz.html": "quiz.html",
  "/student": "student.html",
  "/student.html": "student.html",
  "/reels": "reels.html",
  "/reels.html": "reels.html",
  "/about.html": "about.html",
  "/privacy.html": "privacy.html",
  "/terms.html": "terms.html",
  "/disclaimer.html": "disclaimer.html",
  "/forgot-password.html": "forgot-password.html",
  "/admin.html": "admin.html"
};
Object.entries(pageRoutes).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.sendFile(path.join(__dirname, file));
  });
});

// =========================
// HEALTH
// =========================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "truth.oflifes server running"
  });
});

// =========================
// USER REGISTER
// =========================

app.post("/api/auth/register", async (req, res) => {
  try {
    const instagram_username =
      String(req.body.instagram_username || "").trim();

    const password = String(req.body.password || "");
    const email = String(req.body.email || "").trim().toLowerCase();
    const display_name = String(req.body.display_name || "").trim();

    if (!instagram_username || !password) {
      return res.status(400).json({
        error: "Instagram username and password are required"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters"
      });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(instagram_username)=LOWER($1)`,
      [instagram_username]
    );

    if (existing.rows.length) {
      return res.status(409).json({
        error: "Account already exists"
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (instagram_username, email, password, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, instagram_username, email, display_name, created_at`,
      [instagram_username, email || null, hash, display_name || null]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      {
        id: user.id,
        username: user.instagram_username,
        role: "user"
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      role: "user",
      user
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not create account"
    });
  }
});

// =========================
// USER + ADMIN LOGIN
// =========================

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(
      req.body.instagram_username ||
      req.body.username ||
      ""
    ).trim();

    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        error: "Username and password are required"
      });
    }

    // ADMIN LOGIN
    const adminResult = await pool.query(
      `SELECT id, username, password_hash
       FROM admins
       WHERE LOWER(username)=LOWER($1)
       LIMIT 1`,
      [username]
    );

    if (adminResult.rows.length) {
      const admin = adminResult.rows[0];

      const valid = await bcrypt.compare(
        password,
        admin.password_hash
      );

      if (valid) {
        const token = jwt.sign(
          {
            id: admin.id,
            username: admin.username,
            role: "admin"
          },
          JWT_SECRET,
          { expiresIn: "30d" }
        );

        return res.json({
          success: true,
          token,
          role: "admin",
          user: {
            id: admin.id,
            username: admin.username
          }
        });
      }
    }

    // NORMAL USER LOGIN
    const userResult = await pool.query(
      `SELECT id, instagram_username, email, password, created_at
       FROM users
       WHERE LOWER(instagram_username)=LOWER($1)
       LIMIT 1`,
      [username]
    );

    if (!userResult.rows.length) {
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    const user = userResult.rows[0];

    const valid = await bcrypt.compare(
      password,
      user.password
    );

    if (!valid) {
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.instagram_username,
        role: "user"
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      role: "user",
      user: {
        id: user.id,
        instagram_username: user.instagram_username,
        email: user.email,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Login failed"
    });
  }
});

// =========================
// USER PROFILE + SECURITY
// =========================

app.get("/api/me", auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, instagram_username, email, display_name, created_at FROM users WHERE id=$1 LIMIT 1`, [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });
    res.json({ user: result.rows[0] });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not load profile" }); }
});

app.patch("/api/me", auth, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const display_name = String(req.body.display_name || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
    const result = await pool.query(`UPDATE users SET email=$1, display_name=$2 WHERE id=$3 RETURNING id, instagram_username, email, display_name, created_at`, [email || null, display_name || null, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not update profile" }); }
});

app.post("/api/me/change-password", auth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
    const result = await pool.query(`SELECT password FROM users WHERE id=$1 LIMIT 1`, [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });
    if (!await bcrypt.compare(currentPassword, result.rows[0].password)) return res.status(401).json({ error: "Current password is incorrect" });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE users SET password=$1 WHERE id=$2`, [hash, req.user.id]);
    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not change password" }); }
});

app.get("/api/me/downloads", auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT d.id, d.downloaded_at, r.id AS resource_id, r.title, r.type, r.subject FROM resource_downloads d JOIN resources r ON r.id=d.resource_id WHERE d.user_id=$1 ORDER BY d.downloaded_at DESC LIMIT 50`, [req.user.id]);
    res.json({ downloads: result.rows });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not load download history" }); }
});

// =========================
// PASSWORD RECOVERY
// =========================

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const username = String(req.body.username || req.body.instagram_username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();

    // Always return the same public response to avoid account enumeration.
    const generic = {
      success: true,
      message: "If the account details match, a reset request has been recorded. Please contact the admin to complete the password reset."
    };

    if (!username || !email) return res.json(generic);

    const result = await pool.query(
      `SELECT id FROM users
       WHERE LOWER(instagram_username)=LOWER($1)
       AND email IS NOT NULL
       AND LOWER(email)=LOWER($2)
       LIMIT 1`,
      [username, email]
    );

    if (result.rows.length) {
      await pool.query(
        `INSERT INTO password_reset_requests (username, email, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [username, email]
      );
    }

    return res.json(generic);
  } catch (error) {
    console.error(error);
    return res.json({
      success: true,
      message: "If the account details match, a reset request has been recorded. Please contact the admin to complete the password reset."
    });
  }
});

app.post("/api/admin/change-password", adminAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });

    const result = await pool.query(`SELECT password_hash FROM admins WHERE id=$1 LIMIT 1`, [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Admin not found" });
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE admins SET password_hash=$1 WHERE id=$2`, [hash, req.user.id]);
    res.json({ success: true, message: "Admin password changed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not change admin password" });
  }
});

app.get("/api/admin/password-reset-requests", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, email, expires_at, used_at, created_at
      FROM password_reset_requests
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json({ requests: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load password reset requests" });
  }
});

app.post("/api/admin/users/:id/reset-password", adminAuth, async (req, res) => {
  try {
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(`UPDATE users SET password=$1 WHERE id=$2 RETURNING id, instagram_username`, [hash, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });
    await pool.query(`UPDATE password_reset_requests SET used_at=NOW() WHERE LOWER(username)=LOWER($1) AND used_at IS NULL`, [result.rows[0].instagram_username]);
    res.json({ success: true, message: "User password reset successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not reset user password" });
  }
});

app.delete("/api/admin/users/:id", adminAuth, async (req, res) => {
  const adminPassword = String(req.body.adminPassword || "");
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({error:"Invalid user id"});
  if (!adminPassword) return res.status(400).json({error:"Admin password is required"});
  const client = await pool.connect();
  try {
    const admin = await client.query(`SELECT password_hash FROM admins WHERE id=$1 LIMIT 1`, [req.user.id]);
    if (!admin.rowCount) return res.status(404).json({error:"Admin account not found"});
    const valid = await bcrypt.compare(adminPassword, admin.rows[0].password_hash);
    if (!valid) return res.status(401).json({error:"Incorrect admin password"});

    const exists = async (name) => {
      const r = await client.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [name]);
      return !!r.rows[0]?.exists;
    };

    await client.query('BEGIN');
    // Some older Render databases do not have the learning migration yet.
    // Skip missing tables so user deletion still works instead of rolling back.
    if (await exists('learning_attempt_items')) {
      await client.query(`DELETE FROM learning_attempt_items WHERE attempt_id IN (SELECT id FROM learning_attempts WHERE user_id=$1)`, [userId]);
    }
    if (await exists('learning_certificates')) await client.query(`DELETE FROM learning_certificates WHERE user_id=$1`, [userId]);
    if (await exists('learning_attempts')) await client.query(`DELETE FROM learning_attempts WHERE user_id=$1`, [userId]);
    if (await exists('learning_user_status')) await client.query(`DELETE FROM learning_user_status WHERE user_id=$1`, [userId]);
    if (await exists('resource_downloads')) await client.query(`DELETE FROM resource_downloads WHERE user_id=$1`, [userId]);
    if (await exists('password_reset_requests')) {
      await client.query(`DELETE FROM password_reset_requests WHERE LOWER(username) = LOWER((SELECT instagram_username FROM users WHERE id=$1))`, [userId]);
    }
    const result = await client.query(`DELETE FROM users WHERE id=$1 RETURNING id, instagram_username`, [userId]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({error:"User not found"});
    }
    await client.query('COMMIT');
    res.json({success:true, deleted:result.rows[0]});
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error("Admin user deletion failed", error);
    res.status(500).json({error:"Could not delete user", details:String(error.message || "database error")});
  } finally {
    client.release();
  }
});

// Lightweight notification count for the admin header.
app.get("/api/admin/notifications", adminAuth, async (req, res) => {
  try {
    const [r, c, p] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE status='pending'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM collaborations WHERE status='pending'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM password_reset_requests WHERE used_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`)
    ]);
    res.json({
      count: Number(r.rows[0].count) + Number(c.rows[0].count) + Number(p.rows[0].count),
      requests: Number(r.rows[0].count),
      collaborations: Number(c.rows[0].count),
      passwordResets: Number(p.rows[0].count)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load notifications" });
  }
});

// =========================
// OLD ADMIN LOGIN SUPPORT
// =========================

app.post("/api/admin/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const result = await pool.query(
      `SELECT id, username, password_hash
       FROM admins
       WHERE LOWER(username)=LOWER($1)
       LIMIT 1`,
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Invalid admin credentials"
      });
    }

    const admin = result.rows[0];

    const valid = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Invalid admin credentials"
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        role: "admin"
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      role: "admin"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Admin login failed"
    });
  }
});

// =========================
// RESOURCES - PUBLIC LIST
// =========================

// Public video preview endpoint. Only resources explicitly marked as Video are exposed here,
// so uploaded educational videos can be watched directly from the homepage without login.
app.get("/api/resources/:id/video", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT type, file_url, file_data, file_name, mime_type, title
      FROM resources WHERE id = $1
    `, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Video not found" });
    const row = result.rows[0];
    if (String(row.type || "").toLowerCase() !== "video") {
      return res.status(404).json({ error: "This resource is not a video" });
    }

    // External video URL: redirect so YouTube/CDN links continue to work.
    if (row.file_url && /^https?:\/\//i.test(row.file_url)) {
      return res.redirect(row.file_url);
    }

    if (!row.file_data) return res.status(404).json({ error: "Video file is not available" });
    const data = String(row.file_data);
    const comma = data.indexOf(",");
    const payload = comma >= 0 ? data.slice(comma + 1) : data;
    const mime = row.mime_type || (comma >= 0 && data.slice(0, comma).match(/^data:([^;]+)/i)?.[1]) || "video/mp4";
    const buffer = Buffer.from(payload, "base64");
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `inline; filename="${String(row.file_name || row.title || "video").replace(/[^a-zA-Z0-9._-]+/g, "_")}"`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.end(buffer);
  } catch (error) {
    console.error("Video preview error", error);
    return res.status(500).json({ error: "Could not load video" });
  }
});

app.get("/api/resources", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        type,
        subject,
        chapter,
        description,
        created_at
      FROM resources
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not load resources"
    });
  }
});

app.get('/api/search',async(req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase(); if(!q) return res.json({resources:[],chapters:[]});
  try{
    const r=await pool.query(`SELECT id,title,type,subject,chapter,description FROM resources WHERE LOWER(title||' '||COALESCE(subject,'')||' '||COALESCE(chapter,'')||' '||COALESCE(description,'')) LIKE $1 ORDER BY created_at DESC LIMIT 40`,['%'+q+'%']);
    const chapters=[]; for(const [subject,arr] of Object.entries(CHAPTER_MAP)){ for(const chapter of arr){ if((subject+' '+chapter).toLowerCase().includes(q)) chapters.push({subject,chapter}); if(chapters.length>=40) break; } if(chapters.length>=40) break; }
    res.json({resources:r.rows,chapters});
  }catch(e){res.status(500).json({error:'Search unavailable.'});}
});

// Admin-only resource list includes the private file_url needed for editing.
app.get("/api/admin/resources", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, type, subject, chapter, description, file_url, created_at
      FROM resources
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load admin resources" });
  }
});


// =========================
// CHAPTER MAP
// =========================

const VIDEO_STARTER_TOPICS = [
  {title:'Hand hygiene: five moments',subject:'Nursing',chapter:'Infection Control'},
  {title:'Understanding vital signs',subject:'Nursing',chapter:'Health Assessment'},
  {title:'How the heart pumps blood',subject:'Physiology',chapter:'Cardiovascular System'},
  {title:'Respiratory system basics',subject:'Physiology',chapter:'Respiratory System'},
  {title:'IV cannula: sizes and purpose',subject:'Nursing',chapter:'Nursing Procedures'},
  {title:'Recognizing dehydration',subject:'Pediatrics',chapter:'Nutrition'},
  {title:'Safe medicine habits',subject:'Pharmacology',chapter:'General Pharmacology'},
  {title:'First-aid basics: when to seek help',subject:'Other',chapter:'First Aid'},
  {title:'Kidney function explained',subject:'Anatomy',chapter:'Urinary System'},
  {title:'Common medical instruments',subject:'Nursing',chapter:'Medical Instruments'}
];

const CHAPTER_MAP = {
    "Anatomy": ["General Anatomy","Osteology","Arthrology (Joints)","Myology (Muscles)","Cardiovascular System","Respiratory System","Digestive System","Urinary System","Reproductive System","Endocrine System","Nervous System","Head & Neck","Thorax","Abdomen","Pelvis & Perineum","Upper Limb","Lower Limb","Neuroanatomy","Cranial Nerves","Autonomic Nervous System","Histology","Embryology","Genetics","Radiological Anatomy"],
    "Physiology": ["General Physiology","Blood","Nerve & Muscle Physiology","Cardiovascular System","Respiratory System","Gastrointestinal System","Renal Physiology","Endocrinology","Reproductive Physiology","Central Nervous System","Special Senses","Temperature Regulation","Exercise Physiology","Environmental Physiology","Acid-Base Balance"],
    "Biochemistry": ["Biomolecules","Carbohydrates","Lipids","Proteins","Amino Acids","Enzymes","Vitamins","Minerals","Nucleic Acids","DNA & RNA","Molecular Biology","Carbohydrate Metabolism","Lipid Metabolism","Protein Metabolism","Heme Metabolism","Purine & Pyrimidine Metabolism","Biological Oxidation","Nutrition","Clinical Biochemistry","Acid-Base Balance","Liver Function Tests","Renal Function Tests"],
    "Pharmacology": ["General Pharmacology","Pharmacokinetics","Pharmacodynamics","Autonomic Nervous System","Cholinergic Drugs","Adrenergic Drugs","Cardiovascular Drugs","Diuretics","Blood & Blood-forming Drugs","CNS Pharmacology","Antiepileptic Drugs","Antipsychotic Drugs","Antidepressants","Analgesics","Anti-inflammatory Drugs","Respiratory Drugs","GI Drugs","Endocrine Pharmacology","Antimicrobial Drugs","Antitubercular Drugs","Antileprotic Drugs","Antimalarial Drugs","Anticancer Drugs","Immunopharmacology","Toxicology"],
    "Pathology": ["Introduction to Pathology","Cell Injury","Cell Death","Inflammation","Healing & Repair","Hemodynamic Disorders","Edema","Thrombosis","Embolism","Shock","Genetic Disorders","Immune Disorders","Neoplasia","Blood Disorders","RBC Disorders","WBC Disorders","Platelet Disorders","Leukemia","Lymphoma","Cardiovascular Pathology","Respiratory Pathology","GI Pathology","Liver Pathology","Renal Pathology","Endocrine Pathology","CNS Pathology","Female Genital Tract Pathology","Breast Pathology"],
    "Microbiology": ["General Microbiology","Immunology","Bacteriology","Virology","Mycology","Parasitology","Sterilization & Disinfection","Biomedical Waste","Staphylococcus","Streptococcus","Mycobacteria","Enterobacteriaceae","Vibrio","Salmonella","Shigella","E. coli","TB","Diphtheria","Tetanus","Meningitis","Hepatitis Viruses","HIV/AIDS","Influenza","Rabies","Malaria","Amoebiasis","Giardiasis","Fungal Infections"],
    "Forensic Medicine": ["Introduction to Forensic Medicine","Medical Jurisprudence","Identification","Death & its Changes","Postmortem Examination","Mechanical Injuries","Blunt Force Injury","Sharp Force Injury","Firearm Injuries","Burns","Asphyxial Deaths","Hanging","Strangulation","Drowning","Sexual Offences","Infanticide","Medicolegal Autopsy","Toxicology","Poisoning","Alcohol Poisoning","Snake Bite","Organophosphorus Poisoning","Medical Ethics","Consent","Medical Negligence"],
    "Community Medicine": ["Concept of Health & Disease","Epidemiology","Screening","Biostatistics","Demography","Health Education","Nutrition","Communicable Diseases","Tuberculosis","Malaria","HIV/AIDS","Leprosy","Non-Communicable Diseases","Diabetes","Hypertension","Cancer","Maternal & Child Health","Family Planning","Immunization","National Health Programs","Environmental Health","Occupational Health","School Health","Geriatric Health","Disaster Management"],
    "Medicine": ["Clinical Methods","Cardiovascular Diseases","Respiratory Diseases","Gastrointestinal Diseases","Liver Diseases","Renal Diseases","Neurology","Endocrinology","Diabetes Mellitus","Thyroid Disorders","Rheumatology","Hematology","Infectious Diseases","Fever","HIV/AIDS","Electrolyte Disorders","Acid-Base Disorders","Emergency Medicine","Poisoning","Geriatric Medicine"],
    "Surgery": ["General Principles of Surgery","Wound Healing","Surgical Infections","Shock","Fluid & Electrolyte Management","Burns","Trauma","Head Injury","Neck Swellings","Breast Diseases","Thyroid","Esophagus","Stomach","Small Intestine","Large Intestine","Appendix","Rectum & Anal Canal","Liver","Gallbladder","Pancreas","Hernia","Vascular Surgery","Urology","Neurosurgery","Pediatric Surgery","Plastic Surgery"],
    "Pediatrics": ["Growth & Development","Neonatology","Newborn Resuscitation","Nutrition","Breastfeeding","Immunization","Pediatric Infections","Respiratory Diseases","GI Diseases","CNS Diseases","Pediatric Cardiology","Congenital Heart Disease","Renal Diseases","Endocrine Disorders","Pediatric Hematology","Pediatric Emergencies","Genetic Disorders","Adolescent Health"],
    "OBG": ["Obstetrics","Normal Pregnancy","Antenatal Care","Normal Labour","Abnormal Labour","Puerperium","High-Risk Pregnancy","Hypertensive Disorders","Gestational Diabetes","Antepartum Hemorrhage","Postpartum Hemorrhage","Ectopic Pregnancy","Abortion","Multiple Pregnancy","Rh Isoimmunization","Fetal Distress","Operative Obstetrics","Cesarean Section","Gynaecology","Menstrual Disorders","Infertility","PCOS","Endometriosis","Uterine Fibroids","Pelvic Inflammatory Disease","Cervical Cancer","Endometrial Cancer","Ovarian Tumors","Breast Diseases","Menopause","Contraception"],
    "Orthopedics": ["General Orthopedics","Fractures","Dislocations","Bone Healing","Soft Tissue Injuries","Upper Limb Injuries","Lower Limb Injuries","Spine","Arthritis","Osteoarthritis","Rheumatoid Arthritis","Osteomyelitis","Bone Tumors","Congenital Disorders","Pediatric Orthopedics","Joint Replacement","Sports Injuries","Amputation","Orthopedic Emergencies"],
    "ENT": ["Ear Anatomy","Hearing Physiology","External Ear","Middle Ear","Inner Ear","Otitis Media","Hearing Loss","Vertigo","Facial Nerve","Nose & Paranasal Sinuses","Rhinitis","Sinusitis","Epistaxis","Nasal Polyps","Throat","Tonsils","Adenoids","Larynx","Voice Disorders","Head & Neck Tumors","Foreign Bodies"],
    "Ophthalmology": ["Anatomy of Eye","Physiology of Vision","Refractive Errors","Cataract","Glaucoma","Conjunctivitis","Corneal Diseases","Uveitis","Retinal Diseases","Diabetic Retinopathy","Hypertensive Retinopathy","Optic Nerve Disorders","Squint","Amblyopia","Eye Trauma","Ocular Emergencies","Orbit","Lacrimal System","Eyelid Disorders"],
    "Radiology": ["X-Ray Basics","Chest X-Ray","Abdominal X-Ray","Skeletal X-Ray","Ultrasound","CT Scan","MRI","Contrast Media","Neuroimaging","Chest Imaging","Abdominal Imaging","Musculoskeletal Imaging","Obstetric Imaging","Breast Imaging","Interventional Radiology","Radiation Safety"],
    "Anesthesia": ["Introduction to Anesthesia","Preoperative Assessment","General Anesthesia","Regional Anesthesia","Spinal Anesthesia","Epidural Anesthesia","Local Anesthesia","Airway Management","Endotracheal Intubation","Ventilation","Monitoring","Fluid Management","Blood Transfusion","Pain Management","CPR","Resuscitation","ICU Basics","Anesthetic Complications"],
    "Psychiatry": ["Introduction to Psychiatry","Mental Status Examination","Anxiety Disorders","Depression","Bipolar Disorder","Schizophrenia","Psychosis","OCD","PTSD","Personality Disorders","Substance Abuse","Alcohol Dependence","Drug Dependence","Child Psychiatry","Eating Disorders","Sleep Disorders","Suicide & Self-Harm","Psychopharmacology"],
    "Dermatology": ["Basic Dermatology","Skin Anatomy","Skin Examination","Bacterial Infections","Viral Infections","Fungal Infections","Scabies","Eczema","Psoriasis","Acne","Urticaria","Drug Reactions","Autoimmune Skin Diseases","Pigmentary Disorders","Hair Disorders","Nail Disorders","Sexually Transmitted Infections","Leprosy","Skin Tumors"],
    "Dentistry": ["Dental Anatomy","Oral Cavity","Dental Caries","Gingivitis","Periodontitis","Oral Infections","Oral Ulcers","Oral Cancers","Dental Trauma","Tooth Extraction","Endodontics","Prosthodontics","Orthodontics","Pediatric Dentistry","Oral & Maxillofacial Surgery","Dental Materials","Oral Hygiene"],
    "Nursing": ["Fundamentals of Nursing","Nursing Procedures","Health Assessment","Anatomy & Physiology","Nutrition","Pharmacology for Nurses","Medical-Surgical Nursing","Community Health Nursing","Child Health Nursing","Mental Health Nursing","Obstetric Nursing","Midwifery","Critical Care Nursing","Emergency Nursing","Infection Control","First Aid","Medical Instruments","Nursing Ethics","Nursing Research"],
    "Other": ["Extra Topics","First Aid","CPR/BLS","ECG","ABG","Medical Terminology","Clinical Examination","Differential Diagnosis","Medical Calculations","Important Drug Charts","Investigation & Lab Values","Medical Mnemonics","Case Studies","Viva Questions","Practical Notes","OSCE/OSPE","Previous Year Questions","NEET-PG/INI-CET Revision","Image-Based Questions"]
  };

app.get("/api/chapters", (req, res) => {
  res.json(CHAPTER_MAP);
});

app.get("/api/video-topics", (req, res) => {
  res.json({topics: VIDEO_STARTER_TOPICS});
});

// Public chapter-wise starter MCQs. The full subject test uses 50 questions per subject.
// Public chapter-wise basic MCQs. Every chapter gets a 5-question starter set,
// so each subject has a sizeable bank (roughly 50+ questions across its chapters).
// The questions are intentionally introductory; educators should review them before
// using them for formal assessment or clinical decision-making.
function makeChapterMcqs(subject, chapter) {
  const valid = Array.isArray(CHAPTER_MAP[subject]) && CHAPTER_MAP[subject].includes(chapter);
  if (!valid) return [];
  const rows = (Array.isArray(MCQ_BANK.questions)?MCQ_BANK.questions:[]).filter(q=>q.subject===subject && q.chapter===chapter).slice(0,50);
  return rows.map((q,i)=>({question:q.question,options:q.options,correct_index:q.correct_index,explanation:q.explanation||'Review the chapter material and the concept tested in this question.',difficulty:'basic',id:`${subject}-${chapter}-${i+1}`}));
}

app.get('/api/learning/chapter-mcqs', (req,res)=>{
  const subject=String(req.query.subject||'').trim();
  const chapter=String(req.query.chapter||'').trim();
  if(!subject||!chapter) return res.status(400).json({error:'Subject and chapter are required.'});
  const questions=makeChapterMcqs(subject,chapter);
  if(!questions.length) return res.status(404).json({error:'Chapter not found.'});
  res.json({subject,chapter,total:questions.length,questions});
});

// =========================
// PUBLIC RESOURCE OPEN (VIEW ONLY)
// =========================
// Notes require login to open. PPT remains viewable through this route;
// the separate /download endpoint remains authenticated for downloads.
app.get("/api/resources/:id/open", maybeAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT type, file_url, file_data, file_name, mime_type, title
       FROM resources WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({error:"Resource not found"});
    const row = result.rows[0];
    const type = String(row.type || "").toLowerCase();
    if (type === "notes" && !req.user) {
      return res.status(401).json({error:"Login required to open Notes"});
    }
    if (type === "video") return res.redirect(`/api/resources/${encodeURIComponent(req.params.id)}/video`);

    const fileUrl = String(row.file_url || "").trim();
    if (fileUrl && /^https?:\/\//i.test(fileUrl)) return res.redirect(fileUrl);

    const data = String(row.file_data || "").trim();
    if (!data) return res.status(404).json({error:"File is not available to open"});
    const comma = data.indexOf(",");
    const payload = comma >= 0 ? data.slice(comma + 1) : data;
    const detected = comma >= 0 ? data.slice(0, comma).match(/^data:([^;]+)/i)?.[1] : "";
    const mime = row.mime_type || detected || "application/octet-stream";
    const buffer = Buffer.from(payload, "base64");
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `inline; filename="${String(row.file_name || row.title || "resource").replace(/[^a-zA-Z0-9._-]+/g,"_")}"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.end(buffer);
  } catch (error) {
    console.error("Public resource open error", error);
    return res.status(500).json({error:"Could not open resource"});
  }
});

// =========================
// AUTHENTICATED RESOURCE DOWNLOAD
// =========================

app.get("/api/resources/:id/download", auth, async (req, res) => {
  if (req.user.role !== "user" && req.user.role !== "admin") {
    return res.status(403).json({ error: "Login required" });
  }
  try {
    // Never allow browsers/proxies to cache protected resource responses.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    const result = await pool.query(
      `SELECT file_url, file_data, file_name, mime_type, type, title FROM resources WHERE id = $1`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Resource not found"
      });
    }

    const row = result.rows[0];
    const fileUrl = String(row.file_url || "").trim();
    const fileData = String(row.file_data || "").trim();

    // Files uploaded from the admin panel are stored as data URLs in PostgreSQL.
    // Serve them directly so PDFs, PPTs, DOCs, images and videos all work.
    if (fileData) {
      let mime = row.mime_type || "application/octet-stream";
      let buffer;
      if (fileData.startsWith('data:')) {
        const comma = fileData.indexOf(',');
        const meta = fileData.slice(5, comma);
        const payload = fileData.slice(comma + 1);
        mime = String(row.mime_type || meta.split(';')[0] || mime);
        buffer = meta.includes(';base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
      } else {
        buffer = Buffer.from(fileData, 'base64');
      }
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.file_name || row.title || 'resource')}`);
      try { await pool.query(`INSERT INTO resource_downloads (user_id, resource_id) VALUES ($1, $2)`, [req.user.id, req.params.id]); } catch (trackError) { console.error('Download tracking failed:', trackError); }
      return res.send(buffer);
    }

    if (!fileUrl) {
      return res.status(404).json({ error: "File not available" });
    }

    // Normalize common cloud-storage share links into downloadable URLs.
    let downloadUrl = fileUrl;
    try {
      const parsed = new URL(fileUrl);
      const host = parsed.hostname.toLowerCase();

      if (host.includes("drive.google.com")) {
        const idFromPath = (parsed.pathname.match(/\/d\/([^/]+)/) || [])[1];
        const idFromQuery = parsed.searchParams.get("id");
        const driveId = idFromPath || idFromQuery;
        if (driveId) {
          downloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`;
        }
      } else if (host === "dropbox.com" || host.endsWith(".dropbox.com")) {
        parsed.searchParams.set("dl", "1");
        downloadUrl = parsed.toString();
      } else if (host === "github.com" && parsed.pathname.includes("/blob/")) {
        downloadUrl = parsed.toString().replace("github.com/", "raw.githubusercontent.com/").replace("/blob/", "/");
      }
    } catch (_) {
      // Keep the original URL; the clearer error below will be returned if it cannot be fetched.
    }

    const upstream = await fetch(downloadUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TruthOfLifes/1.0)"
      }
    });

    if (!upstream.ok) {
      return res.status(502).json({
        error: "Could not fetch resource file"
      });
    }

    const contentType =
      upstream.headers.get("content-type") ||
      "application/octet-stream";

    const contentLength =
      upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      "attachment"
    );

    if (contentLength) {
      res.setHeader(
        "Content-Length",
        contentLength
      );
    }

    const buffer = Buffer.from(
      await upstream.arrayBuffer()
    );

    // Count only successful downloads. Tracking failure must not break the file download.
    try {
      await pool.query(
        `INSERT INTO resource_downloads (user_id, resource_id) VALUES ($1, $2)`,
        [req.user.id, req.params.id]
      );
    } catch (trackError) {
      console.error("Download tracking failed:", trackError);
    }

    return res.send(buffer);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Could not open resource"
    });
  }
});

// =========================
// ADMIN ADD RESOURCE
// =========================

app.post("/api/resources", adminAuth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const type = String(req.body.type || "").trim();
    const subject = String(req.body.subject || "").trim();
    const chapter = String(req.body.chapter || "").trim();
    const description = String(req.body.description || "").trim();
    const file_url = String(req.body.file_url || req.body.fileUrl || "").trim();
    const file_data = String(req.body.file_data || "").trim();
    const file_name = String(req.body.file_name || "").trim();
    const mime_type = String(req.body.mime_type || "").trim();

    const allowedTypes = ['Notes','PPT','DOC','Image','Video','Question Paper','Study Material','Other'];
    if (!title || !type || !allowedTypes.includes(type)) return res.status(400).json({ error: "Please select a valid resource type." });
    if (!file_url && !file_data) return res.status(400).json({ error: "Please select a resource file or provide a resource URL." });
    if (file_data && file_data.length > 38 * 1024 * 1024) return res.status(413).json({ error: "Uploaded file is too large. Maximum is 25 MB." });

    const result = await pool.query(
      `INSERT INTO resources (title, type, subject, chapter, description, file_url, file_data, file_name, mime_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,title,type,subject,chapter,description,created_at`,
      [title,type,subject,chapter,description,file_url || null,file_data || null,file_name || null,mime_type || null]
    );
    res.json({ success: true, resource: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not add resource: " + (error.code === '23514' ? 'unsupported resource type' : error.message) });
  }
});

// =========================
// ADMIN EDIT RESOURCE
// =========================

app.put("/api/resources/:id", adminAuth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const type = String(req.body.type || "").trim();
    const subject = String(req.body.subject || "").trim();
    const chapter = String(req.body.chapter || "").trim();
    const description = String(req.body.description || "").trim();
    const file_url = String(req.body.file_url || req.body.fileUrl || "").trim();
    const file_data = String(req.body.file_data || "").trim();
    const file_name = String(req.body.file_name || "").trim();
    const mime_type = String(req.body.mime_type || "").trim();
    const allowedTypes = ['Notes','PPT','DOC','Image','Video','Question Paper','Study Material','Other'];
    if (!title || !type || !allowedTypes.includes(type)) return res.status(400).json({ error: "Please select a valid resource type." });

    const result = file_data || file_url
      ? await pool.query(`UPDATE resources SET title=$1,type=$2,subject=$3,chapter=$4,description=$5,file_url=$6,file_data=$7,file_name=$8,mime_type=$9 WHERE id=$10 RETURNING id,title,type,subject,chapter,description,created_at`, [title,type,subject,chapter,description,file_url || null,file_data || null,file_name || null,mime_type || null,req.params.id])
      : await pool.query(`UPDATE resources SET title=$1,type=$2,subject=$3,chapter=$4,description=$5 WHERE id=$6 RETURNING id,title,type,subject,chapter,description,created_at`, [title,type,subject,chapter,description,req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Resource not found" });
    res.json({ success: true, resource: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update resource" });
  }
});

// =========================
// ADMIN DELETE RESOURCE
// =========================

app.delete("/api/resources/:id", adminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Older databases may have the resource_downloads foreign key without
    // ON DELETE CASCADE. Remove those rows first so Delete works everywhere.
    const hasDownloads = await client.query(`SELECT to_regclass('resource_downloads') IS NOT NULL AS exists`);
    if (hasDownloads.rows[0]?.exists) {
      await client.query(`DELETE FROM resource_downloads WHERE resource_id=$1`, [req.params.id]);
    }
    const result = await client.query(`DELETE FROM resources WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({error:"Resource not found"});
    }
    await client.query('COMMIT');
    res.json({success:true});
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error("Admin resource deletion failed", error);
    res.status(500).json({error:"Could not delete resource", details:String(error.message || "database error")});
  } finally {
    client.release();
  }
});

// =========================
// REQUEST FORM
// =========================

async function submitRequest(req, res) {
  try {
    const body = req.body || {};

    const name = String(body.name || body.your_name || "").trim();
    const instagram_username = String(
      body.instagram_username ||
      body.instagramUsername ||
      body.instagram ||
      body.instagram_username_optional ||
      ""
    ).trim();

    const type = String(
      body.type ||
      body.request_type ||
      body.requestType ||
      ""
    ).trim();

    const subject = String(
      body.subject ||
      body.topic ||
      ""
    ).trim();

    const chapter = String(
      body.chapter ||
      body.chapter_name ||
      body.chapterName ||
      ""
    ).trim();

    const message = String(
      body.message ||
      body.details ||
      body.description ||
      body.need ||
      ""
    ).trim();

    if (!type || !subject || !chapter) {
      return res.status(400).json({
        success: false,
        error: "Subject, chapter and request type are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO requests
       (name, instagram_username, type, subject, chapter, message, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, name, instagram_username, type, subject, chapter, message, status, created_at`,
      [
        name || null,
        instagram_username || null,
        type,
        subject,
        chapter,
        message || null
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Request submitted successfully",
      request: result.rows[0]
    });
  } catch (error) {
    console.error("Request submission error:", error);
    return res.status(500).json({
      success: false,
      error: "Could not submit request. Please try again.",
      code: error && error.code ? error.code : undefined
    });
  }
}

// Support the current endpoint plus common frontend/older endpoint names.
app.post(
  ["/api/requests", "/api/request", "/api/requests/submit"],
  auth,
  submitRequest
);

// =========================
// COLLABORATION
// =========================

app.post("/api/collaborations", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const instagram_username = String(
      req.body.instagram_username || req.body.instagram || ""
    ).trim();
    const email = String(req.body.email || "").trim();
    const source = String(
      req.body.source || req.body.platform || req.body.how_found || ""
    ).trim();
    const message = String(req.body.message || "").trim();

    if (!name || !message) {
      return res.status(400).json({
        success: false,
        error: "Name and collaboration idea are required"
      });
    }

    // Build the INSERT from columns that actually exist in the deployed DB.
    // This keeps older production schemas compatible while preserving source
    // when the new column is available.
    const colResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='collaborations'
    `);
    const columns = new Set(colResult.rows.map(r => r.column_name));

    const fields = [];
    const values = [];
    const params = [];
    const add = (column, value) => {
      if (columns.has(column)) {
        fields.push(column);
        params.push(`$${params.length + 1}`);
        values.push(value === "" ? null : value);
      }
    };

    add("name", name);
    add("instagram_username", instagram_username);
    add("email", email);
    add("source", source);
    // Support older databases that used platform/how_found instead of source.
    if (!columns.has("source")) add("platform", source);
    if (!columns.has("source") && !columns.has("platform")) add("how_found", source);
    add("message", message);
    add("status", "pending");

    if (!fields.length) throw new Error("collaborations table has no usable columns");

    await pool.query(
      `INSERT INTO collaborations (${fields.join(", ")}) VALUES (${params.join(", ")})`,
      values
    );

    res.status(201).json({
      success: true,
      message: "Collaboration request submitted"
    });
  } catch (error) {
    console.error("Collaboration submission error:", error);
    res.status(500).json({
      success: false,
      error: "Could not submit collaboration. Please try again."
    });
  }
});

// =========================
// ADMIN RESOURCE REQUESTS
// =========================

app.get("/api/requests", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, instagram_username, type, subject, chapter, message, status, created_at
      FROM requests ORDER BY created_at DESC
    `);
    res.json({
      total: result.rows.length,
      pending: result.rows.filter(r => r.status === "pending").length,
      requests: result.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load requests" });
  }
});

app.patch("/api/requests/:id/status", adminAuth, async (req, res) => {
  try {
    const status = String(req.body.status || "").trim().toLowerCase();
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const result = await pool.query(
      `UPDATE requests SET status=$1 WHERE id=$2
       RETURNING id, name, instagram_username, type, subject, message, status, created_at`,
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Request not found" });
    res.json({ success: true, request: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update request" });
  }
});

app.delete("/api/requests/:id", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM requests WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Request not found" });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete request" });
  }
});

// =========================
// ADMIN COLLABORATION REQUESTS
// =========================

app.get("/api/collaborations", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, instagram_username, email, source, message, status, created_at
      FROM collaborations ORDER BY created_at DESC
    `);
    res.json({
      total: result.rows.length,
      pending: result.rows.filter(r => r.status === "pending").length,
      collaborations: result.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load collaborations" });
  }
});

app.patch("/api/collaborations/:id/status", adminAuth, async (req, res) => {
  try {
    const status = String(req.body.status || "").trim().toLowerCase();
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const result = await pool.query(
      `UPDATE collaborations SET status=$1 WHERE id=$2
       RETURNING id, name, instagram_username, email, source, message, status, created_at`,
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Collaboration not found" });
    res.json({ success: true, collaboration: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update collaboration" });
  }
});

app.delete("/api/collaborations/:id", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM collaborations WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Collaboration not found" });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete collaboration" });
  }
});

// =========================
// ADMIN ANALYTICS OVERVIEW
// =========================

app.get("/api/admin/analytics/overview", adminAuth, async (req, res) => {
  try {
    const [downloads, popular, recent] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM resource_downloads`),
      pool.query(`SELECT r.id, r.title, r.type, r.subject, COUNT(d.id)::int AS downloads FROM resources r LEFT JOIN resource_downloads d ON d.resource_id=r.id GROUP BY r.id ORDER BY downloads DESC, r.created_at DESC LIMIT 10`),
      pool.query(`SELECT COUNT(*)::int AS count FROM resource_downloads WHERE downloaded_at >= NOW() - INTERVAL '7 days'`)
    ]);
    res.json({ totalDownloads: Number(downloads.rows[0].count), last7Days: Number(recent.rows[0].count), popular: popular.rows });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not load analytics overview" }); }
});

// =========================
// VISITOR ANALYTICS
// =========================

app.get("/api/analytics/visits", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM visits
      WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `);
    res.json({ days: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load visitor analytics" });
  }
});

// =========================
// VISITOR COUNT
// =========================

app.post(["/api/visits", "/api/visit"], async (req, res) => {
  try {
    const visitor_key = String(
      req.body.visitor_key || ""
    ).trim();

    if (!visitor_key) {
      return res.status(400).json({
        error: "visitor_key required"
      });
    }

    await pool.query(
      `INSERT INTO visits (visitor_key)
       VALUES ($1)
       ON CONFLICT (visitor_key) DO NOTHING`,
      [visitor_key]
    );

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM visits`
    );

    res.json({
      count: result.rows[0].count
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Could not update visitor count"
    });
  }
});

// =========================
// ADMIN VISITOR COUNT
// =========================

app.get("/api/visits", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM visits`
    );

    res.json({
      count: result.rows[0].count
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Could not load visitor count"
    });
  }
});

// =========================
// ADMIN USERS
// =========================

app.get("/api/users", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        instagram_username,
        email,
        created_at
      FROM users
      ORDER BY created_at DESC
    `);

    res.json({
      total: result.rows.length,
      users: result.rows
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Could not load users"
    });
  }
});

// =========================
// LEARNING PLATFORM API
// =========================
async function requireActiveStudent(req,res,next){
  try{
    const row=await pool.query('SELECT is_active FROM learning_user_status WHERE user_id=$1',[req.user.id]);
    if(row.rows[0] && row.rows[0].is_active===false) return res.status(403).json({error:'Account is inactive. Contact the administrator.'});
    next();
  }catch(e){res.status(503).json({error:'Learning database is not ready.'});}
}

app.get('/api/learning/subjects',auth,requireActiveStudent,async(req,res)=>{
  try{
    const r=await pool.query(`SELECT s.id,s.slug,s.name,s.sort_order,
      (SELECT COUNT(*)::int FROM learning_questions q WHERE q.subject_id=s.id AND q.active=true) question_count,
      COALESCE((SELECT MAX(a.score) FROM learning_attempts a WHERE a.user_id=$1 AND a.subject_id=s.id AND a.status='completed'),0)::int best_score,
      COALESCE((SELECT MAX(a.score*100.0/NULLIF(a.question_count,0)) FROM learning_attempts a WHERE a.user_id=$1 AND a.subject_id=s.id AND a.status='completed'),0)::numeric best_percentage
      FROM learning_subjects s WHERE s.active=true ORDER BY s.sort_order`,[req.user.id]);
    res.json({subjects:r.rows});
  }catch(e){console.error(e);res.status(503).json({error:'Could not load subjects.'});}
});

app.get('/api/learning/progress',auth,requireActiveStudent,async(req,res)=>{
  try{
    const [subjects,chapters,latest,weak,totalAttempts]=await Promise.all([
      pool.query(`SELECT s.id,s.name,COUNT(q.id)::int question_count,COALESCE(MAX(a.score),0)::int best_score,COALESCE(MAX(a.score*100.0/NULLIF(a.question_count,0)),0)::numeric best_percentage FROM learning_subjects s LEFT JOIN learning_questions q ON q.subject_id=s.id AND q.active=true LEFT JOIN learning_attempts a ON a.subject_id=s.id AND a.user_id=$1 AND a.status='completed' GROUP BY s.id,s.name,s.sort_order ORDER BY s.sort_order`,[req.user.id]),
      pool.query(`SELECT s.name subject,q.chapter,COUNT(q.id)::int question_count,COALESCE(MAX(a.score),0)::int best_score,COALESCE(MAX(a.score)*100.0/NULLIF(MAX(a.question_count),0),0)::numeric best_percentage FROM learning_questions q JOIN learning_subjects s ON s.id=q.subject_id LEFT JOIN learning_attempts a ON a.subject_id=q.subject_id AND a.chapter=q.chapter AND a.user_id=$1 AND a.status='completed' GROUP BY s.name,q.chapter ORDER BY s.name,q.chapter`,[req.user.id]),
      pool.query(`SELECT a.id,a.subject_id,s.name subject,a.chapter,a.question_count,a.score,a.status,a.started_at,a.completed_at FROM learning_attempts a JOIN learning_subjects s ON s.id=a.subject_id WHERE a.user_id=$1 ORDER BY a.started_at DESC LIMIT 10`,[req.user.id]),
      pool.query(`SELECT s.name subject,a.chapter,MAX(a.score*100.0/NULLIF(a.question_count,0))::numeric best_percentage FROM learning_attempts a JOIN learning_subjects s ON s.id=a.subject_id WHERE a.user_id=$1 AND a.status='completed' AND a.chapter IS NOT NULL GROUP BY s.name,a.chapter HAVING MAX(a.score*100.0/NULLIF(a.question_count,0)) < 60 ORDER BY best_percentage ASC LIMIT 12`,[req.user.id]),
      pool.query(`SELECT COUNT(*)::int n FROM learning_attempts WHERE user_id=$1`,[req.user.id])
    ]);
    const completed=chapters.rows.filter(x=>Number(x.best_percentage)>=80).length;
    res.json({subjects:subjects.rows,chapters:chapters.rows,latest:latest.rows,weak:weak.rows,total_attempts:totalAttempts.rows[0]?.n||0,chapter_completed:completed,total_chapters:chapters.rowCount});
  }catch(e){console.error(e);res.status(503).json({error:'Could not load progress.'});}
});

app.get('/api/learning/history',auth,requireActiveStudent,async(req,res)=>{
  try{const r=await pool.query(`SELECT a.id,s.name subject,a.chapter,a.question_count,a.score,ROUND(a.score*100.0/NULLIF(a.question_count,0),2) percentage,a.status,a.started_at,a.completed_at FROM learning_attempts a JOIN learning_subjects s ON s.id=a.subject_id WHERE a.user_id=$1 ORDER BY a.started_at DESC LIMIT 100`,[req.user.id]);res.json({attempts:r.rows});}
  catch(e){res.status(500).json({error:'Could not load attempt history.'});}
});

app.get('/api/learning/wrong',auth,requireActiveStudent,async(req,res)=>{
  try{const r=await pool.query(`SELECT DISTINCT ON (q.id) q.id,s.name subject,q.chapter,q.question,q.options,q.correct_index,q.explanation,ai.selected_index,a.completed_at FROM learning_attempt_items ai JOIN learning_attempts a ON a.id=ai.attempt_id JOIN learning_questions q ON q.id=ai.question_id JOIN learning_subjects s ON s.id=q.subject_id WHERE a.user_id=$1 AND ai.is_correct=false AND a.status='completed' ORDER BY q.id,a.completed_at DESC LIMIT 100`,[req.user.id]);res.json({questions:r.rows});}
  catch(e){res.status(500).json({error:'Could not load wrong-question revision.'});}
});

app.get('/api/learning/notes',async(req,res)=>{
  const subject=String(req.query.subject||'').trim(), chapter=String(req.query.chapter||'').trim();
  try{const args=[],where=[`LOWER(type) IN ('notes','ppt','pdf')`];if(subject){args.push(subject);where.push(`LOWER(subject)=LOWER($${args.length})`)}if(chapter){args.push(chapter);where.push(`LOWER(chapter)=LOWER($${args.length})`)}const r=await pool.query(`SELECT id,title,type,subject,chapter,description,created_at FROM resources WHERE ${where.join(' AND ')} ORDER BY type,title`,args);res.json({notes:r.rows});}
  catch(e){res.status(500).json({error:'Could not load notes.'});}
});

app.post('/api/learning/attempts',auth,requireActiveStudent,async(req,res)=>{
  const subjectId=Number(req.body.subject_id),chapter=String(req.body.chapter||'').trim()||null;
  const requested=Number(req.body.question_count||50); const questionCount=[20,50].includes(requested)?requested:50;
  if(!Number.isInteger(subjectId)||subjectId<1)return res.status(400).json({error:'Valid subject_id required.'});
  try{
    const sub=await pool.query(`SELECT id,name FROM learning_subjects WHERE id=$1 AND active=true`,[subjectId]);if(!sub.rowCount)return res.status(404).json({error:'Subject not found.'});
    const args=[subjectId];let where='subject_id=$1 AND active=true';if(chapter){args.push(chapter);where+=' AND chapter=$2';}
    const qs=await pool.query(`SELECT id FROM learning_questions WHERE ${where} ORDER BY random() LIMIT ${questionCount}`,args);
    if(qs.rowCount<questionCount)return res.status(409).json({error:`Only ${qs.rowCount}/${questionCount} questions are available for this selection.`});
    const duration=questionCount===50?1800:720;
    const client=await pool.connect();try{await client.query('BEGIN');const a=await client.query(`INSERT INTO learning_attempts(user_id,subject_id,chapter,question_count,duration_seconds) VALUES($1,$2,$3,$4,$5) RETURNING id`,[req.user.id,subjectId,chapter,questionCount,duration]);for(let i=0;i<qs.rows.length;i++)await client.query(`INSERT INTO learning_attempt_items(attempt_id,question_id,position) VALUES($1,$2,$3)`,[a.rows[0].id,qs.rows[i].id,i+1]);await client.query('COMMIT');res.status(201).json({attempt_id:a.rows[0].id,question_number:1,total:questionCount,duration_seconds:duration});}finally{client.release();}
  }catch(e){console.error(e);res.status(500).json({error:'Could not start quiz.'});}
});

app.get('/api/learning/attempts/:id/current',auth,requireActiveStudent,async(req,res)=>{
  try{const a=await pool.query(`SELECT a.*,s.name subject FROM learning_attempts a JOIN learning_subjects s ON s.id=a.subject_id WHERE a.id=$1 AND a.user_id=$2`,[req.params.id,req.user.id]);if(!a.rowCount)return res.status(404).json({error:'Attempt not found.'});const at=a.rows[0];if(at.status!=='in_progress')return res.status(409).json({error:'Attempt is already completed.'});const elapsed=Math.floor((Date.now()-new Date(at.started_at).getTime())/1000);if(elapsed>=at.duration_seconds)return finishAttempt(req,res,req.params.id,true);const it=await pool.query(`SELECT ai.id item_id,ai.position,q.id question_id,q.question,q.options FROM learning_attempt_items ai JOIN learning_questions q ON q.id=ai.question_id WHERE ai.attempt_id=$1 AND ai.answered_at IS NULL ORDER BY ai.position LIMIT 1`,[req.params.id]);if(!it.rowCount)return finishAttempt(req,res,req.params.id,false);res.json({attempt_id:at.id,subject:at.subject,chapter:at.chapter,question_number:it.rows[0].position,total:at.question_count,question_id:it.rows[0].question_id,question:it.rows[0].question,options:it.rows[0].options,remaining_seconds:Math.max(0,at.duration_seconds-elapsed),duration_seconds:at.duration_seconds});}
  catch(e){console.error(e);res.status(500).json({error:'Could not load question.'});}
});

async function finishAttempt(req,res,attemptId,timeout=false){
  const client=await pool.connect();try{await client.query('BEGIN');const a=await client.query(`SELECT * FROM learning_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE`,[attemptId,req.user.id]);if(!a.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Attempt not found.'});}const correct=await client.query(`SELECT COUNT(*)::int n FROM learning_attempt_items WHERE attempt_id=$1 AND is_correct=true`,[attemptId]);const score=correct.rows[0].n, max=a.rows[0].question_count, passed=max===50&&score>=40;await client.query(`UPDATE learning_attempts SET status='completed',completed_at=NOW(),score=$2 WHERE id=$1`,[attemptId,score]);let code=null;if(passed){code='TOL-'+crypto.randomBytes(6).toString('hex').toUpperCase();const type=a.rows[0].chapter?'chapter':'subject';await client.query(`INSERT INTO learning_certificates(user_id,subject_id,attempt_id,chapter,certificate_code,score,max_score,percentage,certificate_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[req.user.id,a.rows[0].subject_id,attemptId,a.rows[0].chapter,code,score,max,(score/max)*100,type]);}await client.query('COMMIT');return res.json({completed:true,timeout,passed,score,max_score:max,percentage:Number(((score/max)*100).toFixed(2)),certificate_code:code,certificate_threshold:max===50?40:null});}
  catch(e){await client.query('ROLLBACK');console.error(e);return res.status(500).json({error:'Could not finish attempt.'});}finally{client.release();}
}

app.post('/api/learning/attempts/:id/answer',auth,requireActiveStudent,async(req,res)=>{
  const selected=req.body.selected_index===null?null:Number(req.body.selected_index);if(selected!==null&&(!Number.isInteger(selected)||selected<0||selected>3))return res.status(400).json({error:'selected_index must be 0-3 or null.'});
  const client=await pool.connect();try{await client.query('BEGIN');const a=await client.query(`SELECT * FROM learning_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE`,[req.params.id,req.user.id]);if(!a.rowCount||a.rows[0].status!=='in_progress'){await client.query('ROLLBACK');return res.status(404).json({error:'Active attempt not found.'});}const elapsed=(Date.now()-new Date(a.rows[0].started_at).getTime())/1000;if(elapsed>a.rows[0].duration_seconds){await client.query('ROLLBACK');return finishAttempt(req,res,req.params.id,true);}const it=await client.query(`SELECT ai.id,q.correct_index,q.explanation,q.options FROM learning_attempt_items ai JOIN learning_questions q ON q.id=ai.question_id WHERE ai.attempt_id=$1 AND ai.answered_at IS NULL ORDER BY ai.position LIMIT 1 FOR UPDATE OF ai`,[req.params.id]);if(!it.rowCount){await client.query('ROLLBACK');return finishAttempt(req,res,req.params.id,false);}const x=it.rows[0],correct=selected!==null&&selected===x.correct_index;await client.query(`UPDATE learning_attempt_items SET selected_index=$2,answered_at=NOW(),is_correct=$3 WHERE id=$1`,[x.id,selected,correct]);const remaining=await client.query(`SELECT COUNT(*)::int n FROM learning_attempt_items WHERE attempt_id=$1 AND answered_at IS NULL`,[req.params.id]);await client.query('COMMIT');if(remaining.rows[0].n===0)return finishAttempt(req,res,req.params.id,false);res.json({correct,correct_index:x.correct_index,correct_answer:x.options[x.correct_index],explanation:x.explanation||'',remaining:remaining.rows[0].n});}catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'Could not save answer.'});}finally{client.release();}
});

app.post('/api/learning/attempts/:id/finish',auth,requireActiveStudent,async(req,res)=>finishAttempt(req,res,req.params.id,false));

app.get('/api/learning/certificates',auth,requireActiveStudent,async(req,res)=>{try{const r=await pool.query(`SELECT c.certificate_code,c.score,c.max_score,c.percentage,c.issued_at,c.certificate_type,c.chapter,s.name subject,COALESCE(u.display_name,u.instagram_username) student FROM learning_certificates c JOIN users u ON u.id=c.user_id LEFT JOIN learning_subjects s ON s.id=c.subject_id WHERE c.user_id=$1 ORDER BY c.issued_at DESC`,[req.user.id]);res.json({certificates:r.rows});}catch(e){res.status(503).json({error:'Could not load certificates.'});}});

function pdfEscape(value){return String(value||'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[^\x20-\x7E]/g,'');}
function buildCertificatePdf(cert, student){
  const name=pdfEscape(student||'Student'), subject=pdfEscape(cert.subject||'Medical Learning'), chapter=pdfEscape(cert.chapter||''), score=pdfEscape(`${cert.score}/${cert.max_score} (${cert.percentage}%)`), code=pdfEscape(cert.certificate_code), date=pdfEscape(new Date(cert.issued_at).toLocaleDateString('en-IN'));
  const objects=[];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
  const stream=[
    'q 0.03 0.10 0.18 rg 0 0 842 595 re f Q',
    'q 0.06 0.28 0.48 RG 18 w 24 24 794 547 re S Q',
    'BT /F1 30 Tf 0.40 0.85 1 rg 250 500 Td (TRUTH.OFLIFES) Tj ET',
    'BT /F1 27 Tf 1 1 1 rg 255 435 Td (Certificate of Completion) Tj ET',
    'BT /F1 14 Tf 0.75 0.84 0.92 rg 330 390 Td (This certificate is presented to) Tj ET',
    `BT /F1 30 Tf 1 1 1 rg  ${Math.max(120, 421-(name.length*5))} 340 Td (${name}) Tj ET`,
    'BT /F1 15 Tf 0.75 0.84 0.92 rg 325 300 Td (for completing the educational learning assessment) Tj ET',
    `BT /F1 20 Tf 0.40 0.85 1 rg ${Math.max(150, 421-(subject.length*5))} 255 Td (${subject}) Tj ET`,
    chapter ? `BT /F1 12 Tf 0.75 0.84 0.92 rg ${Math.max(180, 421-(chapter.length*4))} 230 Td (Chapter: ${chapter}) Tj ET` : '',
    `BT /F1 15 Tf 1 1 1 rg 300 195 Td (Score: ${score}) Tj ET`,
    `BT /F1 12 Tf 0.70 0.80 0.90 rg 80 90 Td (Certificate Code: ${code}) Tj ET`,
    `BT /F1 12 Tf 0.70 0.80 0.90 rg 650 90 Td (Issued: ${date}) Tj ET`,
    'BT /F1 9 Tf 0.55 0.65 0.75 rg 250 55 Td (Educational certificate - not a professional license or accredited qualification.) Tj ET'
  ].join('\n');
  objects.push(`<< /Length ${Buffer.byteLength(stream,'utf8')} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf='%PDF-1.4\n'; const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets[i+1]=Buffer.byteLength(pdf,'utf8');pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf,'utf8'); pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objects.length;i++) pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'utf8');
}

app.get('/api/learning/certificates/:code/download',auth,requireActiveStudent,async(req,res)=>{
  try{
    const r=await pool.query(`SELECT c.certificate_code,c.score,c.max_score,c.percentage,c.issued_at,c.certificate_type,c.chapter,s.name subject,COALESCE(u.display_name,u.instagram_username) student FROM learning_certificates c JOIN users u ON u.id=c.user_id LEFT JOIN learning_subjects s ON s.id=c.subject_id WHERE c.certificate_code=$1 AND c.user_id=$2`,[req.params.code,req.user.id]);
    if(!r.rowCount) return res.status(404).json({error:'Certificate not found.'});
    const pdf=buildCertificatePdf(r.rows[0],r.rows[0].student);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="truth-oflifes-${r.rows[0].certificate_code}.pdf"`);
    res.send(pdf);
  }catch(e){console.error(e);res.status(503).json({error:'Certificate download unavailable.'});}
});

app.get('/api/learning/certificates/verify/:code',async(req,res)=>{
 try{const r=await pool.query(`SELECT c.certificate_code,c.score,c.max_score,c.percentage,c.issued_at,c.certificate_type,c.chapter,s.name subject,COALESCE(u.display_name,u.instagram_username) student FROM learning_certificates c JOIN users u ON u.id=c.user_id LEFT JOIN learning_subjects s ON s.id=c.subject_id WHERE c.certificate_code=$1`,[req.params.code]);if(!r.rowCount)return res.status(404).json({valid:false});res.json({valid:true,certificate:r.rows[0],notice:'Educational quiz completion certificate; not a professional license or accredited qualification.'});}
 catch(e){res.status(503).json({error:'Certificate verification unavailable.'});}
});

app.get('/api/admin/mcq',adminAuth,async(req,res)=>{
 try{
  const q=String(req.query.q||'').trim(); const subject=String(req.query.subject||'').trim(); const chapter=String(req.query.chapter||'').trim();
  const params=[]; const where=["q.active=true"];
  if(subject){params.push(subject);where.push(`s.name=$${params.length}`)}
  if(chapter){params.push(chapter);where.push(`q.chapter=$${params.length}`)}
  if(q){params.push('%'+q.toLowerCase()+'%');where.push(`LOWER(q.question) LIKE $${params.length}`)}
  const r=await pool.query(`SELECT q.id,s.name subject,q.chapter,q.question,q.options,q.correct_index,q.explanation,q.difficulty,q.created_at FROM learning_questions q JOIN learning_subjects s ON s.id=q.subject_id WHERE ${where.join(' AND ')} ORDER BY q.id DESC LIMIT 500`,params);
  res.json({questions:r.rows});
 }catch(e){console.error(e);res.status(500).json({error:'Could not load MCQ bank.'});}
});
app.post('/api/admin/mcq',adminAuth,async(req,res)=>{
 try{
  const subject=String(req.body.subject||'').trim(),chapter=String(req.body.chapter||'').trim(),question=String(req.body.question||'').trim();
  const options=Array.isArray(req.body.options)?req.body.options.map(x=>String(x||'').trim()):[]; const correct=Number(req.body.correct_index);
  if(!subject||!chapter||!question||options.length!==4||options.some(x=>!x)||![0,1,2,3].includes(correct)) return res.status(400).json({error:'Subject, chapter, question, four options and correct answer are required.'});
  const sub=await pool.query(`SELECT id FROM learning_subjects WHERE LOWER(name)=LOWER($1) LIMIT 1`,[subject]);
  if(!sub.rowCount)return res.status(400).json({error:'Subject not found in learning subjects.'});
  const r=await pool.query(`INSERT INTO learning_questions(subject_id,chapter,question,options,correct_index,explanation,difficulty,active) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,true) RETURNING id`,[sub.rows[0].id,chapter,question,JSON.stringify(options),correct,String(req.body.explanation||''),String(req.body.difficulty||'basic')]);
  res.status(201).json({id:r.rows[0].id});
 }catch(e){console.error(e);res.status(500).json({error:'Could not create MCQ.'});}
});
app.patch('/api/admin/mcq/:id',adminAuth,async(req,res)=>{
 try{
  if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Invalid MCQ id.'});
  const subject=String(req.body.subject||'').trim(),chapter=String(req.body.chapter||'').trim(),question=String(req.body.question||'').trim();
  const options=Array.isArray(req.body.options)?req.body.options.map(x=>String(x||'').trim()):[]; const correct=Number(req.body.correct_index);
  if(!subject||!chapter||!question||options.length!==4||options.some(x=>!x)||![0,1,2,3].includes(correct))return res.status(400).json({error:'Complete all MCQ fields.'});
  const sub=await pool.query(`SELECT id FROM learning_subjects WHERE LOWER(name)=LOWER($1) LIMIT 1`,[subject]);if(!sub.rowCount)return res.status(400).json({error:'Subject not found.'});
  const r=await pool.query(`UPDATE learning_questions SET subject_id=$1,chapter=$2,question=$3,options=$4::jsonb,correct_index=$5,explanation=$6,difficulty=$7 WHERE id=$8 AND active=true RETURNING id`,[sub.rows[0].id,chapter,question,JSON.stringify(options),correct,String(req.body.explanation||''),String(req.body.difficulty||'basic'),Number(req.params.id)]);
  if(!r.rowCount)return res.status(404).json({error:'MCQ not found.'});res.json({ok:true});
 }catch(e){console.error(e);res.status(500).json({error:'Could not update MCQ.'});}
});
app.delete('/api/admin/mcq/:id',adminAuth,async(req,res)=>{
 try{if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Invalid MCQ id.'});const r=await pool.query(`UPDATE learning_questions SET active=false WHERE id=$1 AND active=true RETURNING id`,[Number(req.params.id)]);if(!r.rowCount)return res.status(404).json({error:'MCQ not found.'});res.json({ok:true});}
 catch(e){console.error(e);res.status(500).json({error:'Could not delete MCQ.'});}
});

app.get('/api/admin/mcq-stats',adminAuth,async(req,res)=>{
 try{
  const [total,bySubject]=await Promise.all([
   pool.query(`SELECT COUNT(*)::int n FROM learning_questions WHERE active=true`),
   pool.query(`SELECT s.name subject,COUNT(q.id)::int questions,COUNT(DISTINCT q.chapter)::int chapters,(SELECT COUNT(*)::int FROM (SELECT chapter FROM learning_questions q2 WHERE q2.subject_id=s.id AND q2.active=true GROUP BY chapter HAVING COUNT(*)>=50) z) complete_chapters FROM learning_subjects s LEFT JOIN learning_questions q ON q.subject_id=s.id AND q.active=true WHERE s.active=true GROUP BY s.id,s.name,s.sort_order ORDER BY s.sort_order`)
  ]);
  const ch=await pool.query(`SELECT COUNT(*)::int n FROM (SELECT subject_id,chapter FROM learning_questions WHERE active=true GROUP BY subject_id,chapter HAVING COUNT(*)>=50) x`);
  res.json({total_questions:total.rows[0].n,subjects:bySubject.rowCount,chapters:ch.rows[0].n,by_subject:bySubject.rows});
 }catch(e){console.error(e);res.status(500).json({error:'Could not load MCQ statistics.'});}
});
app.get('/api/admin/mcq-duplicates',adminAuth,async(req,res)=>{
 try{const r=await pool.query(`SELECT LOWER(TRIM(question)) question,COUNT(*)::int count,STRING_AGG(DISTINCT s.name||' → '||q.chapter,', ' ORDER BY s.name||' → '||q.chapter) locations FROM learning_questions q JOIN learning_subjects s ON s.id=q.subject_id WHERE q.active=true GROUP BY LOWER(TRIM(question)) HAVING COUNT(*)>1 ORDER BY COUNT(*) DESC,question LIMIT 200`);res.json({duplicates:r.rows});}
 catch(e){res.status(500).json({error:'Could not check duplicate questions.'});}
});

app.post('/api/admin/users',adminAuth,async(req,res)=>{
 const username=String(req.body.username||'').trim();const password=String(req.body.password||'');const email=String(req.body.email||'').trim();const displayName=String(req.body.display_name||'').trim();
 if(!username||password.length<8)return res.status(400).json({error:'Username and password (at least 8 characters) required.'});
 try{const hash=await bcrypt.hash(password,12);const r=await pool.query(`INSERT INTO users(instagram_username,email,password,display_name) VALUES($1,$2,$3,$4) RETURNING id,instagram_username,email,display_name,created_at`,[username,email||null,hash,displayName||null]);await pool.query(`INSERT INTO learning_user_status(user_id,is_active) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET is_active=true,deactivated_at=NULL,updated_at=NOW()`,[r.rows[0].id]);res.status(201).json({user:r.rows[0]});}
 catch(e){if(e.code==='23505')return res.status(409).json({error:'Username already exists.'});res.status(500).json({error:'Could not create student.'});}
});
app.patch('/api/admin/users/:id/status',adminAuth,async(req,res)=>{
 const active=req.body.active===true;if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Invalid user id.'});
 try{await pool.query(`INSERT INTO learning_user_status(user_id,is_active,deactivated_at) VALUES($1,$2,CASE WHEN $2 THEN NULL ELSE NOW() END) ON CONFLICT(user_id) DO UPDATE SET is_active=EXCLUDED.is_active,deactivated_at=EXCLUDED.deactivated_at,updated_at=NOW()`,[Number(req.params.id),active]);res.json({ok:true,active});}
 catch(e){res.status(500).json({error:'Could not update student status.'});}
});

// =========================
// START SERVER
// =========================

setupDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `truth.oflifes server running on port ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Database setup failed:",
      error
    );
    process.exit(1);
  });
