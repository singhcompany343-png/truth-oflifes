const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query(
    "SELECT id, username, password_hash FROM admins WHERE username=$1",
    [username]
  );
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ id: rows[0].id, username }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token });
});

app.get("/api/resources", async (_, res) => {
  const { rows } = await pool.query("SELECT * FROM resources ORDER BY created_at DESC");
  res.json(rows);
});

app.post("/api/resources", auth, async (req, res) => {
  const { title, type, subject, file_url, description } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO resources(title,type,subject,file_url,description) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [title, type, subject, file_url, description]
  );
  res.json(rows[0]);
});

app.delete("/api/resources/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM resources WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/requests", async (req, res) => {
  const { name, contact, request_type, resource_title, message } = req.body;
  await pool.query(
    "INSERT INTO requests(name,contact,request_type,resource_title,message) VALUES($1,$2,$3,$4,$5)",
    [name, contact, request_type, resource_title, message]
  );
  res.json({ ok: true });
});

app.post("/api/collaborations", async (req, res) => {
  const { name, contact, category, message } = req.body;
  await pool.query(
    "INSERT INTO collaborations(name,contact,category,message) VALUES($1,$2,$3,$4)",
    [name, contact, category, message]
  );
  res.json({ ok: true });
});

app.get("/api/requests", auth, async (_, res) => {
  const { rows } = await pool.query("SELECT * FROM requests ORDER BY created_at DESC");
  res.json(rows);
});

app.get("/api/collaborations", auth, async (_, res) => {
  const { rows } = await pool.query("SELECT * FROM collaborations ORDER BY created_at DESC");
  res.json(rows);
});

app.listen(PORT, () => console.log(`truth.oflifes running on port ${PORT}`));
