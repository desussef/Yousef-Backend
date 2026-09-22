CREATE TABLE media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE CHECK (length(object_key) <= 1024),
  public_url text NOT NULL CHECK (length(public_url) <= 2048),
  original_filename text NOT NULL CHECK (length(original_filename) <= 255),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'video/mp4')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  storage_provider text NOT NULL CHECK (storage_provider IN ('local', 's3')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_objects_created_by_idx ON media_objects(created_by, created_at DESC);
