const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || "truth-oflifes-secret";
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXT = new Set([".pdf",".ppt",".pptx",".doc",".docx",".xls",".xlsx"]);

const originalJson = express.json;
express.json = function (options = {}) {
  return originalJson.call(express, { ...options, limit: "22mb" });
};

function getUser(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return jwt.verify(h.slice(7), JWT_SECRET); } catch { return null; }
}
function userAuth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({error:"Login required"});
  if (u.role !== "user" && u.role !== "admin") return res.status(403).json({error:"Login required"});
  req.user = u; next();
}
function adminAuth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({error:"Admin login required"});
  if (u.role !== "admin") return res.status(403).json({error:"Admin access required"});
  req.user = u; next();
}
async function ensureColumns() {
  await pool.query(`ALTER TABLE resources
    ADD COLUMN IF NOT EXISTS file_data BYTEA,
    ADD COLUMN IF NOT EXISTS file_name TEXT,
    ADD COLUMN IF NOT EXISTS mime_type TEXT,
    ADD COLUMN IF NOT EXISTS file_size INTEGER;`);
}
function parseResourceFile(body) {
  const raw = String(body.file_data || "").trim();
  if (!raw) return null;

  // Android/Chrome can send different MIME values (or, in some cases, a raw base64 string).
  // Do not reject a valid file just because its data-URL prefix is unusual.
  let declaredMime = "application/octet-stream";
  let base64 = raw;
  const dataMatch = raw.match(/^data:([^,]*),([\s\S]*)$/);
  if (dataMatch) {
    const meta = String(dataMatch[1] || "");
    declaredMime = (meta.split(";")[0] || declaredMime).toLowerCase();
    base64 = dataMatch[2] || "";
  } else if (/^data:/i.test(raw)) {
    const comma = raw.indexOf(",");
    if (comma < 0) throw new Error("Invalid resource upload data");
    const meta = raw.slice(5, comma);
    declaredMime = (meta.split(";")[0] || declaredMime).toLowerCase();
    base64 = raw.slice(comma + 1);
  }

  base64 = String(base64).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new Error("Invalid resource upload data");
  }

  const fileName = String(body.file_name || "resource").trim();
  const extMatch = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  const ext = extMatch ? extMatch[0] : "";
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error("Only PDF, PPT/PPTX, DOC/DOCX or XLS/XLSX files are allowed");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("Empty resource file");
  if (buffer.length > MAX_BYTES) throw new Error("File must be 15 MB or smaller");

  const head4 = buffer.subarray(0,4);
  const isPdf = buffer.subarray(0,4).toString("ascii") === "%PDF";
  const isOle = head4.length === 4 && head4[0]===0xD0 && head4[1]===0xCF && head4[2]===0x11 && head4[3]===0xE0;
  const isZipOffice = head4.toString("ascii") === "PK\x03\x04";

  const valid =
    ext === ".pdf" ? isPdf :
    [".ppt",".xls"].includes(ext) ? isOle :
    [".pptx",".docx",".xlsx"].includes(ext) ? isZipOffice : false;

  if (!valid) throw new Error("Invalid or corrupted resource file");

  const mimeMap = {
    ".pdf":"application/pdf",
    ".ppt":"application/vnd.ms-powerpoint",
    ".pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".doc":"application/msword",
    ".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls":"application/vnd.ms-excel",
    ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  return {buffer, mime:mimeMap[ext], declaredMime, fileName, ext};
}

const originalPost = express.application.post;
const originalPut = express.application.put;
const originalGet = express.application.get;

express.application.post = function(route, ...handlers) {
  if (route === "/api/resources") {
    return originalPost.call(this, route, adminAuth, async (req,res) => {
      try {
        await ensureColumns();
        const resourceFile = parseResourceFile(req.body);
        if (!resourceFile) return res.status(400).json({error:"Resource file is required"});
        const title = String(req.body.title||"").trim();
        const type = String(req.body.type||"").trim();
        if (!title || !type) return res.status(400).json({error:"Title and type are required"});
        const r = await pool.query(
          `INSERT INTO resources
           (title,type,subject,chapter,description,file_url,file_data,file_name,mime_type,file_size)
           VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9)
           RETURNING id,title,type,subject,chapter,description,created_at`,
          [title,type,String(req.body.subject||"").trim()||null,
           String(req.body.chapter||"").trim()||null,
           String(req.body.description||"").trim()||null,
           resourceFile.buffer,resourceFile.fileName||"resource",
           resourceFile.mime,resourceFile.buffer.length]
        );
        res.json(r.rows[0]);
      } catch(e) {
        console.error(e);
        res.status(400).json({error:e.message||"Could not upload resource file"});
      }
    });
  }
  return originalPost.apply(this, arguments);
};

