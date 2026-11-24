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

## Advice check (/advice-check)

Guy's pre-advice check (22 Nov 2026), run by the sellers (Tan, Hayder, Ben, Gurdaht; `ADVICE_CHECK_USERNAMES`) before they present advice. They upload photos of the completed Fact Find sheet (or type it); the recommendation is read from its policy pages, 7 to 9, and can be typed as well. It reads the sheet in London (surnames, dates of birth, addresses, contact, policy and bank details left out; photos deleted once read), then runs Guy's instructions with his reference documents: can this advice be given, the gap check, the justification, the Concert Hub notes, and every statement. Sellers see their own checks; Call QA users see all.

Since 24 Nov 2026 (call with Guy and Poz): a two call case is checked before the advice call for the licence and the red lines only, and run again after it, with "already presented" ticked, for the justification and notes. The check works out the red lines itself; the need, dependants, lifelong need, sum assured and term (`ALWAYS_RED` in `src/lib/advice/shared.ts`) are always red lines when missing. The full gap check is folded away.

The Fact Find can be completed online (/advice-check/form, 24 Nov 2026), so nothing depends on reading handwriting. Uploading or pasting a sheet stays as the fallback. First names and ages only; surnames, dates of birth, addresses and postcodes stay out. Sellers get it only once `FACT_FIND_KEEP_DAYS` is set on Vercel (Jimmy): it opens the form to them and clears answers that many days after the last change. Until then only Guy, Poz and Jimmy have it.

**New Fact Find sheet from Guy (the online form)**
1. Copy the latest `src/lib/factfind/sheet-*.ts` to a file named for the new issue date, make Guy's changes, and add it to the end of `SHEETS` in `src/lib/factfind/index.ts`. Forms already started keep their own version, so never edit an issued one.
2. Keep the keys of questions that haven't changed.

On a Call QA case, Poz links the seller's check to the sale. Then its statements are tested against the calls (Gate 4), and the ones the call doesn't back up join the callback list. The draft suitability report is written from the calls and the sheet together.

**New version of one of Guy's advice check documents** (his instructions, the scenario sheet, Openwork's expectations, the framework, the aide memoire): same as a new script. Add a `VERSIONS` line with `applies: "advice_check"` and the issue date, run the seed and commit. Instructions always use the latest version; the rest go by the date of the fact find call. The framework is confidential to the Openwork network: keep its text out of the repo (it lives with the other exports in `~/topquote-call-qa/brief/text/versions`).

**Re-running a case**
A rerun emails Poz automatically. Never rerun a case Poz is reviewing unless she asks. Run-to-run variance is real (temperature 0 since 18 Nov 2026), so compare against her verdicts, not the previous run.
Benchmark case: case 8, run 317. Poz is reviewing it.

**Cost**: about $1.80 per hour-long call, plus about $1.50 an hour for Transcribe.

## Writing the reply

- Short and plain. Say what was done, link to it, and say what's still open.
- Answer by email. Don't suggest calls or meetings.
- No em dashes. Sign off `KR / Jimmy`.
