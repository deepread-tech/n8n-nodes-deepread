# n8n-nodes-deepread

This is an [n8n](https://n8n.io) community node for [DeepRead](https://www.deepread.tech) — AI-native document processing with two engines: Extract (one OCR pass) and Deep Extract (two OCR passes, an LLM judge and a second read that checks each extracted field value).

[n8n](https://n8n.io) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

**Quick install** in n8n:
1. Go to **Settings** → **Community Nodes**
2. Click **Install**
3. Enter `n8n-nodes-deepread`
4. Click **Install**

## Operations

The DeepRead node supports four operations, all powered by the same DeepRead API:

### OCR Extract
Extract text from any PDF or image. Returns the raw extracted text, plus a preview URL for the document when the Preview option is on.

Accepted uploads depend on the plan: PDF, PNG and JPEG on Free; TIFF, WebP, BMP, GIF, DOCX and TXT from Standard; office, spreadsheet and HTML formats on Enterprise. Anything that is not a PDF, PNG or JPEG is converted to PDF before the page count, and the page count is what is charged.

### Structured Extraction
Extract typed JSON fields from documents using a custom JSON Schema. The node outputs the full job response. Extracted fields live in the `extraction.fields` array (`$json.extraction.fields`), where each field is an object:
- `key` — the field name from your schema (e.g. `invoice_number`)
- `value` — the extracted value (scalar, object, or array)
- `needs_review` — `true` if the field needs human review
- `review_reason` — explanation when flagged (present only when `needs_review` is `true`)
- `location` — `{page, bounding_box}`, where the value was found (when the Bounding Boxes option is on)

Use this for invoices, receipts, contracts, medical records, insurance claims — any document where you need specific fields.

### Engine and options (OCR Extract and Structured Extraction)

**Engine** picks how the document is processed and is sent as the API's `pipeline` field:
- **Plan Default** — omits the field: Free and Standard plans run Extract, Enterprise plans run Deep Extract
- **Extract** — one OCR pass: Markdown, layout and bounding boxes, plus your fields when you send a schema
- **Deep Extract** — two OCR passes, an LLM judge and a second read that checks each extracted field value

Every job reports its `product` (`extract` or `deep-extract`) and the `pipeline` you asked for. The older names `fast` and `standard` still work as aliases for `extract` and `deep-extract`.

**Searchable PDF** also returns a searchable/selectable PDF as a binary output (`searchablePdf`). It is a Deep Extract add-on on Enterprise plans; the Extract engine does not support it.

**Options** (add the ones you need):
- **Bounding Boxes** — locate layout blocks and extracted values on the page (sent as `include_markers`): a `grounding` array plus a `location` on each field. Works on both engines and every plan
- **Idempotency Key** — a retry with the same key returns the job the first request created instead of a second one; a different request with the same key is refused with `409`
- **Incognito** (Enterprise) — the document is encrypted with a single-use key and crypto-shredded the moment the job finishes. No preview link; cannot be combined with Searchable PDF or Reviewer Email
- **Per Page** — a `pages` array with the Markdown, layout and fields of each page
- **Preview** (default off) — page images and a public preview link. Anyone with the link can open the document, so it exists only when you turn this on. Add Bounding Boxes for click-to-highlight in the preview
- **Retention (Days)** (Enterprise, 1–365) — the document, preview artifacts and extracted results are deleted that many days after submission
- **Reviewer Email**, **Review Due (Hours)**, **Review Expiry (Days)** — have a person review the document in DeepRead; see [Human review](#human-review-reviewer-email)
- **Webhook URL** (Standard and up) — an HTTPS URL that receives the job result and the review events; see [Webhooks](#webhooks)

A feature the plan does not include is refused with `402` and a body naming the plan that has it.

### Human review (Reviewer Email)

Name who reviews and DeepRead runs the review: no review screen, queue or audit trail to build.

- **Reviewer Email** — one email, or a team as several emails separated by commas (up to 10). Any of them can review it; the first to complete the review completes it. Each reviewer is emailed a link when the document is ready and signs in with a code sent to them
- **Review Due (Hours)** — the review is due this many hours after submission (1–8760). When it passes, `review.overdue` is sent and the review stays open
- **Review Expiry (Days)** — an unfinished review closes this many days after submission (1–365, default 30, never later than Retention). `review.expired` is sent with the unreviewed data

The node returns as soon as the job completes, with `review.status` = `pending`, `review.reviewers`, `review.url`, `review.due_at` and `review.expires_at`. The reviewed data arrives later at your **Webhook URL** as `review.completed` (and `review.updated` for every later fix), with the same body as the job plus `review.completed_by`, `review.version` and `review.changes[]` (`{key, previous_value, value, changed_at, changed_by, version}`, one per corrected value). Reviewer Email turns Preview on and cannot be combined with Incognito.

### Form Fill
Fill any PDF form (including scanned, non-editable forms) with your data. AI visually detects fields, semantically maps your JSON data, fills the form, and quality-checks the result. Returns the filled PDF as a binary attachment. Enterprise plans.

Returns:
- `filled_form_url` — URL to the filled PDF
- `fields_detected` — total fields found
- `fields_filled` — fields successfully filled
- `fields_hil_flagged` — fields needing review

### PII Redact
Detect and redact 14 types of PII with irreversible black bars, built for HIPAA/GDPR redaction workflows:
- Names, SSNs, credit cards, emails, phones, addresses
- IPs, DOB, passport numbers, driver's licenses
- Bank accounts, IBANs, URLs, medical record numbers

Returns the redacted PDF as a binary attachment plus a detection report by PII type. Enterprise plans.

Supports 5 languages: English, Chinese, Spanish, Hindi, Arabic.

## Credentials

You need a DeepRead API key:

1. Sign up at [deepread.tech/dashboard](https://www.deepread.tech/dashboard) (free, no credit card) and accept the Terms when asked
2. Get your API key
3. In n8n, create a new **DeepRead API** credential
4. Paste your API key (starts with `sk_live_...`)
5. Click **Test** to verify

**Free:** 2,000 pages a month, resetting on the day you signed up; up to 50 pages per document
**Standard:** prepaid credits — Extract $15, Deep Extract $35 per 1,000 pages; up to 1,000 pages per document; webhooks and blueprints
**Enterprise:** custom pricing; up to 2,000 pages per document; adds PII Redact, Form Fill, Searchable PDF, Incognito, Retention and bring-your-own LLM key

An API key can also carry a monthly spend limit (set in the dashboard). A job that would pass it is refused with `402` and `key_limit_reached`, naming when the limit resets.

## Compatibility

- Tested with n8n 1.0+
- Works in self-hosted and cloud n8n
- Compatible with all standard n8n agent integrations (use as a tool in AI Agent nodes)

## Usage

### Example: Auto-process invoices from email

```
[Gmail Trigger] → [DeepRead: Structured Extraction] → [Google Sheets]
                  Schema: vendor, total, due_date
```

### Example: Redact PII before LLM processing

```
[File Upload] → [DeepRead: PII Redact] → [OpenAI: Analyze]
```

### Example: Auto-fill onboarding forms

```
[Webhook] → [DeepRead: Form Fill] → [Email: Send filled PDF]
            Form fields: full_name, dob, ssn, address
```

### Example: Human review before posting

```
[Dropbox Trigger] → [DeepRead: Structured Extraction] → (job returned, review pending)
                    Reviewer Email: maria@example.com
                    Webhook URL: the Webhook node's URL below

[Webhook: review.completed] → [IF: $json.review.status == "completed"] → [ERP: Post invoice]
```

The node handles all async polling automatically — submit a document, get the result back. No need to manage job IDs or polling logic. A poll that hits the plan's polling limit (`429`) or a transient `503` waits for `Retry-After` and tries again until the Timeout.

### Webhooks

**Webhook URL** (Standard plans and up) delivers one POST when the job completes or fails, with the same body as the job response, and for Reviewer Email jobs the review events `review.completed`, `review.updated`, `review.overdue`, `review.cancelled` and `review.expired`. The event name is in the body as `event` and in the `X-DeepRead-Event` header. Point it at an n8n **Webhook** node to continue the workflow when the review is done.

Every delivery is signed with `X-DeepRead-Signature` (`t=<unix seconds>,v1=<hex>`, an HMAC-SHA256 over `<t>.<raw body>`); read the signing secret at `GET /dashboard/v1/webhooks/secret`.

## Resources

- **DeepRead website**: https://www.deepread.tech
- **Dashboard**: https://www.deepread.tech/dashboard
- **API documentation**: https://www.deepread.tech/docs
- **Demo repo (Python/Node/cURL examples)**: https://github.com/deepread-tech/deepread-demo
- **n8n community nodes documentation**: https://docs.n8n.io/integrations/#community-nodes
- **Report issues**: https://github.com/deepread-tech/n8n-nodes-deepread/issues
- **Email support**: support@deepread.tech

## Version history

### 0.5.0
- Options: Reviewer Email, Review Due (Hours), Review Expiry (Days) — a person reviews the document in DeepRead; the result arrives at the Webhook URL as `review.completed`
- Options: Webhook URL, Bounding Boxes (`include_markers`), Per Page
- Polling waits for `Retry-After` on `429` and transient `5xx` instead of failing the item
- README: plans and limits, Form Fill and PII Redact are Enterprise, key spend limits, review webhooks; Preview no longer claims field locations (that is Bounding Boxes)

### 0.4.1
- Two products: Extract $15 and Deep Extract $35 per 1,000 pages; every job reports its `product`

### 0.4.0
- Preview is off by default, matching the API

### 0.3.0
- Engine selector (Plan Default / Extract / Deep Extract), sent as the `pipeline` field
- Options: Idempotency Key, Incognito, Preview, Retention (Days)
- Searchable PDF described as a Deep Extract add-on on Enterprise plans
- README: plans (Free, Standard credits, Enterprise), file types, signed webhooks

### 0.1.2
- Fix: PII errors now properly extracted from `{code, message}` objects
- Fix: Credential test now uses authenticated endpoint to validate API keys

### 0.1.1
- Fix: Lint errors (icon, alphabetical order, sleep import)

### 0.1.0
- Initial release with 4 operations: OCR Extract, Structured Extraction, Form Fill, PII Redact
- Async polling with exponential backoff
- Binary output for redacted/filled PDFs

## License

[MIT](LICENSE.md)
