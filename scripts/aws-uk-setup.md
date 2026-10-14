# Call QA: TopQuote's UK (London) AWS setup

Call QA only runs once this is in place. Everything lives in TopQuote's own
AWS account (billed to TopQuote) in **Europe (London) `eu-west-2`**:

| Step | Service | Where |
|---|---|---|
| Recording held while it is transcribed | Amazon S3 | London, deleted on completion, 1-day auto-delete as a backstop |
| Transcription (bank/card details blanked) | Amazon Transcribe | London |
| AI checks | Claude Opus 5.5 on Amazon Bedrock, **in-region** | London (AWS: "the processing never leaves that Region") |

The portal pins the region and endpoints in code (`src/lib/qa/uk.ts`), refuses
any cross-region model ID (`eu.` / `global.` / `us.` prefixes), and refuses
uploads until the three settings at the bottom are present.

## 1. Account

1. Guy (or someone at TopQuote) creates an AWS account in TopQuote Ltd's name with a TopQuote card.
2. Turn on MFA for the root user. Don't use root day to day.
3. Set the console region to **Europe (London)**.

## 2. Stop AWS keeping content for service improvement (important)

By default AWS may store content sent to some AI services, Amazon Transcribe
included, to improve the service, and may store it outside the region. Opt out:

1. AWS Organizations: create an organization (the account becomes its management account).
2. Policies, **AI services opt-out policies**, enable, then create and attach to the root:

```json
{
  "services": {
    "default": { "opt_out_policy": { "@@assign": "optOut" } }
  }
}
```

Amazon Bedrock doesn't use prompts or outputs for training and doesn't store
them; leave **Bedrock model invocation logging switched off** (it is off by default).

## 3. S3 bucket (London)

Name it e.g. `topquote-call-qa-uk` (must be globally unique).

```bash
aws s3api create-bucket --bucket topquote-call-qa-uk --region eu-west-2 --create-bucket-configuration LocationConstraint=eu-west-2
```

```bash
aws s3api put-public-access-block --bucket topquote-call-qa-uk --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

```bash
aws s3api put-bucket-encryption --bucket topquote-call-qa-uk --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Backstop: anything left in the bucket is deleted after a day.

```bash
aws s3api put-bucket-lifecycle-configuration --bucket topquote-call-qa-uk --lifecycle-configuration '{"Rules":[{"ID":"delete-after-1-day","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":1},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
```

## 4. Claude on Bedrock (London)

Bedrock console, region **Europe (London)**, Model access: request **Claude Opus 5.5**
(Anthropic asks for a short use-case form). Confirm its model card shows
**In-Region** support for eu-west-2.

## 5. A user for the portal, locked to London

IAM, create user `topquote-call-qa` (no console access), attach this inline
policy (swap in the bucket name), then create an access key for it.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RecordingsBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::topquote-call-qa-uk/*"
    },
    {
      "Sid": "Transcribe",
      "Effect": "Allow",
      "Action": ["transcribe:StartTranscriptionJob", "transcribe:GetTranscriptionJob", "transcribe:DeleteTranscriptionJob"],
      "Resource": "*"
    },
    {
      "Sid": "ClaudeInLondon",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:eu-west-2::foundation-model/anthropic.claude-opus-5-5"
    },
    {
      "Sid": "LondonOnly",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": { "StringNotEquals": { "aws:RequestedRegion": "eu-west-2" } }
    }
  ]
}
```

## 6. Optional: teach Transcribe the product names

```bash
aws transcribe create-vocabulary --region eu-west-2 --vocabulary-name topquote-qa-terms --language-code en-GB --phrases TopQuote Openwork ConcertHub ICOBS FSCS Legal-and-General MetLife Vitality Zurich Aviva Royal-London The-Exeter critical-illness income-protection terminal-illness waiver-of-premium indexation decreasing-term level-term family-income-benefit key-features cooling-off discretionary-trust
```

Then add `QA_TRANSCRIBE_VOCABULARY=topquote-qa-terms` to Vercel.

## 7. Portal settings (Vercel, production)

| Name | Value |
|---|---|
| `QA_AWS_ACCESS_KEY_ID` | the access key from step 5 |
| `QA_AWS_SECRET_ACCESS_KEY` | its secret |
| `QA_S3_BUCKET` | the bucket name from step 3 |

Never paste keys into chat or email: put them in a file on the Desktop, pipe
them into `vercel env add`, then delete the file. Redeploy, then test with a
short recording that has no client details in it.

## What this does not cover

- Transcribe's redaction is designed to blank card and bank numbers but AWS
  says it may not catch every one (its bank account type is built around US
  formats). The audio is deleted either way, and transcripts sit behind the
  Call QA login (Jimmy, Poz, Guy).
- A job still running when its call is deleted may leave its transcript file
  in the bucket until the 1-day rule clears it.
