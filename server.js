const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const JWT_SECRET =
  process.env.JWT_SECRET || "truth-oflifes-change-this-secret";


// =====================================================
// DATABASE TABLES
// =====================================================

async function ensureTables() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      instagram_username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('Notes','PPT')),
      subject TEXT,
      file_url TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      request_type TEXT,
      resource_title TEXT,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS collaborations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      category TEXT,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      visitor_key TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("Database tables ready.");
}


// =====================================================
// AUTH HELPERS
// =====================================================

function createToken(user) {

  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );

}


function auth(req, res, next) {

  const header = req.headers.authorization || "";

  const token = header.startsWith("Bearer ")
    ? header.substring(7)
    : null;

  if (!token) {

    return res.status(401).json({
      error: "Authentication required"
    });

  }

  try {

    req.user = jwt.verify(token, JWT_SECRET);

    next();

  } catch (error) {

    return res.status(401).json({
      error: "Invalid or expired token"
    });

  }

}


function adminAuth(req, res, next) {

  auth(req, res, () => {

    if (req.user.role !== "admin") {

      return res.status(403).json({
        error: "Admin access required"
      });

    }

    next();

  });

}


// =====================================================
// PUBLIC WEBSITE
// =====================================================

app.get("/", (req, res) => {

  res.sendFile(
    path.join(__dirname, "index.html")
  );

});


app.get("/admin.html", (req, res) => {

  res.sendFile(
    path.join(__dirname, "admin.html")
  );

});


// =====================================================
// USER REGISTER
// =====================================================

app.post("/api/auth/register", async (req, res) => {

  try {

    const {
      instagram_username,
      password
    } = req.body;

    const username =
      String(instagram_username || "")
        .trim()
        .replace(/^@/, "");

    const pass =
      String(password || "");

    if (!username || !pass) {

      return res.status(400).json({
        error: "Instagram username and password are required"
      });

    }

    if (username.length < 2) {

      return res.status(400).json({
        error: "Enter a valid Instagram username"
      });

    }

    if (pass.length < 6) {

      return res.status(400).json({
        error: "Password must be at least 6 characters"
      });

    }

    const existing =
      await pool.query(
        `
        SELECT id
        FROM users
        WHERE LOWER(instagram_username)=LOWER($1)
        `,
        [username]
      );

    if (existing.rows.length) {

      return res.status(409).json({
        error: "This Instagram username is already registered"
      });

    }

    const passwordHash =
      await bcrypt.hash(pass, 12);

    const result =
      await pool.query(
        `
        INSERT INTO users
        (instagram_username,password_hash)
        VALUES($1,$2)
        RETURNING id,instagram_username,created_at
        `,
        [username, passwordHash]
      );

    const user = result.rows[0];

    const token =
      createToken({
        id: user.id,
        username: user.instagram_username,
        role: "user"
      });

    res.json({
      success: true,
      token,
      role: "user",
      user: {
        id: user.id,
        instagram_username:
          user.instagram_username,
        created_at: user.created_at
      }
    });

  } catch (error) {

    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      error: "Account creation failed"
    });

  }

});


// =====================================================
// LOGIN
// =====================================================

