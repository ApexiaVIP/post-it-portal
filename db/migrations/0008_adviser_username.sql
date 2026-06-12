-- Map each adviser to a login username so we can scope the Clawback Dashboard
-- to "only this seller's cases" when Tan, Hayder, Gurdaht, Atikur or Jack
-- signs in. Admins (Jimmy / Pauline / Poz) and Guy stay unscoped.
--
-- Seed is just the lowercased adviser name. Adjust by hand if a real login
-- needs to diverge (e.g. someone uses an alias).

ALTER TABLE advisers
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

UPDATE advisers SET username = LOWER(name) WHERE username IS NULL;

CREATE INDEX IF NOT EXISTS advisers_username_idx ON advisers(username);
