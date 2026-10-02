-- Welcome email follow-ups (Poz, 2 Oct 2026).
--
-- 1) Adviser full names. The email named advisers by their RECI short
--    name ("Tan"); Poz wants surnames. Seeded from the names on their
--    Clearvolt / CloudTalk accounts (Josh from his email address).
--    The email falls back to the short name when full_name is empty.
--
-- 2) Second client email for joint policies, so both policyholders get
--    the welcome email.

ALTER TABLE advisers ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE deals    ADD COLUMN IF NOT EXISTS client_email_2 TEXT;

UPDATE advisers SET full_name = 'Tanweer Hussain'      WHERE name = 'Tan'     AND full_name IS NULL;
UPDATE advisers SET full_name = 'Hayder Mansoor'       WHERE name = 'Hayder'  AND full_name IS NULL;
UPDATE advisers SET full_name = 'Gurdaht Singh'        WHERE name = 'Gurdaht' AND full_name IS NULL;
UPDATE advisers SET full_name = 'Atikur Sabur'         WHERE name = 'Atikur'  AND full_name IS NULL;
UPDATE advisers SET full_name = 'Jack Shepley'         WHERE name = 'Jack'    AND full_name IS NULL;
UPDATE advisers SET full_name = 'Ben Pilling'          WHERE name = 'Ben'     AND full_name IS NULL;
UPDATE advisers SET full_name = 'Joshua Barlow-Sharpe' WHERE name = 'Josh'    AND full_name IS NULL;