app.post("/api/auth/login", async (req, res) => {

  try {

    const {
      mode,
      instagram_username,
      username,
      password
    } = req.body;

    const pass =
      String(password || "");

    if (!pass) {

      return res.status(400).json({
        error: "Password is required"
      });

    }


    // ---------------- USER LOGIN ----------------

    if (mode === "user") {

      const userName =
        String(instagram_username || "")
          .trim()
          .replace(/^@/, "");

      if (!userName) {

        return res.status(400).json({
          error: "Instagram username is required"
        });

      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            instagram_username,
            password_hash,
            created_at
          FROM users
          WHERE LOWER(instagram_username)=LOWER($1)
          LIMIT 1
          `,
          [userName]
        );

      if (!result.rows.length) {

        return res.status(401).json({
          error: "Invalid username or password"
        });

      }

      const user = result.rows[0];

      const valid =
        await bcrypt.compare(
          pass,
          user.password_hash
        );

      if (!valid) {

        return res.status(401).json({
          error: "Invalid username or password"
        });

      }

      const token =
        createToken({
          id: user.id,
          username: user.instagram_username,
          role: "user"
        });

      return res.json({
        success: true,
        token,
        role: "user",
        user: {
          id: user.id,
          instagram_username:
            user.instagram_username,
          created_at: user.created_at
        }
      });

    }


    // ---------------- ADMIN LOGIN ----------------

    if (mode === "admin") {

      const adminUsername =
        String(username || "").trim();

      if (!adminUsername) {

        return res.status(400).json({
          error: "Admin username is required"
        });

      }

      const result =
        await pool.query(
          `
          SELECT id,username,password_hash
          FROM admins
          WHERE LOWER(username)=LOWER($1)
          LIMIT 1
          `,
          [adminUsername]
        );

      if (!result.rows.length) {

        return res.status(401).json({
          error: "Invalid admin username or password"
        });

      }

      const admin = result.rows[0];

      const valid =
        await bcrypt.compare(
          pass,
          admin.password_hash
        );

      if (!valid) {

        return res.status(401).json({
          error: "Invalid admin username or password"
        });

      }

      const token =
        createToken({
          id: admin.id,
          username: admin.username,
          role: "admin"
        });

      return res.json({
        success: true,
        token,
        role: "admin",
        username: admin.username
      });

    }


    return res.status(400).json({
      error: "Invalid login mode"
    });

  } catch (error) {

    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      error: "Login failed"
    });

  }

});


// =====================================================
// OLD ADMIN LOGIN — BACKWARD COMPATIBILITY
// =====================================================

app.post("/api/admin/login", async (req, res) => {

  try {

    const {
      username,
      password
    } = req.body;

    const result =
      await pool.query(
        `
        SELECT id,username,password_hash
        FROM admins
        WHERE LOWER(username)=LOWER($1)
        LIMIT 1
        `,
        [String(username || "").trim()]
      );

    if (!result.rows.length) {

      return res.status(401).json({
        error: "Invalid username or password"
      });

    }

    const admin = result.rows[0];

    const valid =
      await bcrypt.compare(
        String(password || ""),
        admin.password_hash
      );

    if (!valid) {

      return res.status(401).json({
        error: "Invalid username or password"
      });

    }

    const token =
      createToken({
        id: admin.id,
        username: admin.username,
        role: "admin"
      });

    res.json({
      success: true,
      token,
      role: "admin"
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Login failed"
    });

  }

});


// =====================================================
// RESOURCES — PUBLIC READ
// =====================================================

app.get("/api/resources", async (req, res) => {

  try {

    const result =
      await pool.query(
        `
        SELECT *
        FROM resources
        ORDER BY created_at DESC
        `
      );

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load resources"
    });

  }

});


// =====================================================
// RESOURCE — ADMIN ADD
// =====================================================

app.post(
  "/api/resources",
  adminAuth,
  async (req, res) => {

    try {

      const {
        title,
        type,
        subject,
        file_url,
        description
      } = req.body;

      if (
        !title ||
        !type ||
        !file_url
      ) {

        return res.status(400).json({
          error: "Title, type and file URL are required"
        });

      }

      if (
        !["Notes", "PPT"].includes(type)
      ) {

        return res.status(400).json({
          error: "Type must be Notes or PPT"
        });

      }

      const result =
        await pool.query(
          `
          INSERT INTO resources
          (title,type,subject,file_url,description)
          VALUES($1,$2,$3,$4,$5)
          RETURNING *
          `,
          [
            title,
            type,
            subject || null,
            file_url,
            description || null
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

  }
);


// =====================================================
// RESOURCE — ADMIN DELETE
// =====================================================

app.delete(
  "/api/resources/:id",
  adminAuth,
  async (req, res) => {

    try {

      await pool.query(
        `
        DELETE FROM resources
        WHERE id=$1
        `,
        [req.params.id]
      );

      res.json({
        success: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not delete resource"
      });

    }

  }
);


// =====================================================
// REQUEST — PUBLIC CREATE
// =====================================================

app.post("/api/requests", async (req, res) => {

  try {

    const {
      name,
      contact,
      request_type,
      resource_title,
      resource,
      type,
      message
    } = req.body;

    const finalType =
      request_type || type || "Notes";

    const finalResource =
      resource_title || resource;

    if (
      !name ||
      !contact ||
      !finalResource
    ) {

      return res.status(400).json({
        error: "Name, contact and resource are required"
      });

    }

    const result =
      await pool.query(
        `
        INSERT INTO requests
        (name,contact,request_type,resource_title,message)
        VALUES($1,$2,$3,$4,$5)
        RETURNING *
        `,
        [
          name,
          contact,
          finalType,
          finalResource,
          message || null
        ]
      );

    res.json({
      success: true,
      request: result.rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not submit request"
    });

  }

});


// =====================================================
// REQUESTS — ADMIN
// =====================================================

app.get(
  "/api/requests",
  adminAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM requests
          ORDER BY created_at DESC
          `
        );

      res.json(result.rows);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not load requests"
      });

    }

  }
);