express.application.put = function(route, ...handlers) {
  if (route === "/api/resources/:id") {
    return originalPut.call(this, route, adminAuth, async (req,res) => {
      try {
        await ensureColumns();
        const title = String(req.body.title||"").trim();
        const type = String(req.body.type||"").trim();
        if (!title || !type) return res.status(400).json({error:"Title and type are required"});
        const values = [title,type,String(req.body.subject||"").trim()||null,
          String(req.body.chapter||"").trim()||null,String(req.body.description||"").trim()||null];
        const resourceFile = req.body.file_data ? parseResourceFile(req.body) : null;
        let q = `UPDATE resources SET title=$1,type=$2,subject=$3,chapter=$4,description=$5`;
        if (resourceFile) {
          q += `,file_url=NULL,file_data=$6,file_name=$7,mime_type=$8,file_size=$9`;
          values.push(resourceFile.buffer,resourceFile.fileName||"resource",
            resourceFile.mime,resourceFile.buffer.length);
        }
        q += ` WHERE id=$${values.length+1}
               RETURNING id,title,type,subject,chapter,description,created_at`;
        values.push(req.params.id);
        const r = await pool.query(q, values);
        if (!r.rows.length) return res.status(404).json({error:"Resource not found"});
        res.json(r.rows[0]);
      } catch(e) {
        console.error(e);
        res.status(400).json({error:e.message||"Could not update resource"});
      }
    });
  }
  return originalPut.apply(this, arguments);
};

express.application.get = function(route, ...handlers) {
  if (route === "/api/resources/:id/download") {
    return originalGet.call(this, route, userAuth, async (req,res) => {
      try {
        await ensureColumns();
        const r = await pool.query(
          `SELECT id,title,file_data,file_name,mime_type,file_size,file_url
           FROM resources WHERE id=$1 LIMIT 1`, [req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({error:"Resource not found"});
        const row = r.rows[0];

        if (row.file_data) {
          await pool.query(
            `INSERT INTO resource_downloads(user_id,resource_id) VALUES($1,$2)`,
            [req.user.role==="user" ? req.user.id : null, row.id]
          );
          const safe = String(row.file_name||row.title||"resource.pdf")
            .replace(/[^a-zA-Z0-9._ -]/g,"_");
          res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, private");
          res.setHeader("Pragma","no-cache");
          res.setHeader("Content-Type",row.mime_type||"application/octet-stream");
          const inline = String(row.mime_type||"").toLowerCase()==="application/pdf";
          res.setHeader("Content-Disposition",`${inline?"inline":"attachment"}; filename="${safe}"`);
          if (row.file_size) res.setHeader("Content-Length",String(row.file_size));
          return res.end(row.file_data);
        }

        // Keep old URL resources working during migration.
        const url = String(row.file_url||"").trim();
        if (!url) return res.status(404).json({error:"File not available"});
        const upstream = await fetch(url,{redirect:"follow"});
        if (!upstream.ok) return res.status(502).json({error:"Could not fetch resource file"});
        const buffer = Buffer.from(await upstream.arrayBuffer());
        await pool.query(
          `INSERT INTO resource_downloads(user_id,resource_id) VALUES($1,$2)`,
          [req.user.role==="user" ? req.user.id : null, row.id]
        );
        res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, private");
        const upstreamType = upstream.headers.get("content-type")||"application/octet-stream";
        res.setHeader("Content-Type",upstreamType);
        res.setHeader("Content-Disposition",upstreamType.toLowerCase().includes("pdf")?"inline":"attachment");
        res.end(buffer);
      } catch(e) {
        console.error(e);
        res.status(500).json({error:"Could not serve resource file"});
      }
    });
  }
  return originalGet.apply(this, arguments);
};

console.log("Direct resource-file storage layer enabled");
