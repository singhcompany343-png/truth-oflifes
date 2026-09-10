const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});


/* =========================
   WEBSITE PAGES
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});


/* =========================
   ADMIN AUTH
========================= */

function auth(req, res, next) {

  const token = (req.headers.authorization || "")
    .replace("Bearer ", "");

  try {

    req.user = jwt.verify(token, JWT_SECRET);

    next();

  } catch (error) {

    res.status(401).json({
      error: "Unauthorized"
    });

  }
}


/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/admin/login", async (req, res) => {

  try {

    const { username, password } = req.body;

    const { rows } = await pool.query(
      "SELECT id, username, password_hash FROM admins WHERE username=$1",
      [username]
    );

    if (
      !rows[0] ||
      !(await bcrypt.compare(password, rows[0].password_hash))
    ) {

      return res.status(401).json({
        error: "Invalid credentials"
      });

    }

    const token = jwt.sign(
      {
        id: rows[0].id,
        username: rows[0].username
      },
      JWT_SECRET,
      {
        expiresIn: "8h"
      }
    );

    res.json({ token });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Login failed"
    });

  }

});


/* =========================
   RESOURCES
========================= */

app.get("/api/resources", async (req, res) => {

  try {

    const { rows } = await pool.query(
      "SELECT * FROM resources ORDER BY created_at DESC"
    );

    res.json(rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load resources"
    });

  }

});


app.post("/api/resources", auth, async (req, res) => {

  try {

    const {
      title,
      type,
      subject,
      file_url,
      description
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO resources
      (title,type,subject,file_url,description)
      VALUES($1,$2,$3,$4,$5)
      RETURNING *`,
      [
        title,
        type,
        subject,
        file_url,
        description || ""
      ]
    );

    res.json(rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not add resource"
    });

  }

});


app.delete("/api/resources/:id", auth, async (req, res) => {

  try {

    await pool.query(
      "DELETE FROM resources WHERE id=$1",
      [req.params.id]
    );

    res.json({
      ok: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not delete resource"
    });

  }

});


/* =========================
   RESOURCE REQUESTS
========================= */

app.post("/api/requests", async (req, res) => {

  try {

    const {
      name,
      contact,
      type,
      resource,
      message
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO requests
      (name,contact,request_type,resource_title,message)
      VALUES($1,$2,$3,$4,$5)
      RETURNING *`,
      [
        name,
        contact,
        type || "Notes",
        resource,
        message || ""
      ]
    );

    res.json({
      ok: true,
      request: rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not submit request"
    });

  }

});


/* =========================
   COLLABORATIONS
========================= */

app.post("/api/collaborations", async (req, res) => {

  try {

    const {
      name,
      contact,
      organization,
      category,
      message
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO collaborations
      (name,contact,category,message)
      VALUES($1,$2,$3,$4)
      RETURNING *`,
      [
        name,
        contact,
        organization || category || "",
        message || ""
      ]
    );

    res.json({
      ok: true,
      collaboration: rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not submit collaboration"
    });

  }

});


/* =========================
   ADMIN REQUESTS
========================= */

app.get("/api/requests", auth, async (req, res) => {

  try {

    const { rows } = await pool.query(
      "SELECT * FROM requests ORDER BY created_at DESC"
    );

    res.json(rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load requests"
    });

  }

});


/* =========================
   ADMIN COLLABORATIONS
========================= */

app.get("/api/collaborations", auth, async (req, res) => {

  try {

    const { rows } = await pool.query(
      "SELECT * FROM collaborations ORDER BY created_at DESC"
    );

    res.json(rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load collaborations"
    });

  }

});


/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(
    `truth.oflifes running on port ${PORT}`
  );
});
