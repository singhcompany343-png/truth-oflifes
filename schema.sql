CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Notes','PPT')),
  subject TEXT,
  file_url TEXT NOT NULL,
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