// =====================================================
// COLLABORATION — PUBLIC
// =====================================================

app.post(
  "/api/collaborations",
  async (req, res) => {

    try {

      const {
        name,
        contact,
        category,
        organization,
        message
      } = req.body;

      const finalCategory =
        category || organization || "General";

      if (
        !name ||
        !contact ||
        !message
      ) {

        return res.status(400).json({
          error: "Name, contact and message are required"
        });

      }

      const result =
        await pool.query(
          `
          INSERT INTO collaborations
          (name,contact,category,message)
          VALUES($1,$2,$3,$4)
          RETURNING *
          `,
          [
            name,
            contact,
            finalCategory,
            message
          ]
        );

      res.json({
        success: true,
        collaboration:
          result.rows[0]
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not submit collaboration"
      });

    }

  }
);


// =====================================================
// COLLABORATIONS — ADMIN
// =====================================================

app.get(
  "/api/collaborations",
  adminAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM collaborations
          ORDER BY created_at DESC
          `
        );

      res.json(result.rows);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Could not load collaborations"
      });

    }

  }
);


// =====================================================
// VISITOR COUNT
// =====================================================

app.post("/api/visit", async (req, res) => {

  try {

    const visitorKey =
      String(req.body.visitor_key || "").trim();

    if (!visitorKey) {

      return res.status(400).json({
        error: "visitor_key is required"
      });

    }

    await pool.query(
      `
      INSERT INTO visits(visitor_key)
      VALUES($1)
      ON CONFLICT(visitor_key)
      DO NOTHING
      `,
      [visitorKey]
    );

    const result =
      await pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM visits
        `
      );

    res.json({
      success: true,
      count: result.rows[0].count
    });

  } catch (error) {

    console.error("VISITOR ERROR:", error);

    res.status(500).json({
      error: "Could not track visitor"
    });

  }

});


// =====================================================
// VISITOR COUNT — ADMIN
// =====================================================

app.get(
  "/api/visits",
  adminAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM visits
          `
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

  }
);


// =====================================================
// REGISTERED USERS — ADMIN ONLY
// =====================================================

app.get(
  "/api/users",
  adminAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            id,
            instagram_username,
            created_at
          FROM users
          ORDER BY created_at DESC
          `
        );

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

  }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/api/health", async (req, res) => {

  try {

    await pool.query("SELECT 1");

    res.json({
      status: "ok"
    });

  } catch (error) {

    res.status(500).json({
      status: "database_error"
    });

  }

});


// =====================================================
// START SERVER
// =====================================================

async function startServer() {

  try {

    await ensureTables();

    app.listen(PORT, () => {

      console.log(
        `truth.oflifes running on port ${PORT}`
      );

    });

  } catch (error) {

    console.error(
      "SERVER START ERROR:",
      error
    );

    process.exit(1);

  }

}

startServer();
