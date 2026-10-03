const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

(async () => {
  const username = String(process.env.ADMIN_USERNAME || "admin").trim();
  const password = String(process.env.ADMIN_PASSWORD || "");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  // Keep this command safe for Render builds where the admin password
  // may be intentionally configured later. It must never create a
  // predictable/default admin password.
  if (!password) {
    console.log("ADMIN_PASSWORD is not set; skipping admin seed. Set ADMIN_USERNAME/ADMIN_PASSWORD in Render to create or update the admin account.");
    await pool.end();
    process.exit(0);
  }

  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admins(username,password_hash)
     VALUES($1,$2)
     ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
    [username, hash]
  );

  console.log(`Admin created/updated successfully: ${username}`);
  await pool.end();
})().catch(async (error) => {
  console.error("Admin seed failed:", error.message || error);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
