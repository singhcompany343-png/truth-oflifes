const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("Set ADMIN_PASSWORD before running this script.");
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admins(username,password_hash) VALUES($1,$2)
     ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
    [username, hash]
  );
  console.log("Admin created/updated:", username);
  await pool.end();
})();
