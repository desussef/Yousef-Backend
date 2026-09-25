ALTER TABLE contact_settings
  ADD COLUMN display_text text CHECK (length(display_text) <= 5000);

UPDATE contact_settings
SET display_text = concat_ws(E'\n',
  'E-mail: ' || email,
  CASE WHEN phone IS NOT NULL AND phone <> '' THEN 'Phone: ' || phone END,
  'Instagram: @yousefgraphs',
  CASE WHEN location IS NOT NULL AND location <> '' THEN 'Based in: ' || location END
)
WHERE display_text IS NULL;
