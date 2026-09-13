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
const RAW_UPLOAD_PATHS = new Set(["/api/resources"]);
express.json = function (options = {}) {
  const originalType = options.type;
  return originalJson.call(express, {
    ...options,
    limit: "22mb",
    type: function(req) {
      const path = String(req.path || req.url || "").split("?")[0];
      const contentType = String(req.headers["content-type"] || "").toLowerCase();
      const rawUpload = RAW_UPLOAD_PATHS.has(path) &&
        (req.method === "POST" || req.method === "PUT") &&
        !contentType.startsWith("application/json");
      if (rawUpload) return false;
      if (typeof originalType === "function") return originalType(req);
      if (typeof originalType === "string") return originalType;
      return true;
    }
  });
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
function normalizeMeta(v, fallback="") { return String(v ?? fallback).trim(); }

function validateResourceBuffer(buffer, fileName) {
  const name = normalizeMeta(fileName, "resource");
  const extMatch = name.toLowerCase().match(/\.[a-z0-9]+$/);
  const ext = extMatch ? extMatch[0] : "";
  if (!ALLOWED_EXT.has(ext)) throw new Error("Only PDF, PPT/PPTX, DOC/DOCX or XLS/XLSX files are allowed");
  if (!buffer || !buffer.length) throw new Error("Empty resource file");
  if (buffer.length > MAX_BYTES) throw new Error("File must be 15 MB or smaller");

  const head4 = buffer.subarray(0,4);
  const isPdf = buffer.subarray(0,4).toString("ascii") === "%PDF";
  const isOle = head4.length === 4 && head4[0]===0xD0 && head4[1]===0xCF && head4[2]===0x11 && head4[3]===0xE0;
  const isZipOffice = head4.length === 4 && head4[0]===0x50 && head4[1]===0x4B && head4[2]===0x03 && head4[3]===0x04;
  const valid = ext === ".pdf" ? isPdf : [".ppt",".xls"].includes(ext) ? isOle : [".pptx",".docx",".xlsx"].includes(ext) ? isZipOffice : false;
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
  return {buffer, mime:mimeMap[ext], fileName:name, ext};
}

function parseResourceFile(body) {
  const raw = String(body.file_data || "").trim();
  if (!raw) return null;
  let base64 = raw;
  const comma = raw.indexOf(",");
  if (/^data:/i.test(raw) && comma >= 0) base64 = raw.slice(comma + 1);
  try { base64 = decodeURIComponent(base64); } catch (_) {}
  base64 = String(base64).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  // Strict validation: do not silently turn arbitrary text into a file.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length < 8) throw new Error("Invalid resource upload data");
  while (base64.length % 4) base64 += "=";
  const buffer = Buffer.from(base64, "base64");
  return validateResourceBuffer(buffer, body.file_name);
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks=[]; let total=0;
    req.on("data", c => {
      total += c.length;
      if (total > MAX_BYTES) { reject(new Error("File must be 15 MB or smaller")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function header(req, name) {
  const v=req.headers[String(name).toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function metaFromRequest(req) {
  const q=req.query||{};
  return {
    title: normalizeMeta(q.title || header(req,"x-resource-title")),
    type: normalizeMeta(q.type || header(req,"x-resource-type")),
    subject: normalizeMeta(q.subject || header(req,"x-resource-subject")) || null,
    chapter: normalizeMeta(q.chapter || header(req,"x-resource-chapter")) || null,
    description: normalizeMeta(q.description || header(req,"x-resource-description")) || null,
    file_name: normalizeMeta(q.file_name || header(req,"x-resource-file-name"), "resource")
  };
}

const originalPost = express.application.post;
const originalPut = express.application.put;
const originalGet = express.application.get;

express.application.post = function(route, ...handlers) {
  if (route === "/api/resources") {
    return originalPost.call(this, route, adminAuth, async (req,res) => {
      try {
        await ensureColumns();
        const contentType=String(req.headers["content-type"]||"").toLowerCase();
        let body=req.body||{};
        let resourceFile=null;
        if (req.method === "POST" || req.method === "PUT") {
          const buffer=await readRawBody(req);
          const meta=metaFromRequest(req);
          resourceFile=validateResourceBuffer(buffer, meta.file_name);
          body=meta;
        } else {
          resourceFile=parseResourceFile(body);
        }
        if (!resourceFile) return res.status(400).json({error:"Resource file is required"});
        const title=normalizeMeta(body.title), type=normalizeMeta(body.type);
        if (!title || !type) return res.status(400).json({error:"Title and type are required"});
        const r=await pool.query(`INSERT INTO resources
          (title,type,subject,chapter,description,file_url,file_data,file_name,mime_type,file_size)
          VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9)
          RETURNING id,title,type,subject,chapter,description,created_at`,
          [title,type,normalizeMeta(body.subject)||null,normalizeMeta(body.chapter)||null,normalizeMeta(body.description)||null,
           resourceFile.buffer,resourceFile.fileName,resourceFile.mime,resourceFile.buffer.length]);
        res.json(r.rows[0]);
      } catch(e) { console.error(e); res.status(400).json({error:e.message||"Could not upload resource file"}); }
    });
  }
  return originalPost.apply(this, arguments);
};

express.application.put = function(route, ...handlers) {
  if (route === "/api/resources/:id") {
    return originalPut.call(this, route, adminAuth, async (req,res) => {
      try {
        await ensureColumns();
        const contentType=String(req.headers["content-type"]||"").toLowerCase();
        const isBinary=contentType.startsWith("application/octet-stream") || contentType.startsWith("application/pdf") || contentType.includes("vnd.ms-powerpoint") || contentType.includes("officedocument");
        const binaryMeta=isBinary?metaFromRequest(req):null;
        const body=isBinary?binaryMeta:(req.body||{});
        const title=normalizeMeta(body.title), type=normalizeMeta(body.type);
        if (!title || !type) return res.status(400).json({error:"Title and type are required"});
        const values=[title,type,normalizeMeta(body.subject)||null,normalizeMeta(body.chapter)||null,normalizeMeta(body.description)||null];
        let resourceFile=null;
        if(isBinary){
          resourceFile=validateResourceBuffer(await readRawBody(req),body.file_name);
        } else if(body.file_data){
          resourceFile=parseResourceFile(body);
        }
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
