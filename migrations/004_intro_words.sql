ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS intro_words jsonb NOT NULL DEFAULT '[["PHOTO","GRAPHY"],["BRAND","ING"],["DESIGN","LEAD"]]'::jsonb;
