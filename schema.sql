CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Notes','PPT','DOC','Image','Video','Question Paper','Study Material','Other')),
  subject TEXT,
  file_url TEXT,
  file_data TEXT,
  file_name TEXT,
  mime_type TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  request_type TEXT,
  resource_title TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collaborations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  category TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
