CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 320),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_active_idx ON password_reset_tokens(user_id, expires_at) WHERE used_at IS NULL;
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  client text CHECK (length(client) <= 200), role text CHECK (length(role) <= 200),
  year integer CHECK (year BETWEEN 1900 AND 2100), description text CHECK (length(description) <= 10000),
  thumb_url text CHECK (length(thumb_url) <= 2048), hero_url text CHECK (length(hero_url) <= 2048),
  published boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_public_idx ON projects(published, category_id, sort_order);
CREATE TABLE project_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  image_url text NOT NULL CHECK (length(image_url) <= 2048), sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_media_project_idx ON project_media(project_id, sort_order);
CREATE TABLE about_content (id boolean PRIMARY KEY DEFAULT true CHECK (id), portrait_url text CHECK (length(portrait_url) <= 2048), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE bio_paragraphs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000), sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0));
CREATE TABLE client_logos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200), image_url text NOT NULL CHECK (length(image_url) <= 2048), sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0));
CREATE TABLE contact_settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), email text NOT NULL CHECK (length(email) <= 320), phone text CHECK (length(phone) <= 100), location text CHECK (length(location) <= 200), photo_url text CHECK (length(photo_url) <= 2048), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE site_settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), name text NOT NULL CHECK (length(name) <= 200), role text NOT NULL CHECK (length(role) <= 200), instagram jsonb NOT NULL DEFAULT '{}'::jsonb, vimeo jsonb NOT NULL DEFAULT '{}'::jsonb, linkedin jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE nav_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80), href text NOT NULL CHECK (href ~ '^#[a-z0-9/-]+$'), sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0));
CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, resource_type text, resource_id text, request_id uuid, ip inet, user_agent text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_logs_user_created_idx ON audit_logs(user_id, created_at DESC);
