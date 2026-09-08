CREATE TABLE IF NOT EXISTS todos (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS todos_created_at_idx ON todos (created_at DESC, id DESC);
