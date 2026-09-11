const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
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
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT,
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
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS collaborations (
      id SERIAL PRIMARY KEY,
      name TEXT,
      instagram_username TEXT,
      email TEXT,
      message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      visitor_key TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
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

  // Older databases may have requests/collaborations tables without the
  // Instagram username columns. Add them safely for the admin dashboard.
  await pool.query(`
    ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS instagram_username TEXT;
  `);
  await pool.query(`
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
  `);
  await pool.query(`
    ALTER TABLE collaborations
    ADD COLUMN IF NOT EXISTS instagram_username TEXT;
  `);
  await pool.query(`
    ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
  `);
  await pool.query(`UPDATE requests SET status='pending' WHERE status IS NULL;`);
  await pool.query(`UPDATE collaborations SET status='pending' WHERE status IS NULL;`);

  console.log("Database ready");
}

// =========================
// AUTH MIDDLEWARE
// =========================

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
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
      `INSERT INTO users (instagram_username, password)
       VALUES ($1, $2)
       RETURNING id, instagram_username, created_at`,
      [instagram_username, hash]
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
      `SELECT id, instagram_username, password, created_at
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
// OLD ADMIN LOGIN SUPPORT
// =========================

app.post("/api/admin/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const result = await pool.query(
      `SELECT id, username, password
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
      admin.password
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

app.get("/api/resources", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        type,
        subject,
        description,
        file_url,
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

// =========================
// AUTHENTICATED RESOURCE DOWNLOAD
// =========================

app.get("/api/resources/:id/download", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT file_url FROM resources WHERE id = $1`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Resource not found"
      });
    }

    const fileUrl = result.rows[0].file_url;

    if (!fileUrl) {
      return res.status(404).json({
        error: "File not available"
      });
    }

    const upstream = await fetch(fileUrl);

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
    const description = String(
      req.body.description || ""
    ).trim();

    const file_url = String(
      req.body.file_url ||
      req.body.fileUrl ||
      ""
    ).trim();

    if (!title || !type || !file_url) {
      return res.status(400).json({
        error: "Title, type and file URL are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO resources
       (title, type, subject, description, file_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, type, subject, description, file_url, created_at`,
      [
        title,
        type,
        subject,
        description,
        file_url
      ]
    );

    res.json({
      success: true,
      resource: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not add resource"
    });
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
    const description = String(req.body.description || "").trim();
    const file_url = String(req.body.file_url || req.body.fileUrl || "").trim();

    if (!title || !type || !file_url) {
      return res.status(400).json({
        error: "Title, type and file URL are required"
      });
    }

    const result = await pool.query(
      `UPDATE resources
       SET title=$1, type=$2, subject=$3, description=$4, file_url=$5
       WHERE id=$6
       RETURNING id, title, type, subject, description, file_url, created_at`,
      [title, type, subject, description, file_url, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Resource not found" });
    }

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
  try {
    const result = await pool.query(
      `DELETE FROM resources
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Resource not found"
      });
    }

    res.json({
      success: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not delete resource"
    });
  }
});

// =========================
// REQUEST FORM
// =========================

app.post("/api/requests", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();

    const instagram_username = String(
      req.body.instagram_username ||
      req.body.instagram ||
      ""
    ).trim();

    const type = String(req.body.type || "").trim();
    const subject = String(req.body.subject || "").trim();

    const message = String(
      req.body.message || ""
    ).trim();

    await pool.query(
      `INSERT INTO requests
       (name, instagram_username, type, subject, message, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [
        name,
        instagram_username,
        type,
        subject,
        message
      ]
    );

    res.json({
      success: true,
      message: "Request submitted successfully"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not submit request"
    });
  }
});

// =========================
// COLLABORATION
// =========================

app.post("/api/collaborations", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();

    const instagram_username = String(
      req.body.instagram_username ||
      req.body.instagram ||
      ""
    ).trim();

    const email = String(
      req.body.email || ""
    ).trim();

    const message = String(
      req.body.message || ""
    ).trim();

    await pool.query(
      `INSERT INTO collaborations
       (name, instagram_username, email, message, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [
        name,
        instagram_username,
        email,
        message
      ]
    );

    res.json({
      success: true,
      message: "Collaboration request submitted"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not submit collaboration"
    });
  }
});

// =========================
// ADMIN RESOURCE REQUESTS
// =========================

app.get("/api/requests", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, instagram_username, type, subject, message, status, created_at
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
      SELECT id, name, instagram_username, email, message, status, created_at
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
       RETURNING id, name, instagram_username, email, message, status, created_at`,
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

app.post("/api/visits", async (req, res) => {
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
