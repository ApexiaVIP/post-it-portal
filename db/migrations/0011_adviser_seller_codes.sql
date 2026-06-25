-- Seller-code routing. Pauline has confirmed each adviser's L&G seller code
-- (column 2 "Agent No" on the EBAH). Sellers can have multiple codes -- Tan
-- and Hayder each have two because they sell both advised and non-advised.
-- The seller code is a stable identifier; the agent NAME string is fragile
-- (L&G can change "TOP QUOTE LIMITED H MANSOOR" to "TOP QUOTE LIMITED HAYDER
-- MANSOOR" silently). So we move bucketing to code-first matching with name
-- as fallback for cases without a known code.

ALTER TABLE advisers
  ADD COLUMN IF NOT EXISTS seller_codes TEXT[] NOT NULL DEFAULT '{}';

-- GIN index for fast `WHERE seller_codes @> ARRAY[$1]` lookups.
CREATE INDEX IF NOT EXISTS advisers_seller_codes_gin
  ON advisers USING GIN (seller_codes);

-- Seed Pauline's codes (June 2026).
UPDATE advisers SET seller_codes = ARRAY['8998049','8998056'] WHERE LOWER(name) = 'hayder';
UPDATE advisers SET seller_codes = ARRAY['8674608','8966012'] WHERE LOWER(name) = 'tan';
UPDATE advisers SET seller_codes = ARRAY['7968860']           WHERE LOWER(name) = 'gurdaht';
UPDATE advisers SET seller_codes = ARRAY['9273467']           WHERE LOWER(name) = 'atikur';
-- Jack deliberately left empty: Pauline confirmed he's moved to Xstaff. His
-- existing cases will be reassigned by the access-tier / Jack migration.
