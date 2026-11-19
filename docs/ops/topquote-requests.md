# TopQuote requests: how we handle them

Requests come by email from Poz (pauline@topquote.uk.com) and Guy (guycodling@topquote.uk.com or guy@clearvolt.co.uk). Poz and Pauline are the same person: call her Poz.

Live site: https://post-it-portal.vercel.app (Vercel project in the ApexiaVIP team, deploys from `main`).
Database: Neon Postgres in London. Scripts read `POSTGRES_URL`:

    node --env-file=.env.local scripts/<script>.mjs     # local
    node scripts/<script>.mjs                           # when POSTGRES_URL is already in the environment

Back up before any write that touches more than a handful of rows: `node scripts/backup-now.mjs`.

## House rules

- Client data never leaves the UK. Do not paste transcripts, recordings or client details into any outside service.
- No client names in emails or notes. Use counts, case numbers and links, e.g. `https://post-it-portal.vercel.app/reci/clawback?q=<policy number>`.
- Every change is one small commit with a plain message saying what changed and why.
- Never change AWS (billing, IAM, org policy), Vercel production env vars, or logins without Jimmy.
- Never delete data. Mark inactive instead.

## Clawback RECI (/reci/clawback)

Each EBAH row is routed to an adviser by L&G seller code (`advisers.seller_codes`) first, then by agent name (`clawback_agent_map`). A seller with no code on file lands in **Xstaff**, and the auto-notify email goes to Tan and Hayder instead of the seller.

**"A seller's case is missing / landed in Xstaff"**
1. Find the case (`clawback_cases`, by policy number or the newest upload) and read its `agent_no` and `ebah_agent_name`.
2. Add the code to that adviser's `seller_codes`, and map the name string in `clawback_agent_map`.
3. Move the open case(s) to the adviser (`adviser_id`, `agent_bucket = 'adviser'`), or run `scripts/backfill-seller-code-routing.mjs`.
4. Reply with the case link(s).

**New OW**: master codes in env `NEW_OW_MASTER_CODES` (default `5930268`, Vercel production, write-only). A new master code needs Jimmy to add it in Vercel. Tag cases with `scripts/backfill-new-ow-source.mjs` after.
Open question (19 Nov 2026): is master `7781115` New OW? Covers Tan's case 1989 and Ben's 2004.

**A seller has left**
1. `advisers.active = false`.
2. Remove them from `ADVISERS` in `src/lib/schema.ts`.
3. Add their login username to `LEFT_USERNAMES` in `src/lib/auth.ts`.
4. Move any open clawback cases to whoever Poz names.

Advisers (Nov 2026): Tan, Hayder, Gurdaht, Atikur, Ben (id 7, seller code 9305459). Josh (id 8) left 19 Nov 2026.
3CX extensions: Tan 1009, Hayder 1004, Gurdaht 1011, Atikur 1019, Ben 1002.

## Call QA (/qa)

Flow: the seller drops the sale recording(s) on their own RECI board, with the client surname and call type. Poz listens in /reci/recordings and presses Transcribe. Amazon Transcribe (London) runs, then the checks run on Bedrock in London (model pinned in `src/lib/qa/uk.ts`; newer models are blocked on TopQuote's AWS account). A "report ready" email goes to Poz.

**New script or Fact Find sheet from Guy**
1. Download the attachment(s). Export them to text with `scripts/qa-docx-text.py`.
2. Add a `VERSIONS` line in `scripts/seed-qa-rulesets.mjs`, dated with the day Guy issued it. A script applies from its issue date: the call date picks the version.
3. Run the seed. Commit.
4. Reply to confirm which documents and dates are now live.

Only the scripts and the sheet are checked. The 6 Oct call guides are retired from checking.

**Re-running a case**
A rerun emails Poz automatically. Never rerun a case Poz is reviewing unless she asks. Run-to-run variance is real (temperature 0 since 18 Nov 2026), so compare against her verdicts, not the previous run.
Benchmark case: case 8, run 317. Poz is reviewing it.

**Cost**: about $1.80 per hour-long call, plus about $1.50 an hour for Transcribe.

## Writing the reply

- Short and plain. Say what was done, link to it, and say what's still open.
- Answer by email. Don't suggest calls or meetings.
- No em dashes. Sign off `KR / Jimmy`.
