# n8n-nodes-deepread

This is an [n8n](https://n8n.io) community node for [DeepRead](https://www.deepread.tech) — AI-native document processing with 97%+ accuracy using multi-model consensus (GPT + Gemini + dual OCR).

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
Extract text from any PDF or image. Returns the raw extracted text plus a preview URL for the document.

### Structured Extraction
Extract typed JSON fields from documents using a custom JSON Schema. The node outputs the full job response. Extracted fields live in the `extraction.fields` array (`$json.extraction.fields`), where each field is an object:
- `key` — the field name from your schema (e.g. `invoice_number`)
- `value` — the extracted value (scalar, object, or array)
- `needs_review` — `true` if the field needs human review
- `review_reason` — explanation when flagged (present only when `needs_review` is `true`)
- `location.page` — page number the value was found on

Use this for invoices, receipts, contracts, medical records, insurance claims — any document where you need specific fields.

### Form Fill
Fill any PDF form (including scanned, non-editable forms) with your data. AI visually detects fields, semantically maps your JSON data, fills the form, and quality-checks the result. Returns the filled PDF as a binary attachment.

Returns:
- `filled_form_url` — URL to the filled PDF
- `fields_detected` — total fields found
- `fields_filled` — fields successfully filled
- `fields_hil_flagged` — fields needing review

### PII Redact
Detect and redact 14 types of PII with irreversible black bars (HIPAA/GDPR ready):
- Names, SSNs, credit cards, emails, phones, addresses
- IPs, DOB, passport numbers, driver's licenses
- Bank accounts, IBANs, URLs, medical record numbers

Returns the redacted PDF as a binary attachment plus a detection report by PII type.

Supports 5 languages: English, Chinese, Spanish, Hindi, Arabic.

## Credentials

You need a DeepRead API key:

1. Sign up at [deepread.tech/dashboard](https://www.deepread.tech/dashboard) (free, no credit card)
2. Get your API key
3. In n8n, create a new **DeepRead API** credential
4. Paste your API key (starts with `sk_live_...`)
5. Click **Test** to verify

**Free tier:** 2,000 pages/month
**Pro:** $99/mo for 50,000 pages
**BYOK:** Connect your own OpenAI/Google/OpenRouter key at [deepread.tech/dashboard/byok](https://www.deepread.tech/dashboard/byok) for zero DeepRead LLM costs and unlimited pages

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

The node handles all async polling automatically — submit a document, get the result back. No need to manage job IDs or polling logic.

## Resources

- **DeepRead website**: https://www.deepread.tech
- **Dashboard**: https://www.deepread.tech/dashboard
- **API documentation**: https://www.deepread.tech/docs
- **Demo repo (Python/Node/cURL examples)**: https://github.com/deepread-tech/deepread-demo
- **n8n community nodes documentation**: https://docs.n8n.io/integrations/#community-nodes
- **Report issues**: https://github.com/deepread-tech/n8n-nodes-deepread/issues
- **Email support**: support@deepread.tech

## Version history

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
