/*
 * truth.oflifes — Direct PDF storage FINAL FIX
 *
 * IMPORTANT:
 * - Load before server.js:
 *     node -r ./direct-pdf.js server.js
 * - This version intentionally uses JSON + Base64 only.
 * - It does NOT install express.raw(), because the current admin.html
 *   sends { file_data: "data:application/pdf;base64,..." } as JSON.
 * - Existing server.js remains in place.
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const MAX_BYTES = 15 * 1024 * 1024;
const JWT_SECRET = process.env.JWT_SECRET || "truth-oflifes-secret";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

/* The PDF is sent as JSON Base64. A 15 MB PDF expands to ~20 MB Base64. */
const originalJson = express.json;
express.json = function (options = {}) {
  return originalJson.call(express, {
    ...options,
    limit: "22mb"
  });
};

function getUser(req) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(h.slice(7), JWT_SECRET);
  } catch (_) {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Admin login required" });
  if (user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  req.user = user;
  next();
}

function requireUser(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Login required" });
  if (user.role !== "user" && user.role !== "admin") {
    return res.status(403).json({ error: "Login required" });
  }
  req.user = user;
  next();
}

async function ensureColumns() {
  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS file_data BYTEA,
      ADD COLUMN IF NOT EXISTS file_name TEXT,
      ADD COLUMN IF NOT EXISTS mime_type TEXT,
      ADD COLUMN IF NOT EXISTS file_size INTEGER
  `);
}

function cleanName(name) {
  const n = String(name || "resource.pdf").trim();
  return n.replace(/[^\w.\- ()]/g, "_").slice(0, 180) || "resource.pdf";
}

function parsePdfData(value, fileName) {
  if (value === undefined || value === null || value === "") {
    throw new Error("PDF file is required");
  }

  // Some clients may send the data URL wrapped in a JSON/string representation.
  // Normalize it before decoding.
  let raw = typeof value === "string" ? value.trim() : String(value).trim();

  // Supports Data URLs:
  // data:application/pdf;base64,JVBER...
  if (/^data:/i.test(raw)) {
    const comma = raw.indexOf(",");
    if (comma < 0) throw new Error("Invalid PDF upload data");
    raw = raw.slice(comma + 1);
  }

  // If a data URL was double-encoded, decode one layer.
  try {
    if (/%[0-9a-f]{2}/i.test(raw)) raw = decodeURIComponent(raw);
  } catch (_) {}

  // Remove whitespace/newlines inserted by mobile/browser handling.
  raw = raw.replace(/\s+/g, "");

  // Strip an accidental second data-url prefix after decoding.
  if (/^data:/i.test(raw)) {
    const comma = raw.indexOf(",");
    if (comma >= 0) raw = raw.slice(comma + 1);
  }

  // Accept URL-safe Base64 too.
  raw = raw.replace(/-/g, "+").replace(/_/g, "/");
  while (raw.length % 4) raw += "=";

  let buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch (_) {
    throw new Error("Invalid PDF upload data");
  }

  if (!buffer || buffer.length === 0) {
    throw new Error("Empty PDF file");
  }

  if (buffer.length > MAX_BYTES) {
    throw new Error("PDF must be 15 MB or smaller");
  }

  // PDF signature must be %PDF somewhere at the beginning.
  if (buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("Invalid PDF file");
  }

  return {
    buffer,
    fileName: cleanName(fileName),
    mime: "application/pdf"
  };
}

function meta(v) {
  return String(v ?? "").trim();
}

const originalPost = express.application.post;
const originalPut = express.application.put;
const originalGet = express.application.get;

/*
 * POST /api/resources
 * Current admin.html sends JSON with file_data.
 */
express.application.post = function (route, ...handlers) {
  if (route === "/api/resources") {
    return originalPost.call(this, route, requireAdmin, async (req, res) => {
      try {
        await ensureColumns();

        const body = req.body && typeof req.body === "object" ? req.body : {};
        const title = meta(body.title);
        const type = meta(body.type);
        const subject = meta(body.subject);
        const chapter = meta(body.chapter);
        const description = meta(body.description);

        if (!title || !type) {
          return res.status(400).json({ error: "Title and type are required" });
        }

        const file = parsePdfData(body.file_data, body.file_name);

        const result = await pool.query(
          `INSERT INTO resources
             (title,type,subject,chapter,description,file_url,
              file_data,file_name,mime_type,file_size)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9)
           RETURNING id,title,type,subject,chapter,description,created_at`,
          [
            title,
            type,
            subject || null,
            chapter || null,
            description || null,
            file.buffer,
            file.fileName,
            file.mime,
            file.buffer.length
          ]
        );

        return res.json(result.rows[0]);
      } catch (err) {
        console.error("Direct PDF upload failed:", err);
        return res.status(400).json({
          error: err && err.message ? err.message : "Could not upload PDF"
        });
      }
    });
  }

  return originalPost.apply(this, arguments);
};

/*
 * PUT /api/resources/:id
 * PDF is optional during edit; if supplied, replace the stored PDF.
 */
express.application.put = function (route, ...handlers) {
  if (route === "/api/resources/:id") {
    return originalPut.call(this, route, requireAdmin, async (req, res) => {
      try {
        await ensureColumns();

        const body = req.body && typeof req.body === "object" ? req.body : {};
        const title = meta(body.title);
        const type = meta(body.type);

        if (!title || !type) {
          return res.status(400).json({ error: "Title and type are required" });
        }

        const subject = meta(body.subject) || null;
        const chapter = meta(body.chapter) || null;
        const description = meta(body.description) || null;

        let file = null;
        if (body.file_data) {
          file = parsePdfData(body.file_data, body.file_name);
        }

        if (file) {
          const result = await pool.query(
            `UPDATE resources
             SET title=$1,type=$2,subject=$3,chapter=$4,description=$5,
                 file_url=NULL,file_data=$6,file_name=$7,mime_type=$8,file_size=$9
             WHERE id=$10
             RETURNING id,title,type,subject,chapter,description,created_at`,
            [
              title, type, subject, chapter, description,
              file.buffer, file.fileName, file.mime, file.buffer.length,
              req.params.id
            ]
          );

          if (!result.rows.length) {
            return res.status(404).json({ error: "Resource not found" });
          }
          return res.json(result.rows[0]);
        }

        const result = await pool.query(
          `UPDATE resources
           SET title=$1,type=$2,subject=$3,chapter=$4,description=$5
           WHERE id=$6
           RETURNING id,title,type,subject,chapter,description,created_at`,
          [title, type, subject, chapter, description, req.params.id]
        );

        if (!result.rows.length) {
          return res.status(404).json({ error: "Resource not found" });
        }

        return res.json(result.rows[0]);
      } catch (err) {
        console.error("Direct PDF update failed:", err);
        return res.status(400).json({
          error: err && err.message ? err.message : "Could not update resource"
        });
      }
    });
  }

  return originalPut.apply(this, arguments);
};

/*
 * GET /api/resources/:id/download
 * Direct PDF is served from PostgreSQL. Old URL resources still work.
 */
express.application.get = function (route, ...handlers) {
  if (route === "/api/resources/:id/download") {
    return originalGet.call(this, route, requireUser, async (req, res) => {
      try {
        await ensureColumns();

        const result = await pool.query(
          `SELECT id,title,file_data,file_name,mime_type,file_size,file_url
           FROM resources WHERE id=$1 LIMIT 1`,
          [req.params.id]
        );

        if (!result.rows.length) {
          return res.status(404).json({ error: "Resource not found" });
        }

        const row = result.rows[0];

        if (row.file_data) {
          try {
            await pool.query(
              `INSERT INTO resource_downloads (user_id,resource_id)
               VALUES ($1,$2)`,
              [req.user.role === "user" ? req.user.id : null, row.id]
            );
          } catch (trackErr) {
            console.error("Download tracking failed:", trackErr);
          }

          const fileName = cleanName(row.file_name || row.title || "resource.pdf");

          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
          res.setHeader("Content-Length", String(row.file_size || row.file_data.length));

          return res.end(row.file_data);
        }

        // Migration fallback for resources that still have a URL.
        const url = meta(row.file_url);
        if (!url) {
          return res.status(404).json({ error: "File not available" });
        }

        const upstream = await fetch(url, { redirect: "follow" });
        if (!upstream.ok) {
          return res.status(502).json({ error: "Could not fetch resource file" });
        }

        const buffer = Buffer.from(await upstream.arrayBuffer());

        try {
          await pool.query(
            `INSERT INTO resource_downloads (user_id,resource_id)
             VALUES ($1,$2)`,
            [req.user.role === "user" ? req.user.id : null, row.id]
          );
        } catch (trackErr) {
          console.error("Download tracking failed:", trackErr);
        }

        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/pdf");
        res.setHeader("Content-Disposition", "inline");
        return res.end(buffer);
      } catch (err) {
        console.error("Direct PDF serve failed:", err);
        return res.status(500).json({ error: "Could not open resource" });
      }
    });
  }

  return originalGet.apply(this, arguments);
};

console.log("Direct PDF storage layer enabled — JSON/Base64 mode");
