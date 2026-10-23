import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

const TRANSIENT_HTTP_CODES = new Set([429, 502, 503, 504]);

/**
 * Seconds to wait before polling again when the error is transient
 * (a poll rate limit or a 5xx such as the API's 503 with Retry-After),
 * or null when the error is final and should be raised.
 */
function transientRetryAfterSeconds(error: unknown): number | null {
	const err = error as {
		httpCode?: string | number;
		cause?: { response?: { headers?: Record<string, string | string[] | undefined> } };
	};
	const code = Number(err.httpCode);
	if (!TRANSIENT_HTTP_CODES.has(code)) {
		return null;
	}
	const header = err.cause?.response?.headers?.['retry-after'];
	const seconds = Number(Array.isArray(header) ? header[0] : header);
	return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 0;
}

export class DeepRead implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DeepRead',
		name: 'deepRead',
		icon: 'file:deepread.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Process documents with DeepRead — OCR, structured extraction, form fill, PII redaction',
		defaults: {
			name: 'DeepRead',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'deepReadApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'OCR Extract',
						value: 'ocrExtract',
						description: 'Extract text from a PDF or image',
						action: 'Extract text from a document',
					},
					{
						name: 'Structured Extraction',
						value: 'structuredExtract',
						description: 'Extract structured JSON fields using a schema',
						action: 'Extract structured data from a document',
					},
					{
						name: 'Form Fill',
						value: 'formFill',
						description: 'Fill a PDF form with data using AI vision',
						action: 'Fill a PDF form with data',
					},
					{
						name: 'PII Redact',
						value: 'piiRedact',
						description: 'Redact personally identifiable information from a document',
						action: 'Redact PII from a document',
					},
				],
				default: 'ocrExtract',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'The name of the input binary field containing the document',
			},
			{
				displayName: 'Schema',
				name: 'schema',
				type: 'json',
				default: '{\n  "type": "object",\n  "properties": {\n    "vendor": {"type": "string", "description": "Company name"},\n    "total": {"type": "number", "description": "Total amount"},\n    "date": {"type": "string", "description": "Document date"}\n  }\n}',
				description: 'JSON Schema defining the fields to extract',
				displayOptions: {
					show: {
						operation: ['structuredExtract'],
					},
				},
			},
			{
				displayName: 'Form Fields',
				name: 'formFields',
				type: 'json',
				default: '{\n  "full_name": "Jane Smith",\n  "date_of_birth": "1990-03-15"\n}',
				description: 'JSON data to fill into the form',
				displayOptions: {
					show: {
						operation: ['formFill'],
					},
				},
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'options',
				options: [
					{ name: 'Arabic', value: 'ar' },
					{ name: 'Chinese', value: 'zh' },
					{ name: 'English', value: 'en' },
					{ name: 'Hindi', value: 'hi' },
					{ name: 'Spanish', value: 'es' },
				],
				default: 'en',
				description: 'Document language for PII detection',
				displayOptions: {
					show: {
						operation: ['piiRedact'],
					},
				},
			},
			{
				displayName: 'Engine',
				name: 'engine',
				type: 'options',
				options: [
					{
						name: 'Plan Default',
						value: '',
						description: 'Extract on Free and Standard plans, Deep Extract on Enterprise plans',
					},
					{
						name: 'Extract',
						value: 'extract',
						description: 'One OCR pass: Markdown, layout and bounding boxes, plus your fields when you send a schema',
					},
					{
						name: 'Deep Extract',
						value: 'deep-extract',
						description:
							'Two OCR passes, an LLM judge and a second read that checks each extracted field value',
					},
				],
				default: '',
				description:
					'Which engine processes the document (sent as the pipeline field). Every job reports its product: extract or deep-extract. The older names fast and standard still work as aliases.',
				displayOptions: {
					show: {
						operation: ['ocrExtract', 'structuredExtract'],
					},
				},
			},
			{
				displayName: 'Searchable PDF',
				name: 'searchablePdf',
				type: 'boolean',
				default: false,
				description:
					'Whether to also produce a searchable PDF (embedded OCR text layer), returned as a binary output. A Deep Extract add-on on Enterprise plans; the Extract engine does not support it.',
				displayOptions: {
					show: {
						operation: ['ocrExtract', 'structuredExtract'],
					},
				},
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 300,
				description: 'Maximum time to wait for processing to complete',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						operation: ['ocrExtract', 'structuredExtract'],
					},
				},
				options: [
					{
						displayName: 'Bounding Boxes',
						name: 'includeMarkers',
						type: 'boolean',
						default: false,
						description:
							'Whether to locate layout blocks and extracted values on the page (sent as include_markers). Adds a grounding array and a location on each field. Works on both engines and every plan. With Preview on, values can be clicked to highlight their source.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description:
							'A key unique to this request (up to 255 characters). A retry with the same key returns the job the first request created instead of a second one; a different request with the same key is refused with 409.',
					},
					{
						displayName: 'Incognito',
						name: 'incognito',
						type: 'boolean',
						default: false,
						description:
							'Whether to encrypt the document with a single-use key and crypto-shred it the moment the job finishes. No preview link; cannot be combined with Searchable PDF or Reviewer Email. Enterprise plans.',
					},
					{
						displayName: 'Per Page',
						name: 'perPage',
						type: 'boolean',
						default: false,
						description:
							'Whether to add a per-page breakdown (pages array): the Markdown, layout and fields of each page',
					},
					{
						displayName: 'Preview',
						name: 'preview',
						type: 'boolean',
						default: false,
						description:
							'Whether to store page images and return a public preview link. Off unless you turn it on: anyone with the link can open the document. Add Bounding Boxes to locate each value on the page. Always on for Reviewer Email jobs, always off for incognito jobs.',
					},
					{
						displayName: 'Retention (Days)',
						name: 'retentionDays',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 365,
						},
						default: 30,
						description:
							'Delete the document, preview artifacts and extracted results this many days after submission (1 to 365). Enterprise plans.',
					},
					{
						displayName: 'Review Due (Hours)',
						name: 'reviewDueHours',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 8760,
						},
						default: 24,
						description:
							'With Reviewer Email: the review is due this many hours after submission (1 to 8760). When it passes, your Webhook URL receives review.overdue and the review stays open.',
					},
					{
						displayName: 'Review Expiry (Days)',
						name: 'reviewExpiryDays',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 365,
						},
						default: 30,
						description:
							'With Reviewer Email: an unfinished review closes this many days after submission (1 to 365, never later than Retention). Your Webhook URL receives review.expired with the unreviewed data.',
					},
					{
						displayName: 'Reviewer Email',
						name: 'reviewerEmail',
						type: 'string',
						default: '',
						placeholder: 'maria@example.com, sam@example.com',
						description:
							'Have a person review this document in DeepRead: one email, or a team as several emails separated by commas (up to 10). Each reviewer is emailed a link and signs in with a code; the first to complete the review completes it. The node returns when the job completes with review.status pending; the corrected data arrives at your Webhook URL as review.completed. Turns Preview on; cannot be combined with Incognito.',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhookUrl',
						type: 'string',
						default: '',
						placeholder: 'https://your-n8n.example.com/webhook/deepread',
						description:
							'An HTTPS URL (for example an n8n Webhook node) that receives one POST when the job completes or fails, with the same body as the job response, and the review events of a Reviewer Email job. Every delivery is signed with X-DeepRead-Signature. Standard plans and up.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const timeout = this.getNodeParameter('timeout', i, 300) as number;

				const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

				// Determine endpoint and build form data
				let submitUrl: string;
				let pollUrlPrefix: string;
				const formData: Record<string, string> = {};

				if (operation === 'formFill') {
					submitUrl = 'https://api.deepread.tech/v1/form-fill';
					pollUrlPrefix = 'https://api.deepread.tech/v1/form-fill';
					const formFields = this.getNodeParameter('formFields', i) as string;
					formData.form_fields = formFields;
				} else if (operation === 'piiRedact') {
					submitUrl = 'https://api.deepread.tech/v1/pii/redact';
					pollUrlPrefix = 'https://api.deepread.tech/v1/pii';
					const language = this.getNodeParameter('language', i) as string;
					if (language !== 'en') {
						formData.language = language;
					}
				} else {
					submitUrl = 'https://api.deepread.tech/v1/process';
					pollUrlPrefix = 'https://api.deepread.tech/v1/jobs';
					if (operation === 'structuredExtract') {
						const schema = this.getNodeParameter('schema', i) as string;
						formData.schema = typeof schema === 'string' ? schema : JSON.stringify(schema);
					}
					const engine = this.getNodeParameter('engine', i, '') as string;
					if (engine) {
						formData.pipeline = engine;
					}
					const searchablePdf = this.getNodeParameter('searchablePdf', i, false) as boolean;
					if (searchablePdf) {
						// Deep Extract add-on, Enterprise plans.
						formData.searchable_pdf = 'true';
					}
					const options = this.getNodeParameter('options', i, {}) as {
						idempotencyKey?: string;
						includeMarkers?: boolean;
						incognito?: boolean;
						perPage?: boolean;
						preview?: boolean;
						retentionDays?: number;
						reviewDueHours?: number;
						reviewExpiryDays?: number;
						reviewerEmail?: string;
						webhookUrl?: string;
					};
					if (options.idempotencyKey) {
						formData.idempotency_key = options.idempotencyKey;
					}
					// The API reads form fields, so booleans travel as "true"/"false".
					if (options.includeMarkers !== undefined) {
						formData.include_markers = String(options.includeMarkers);
					}
					if (options.incognito !== undefined) {
						formData.incognito = String(options.incognito);
					}
					if (options.perPage !== undefined) {
						formData.per_page = String(options.perPage);
					}
					if (options.preview !== undefined) {
						formData.preview = String(options.preview);
					}
					if (options.retentionDays !== undefined) {
						formData.retention_days = String(options.retentionDays);
					}
					if (options.webhookUrl) {
						formData.webhook_url = options.webhookUrl;
					}
					// Human review: the job completes as usual with review.status
					// "pending"; the reviewed data is delivered to webhook_url later.
					if (options.reviewerEmail) {
						formData.reviewer_email = options.reviewerEmail;
						if (options.reviewDueHours !== undefined) {
							formData.review_due_hours = String(options.reviewDueHours);
						}
						if (options.reviewExpiryDays !== undefined) {
							formData.review_expiry_days = String(options.reviewExpiryDays);
						}
					}
				}

				// Submit document
				const multipartData: Array<{ name: string; value: string | Buffer; options?: { fileName?: string; contentType?: string } }> = [];

				multipartData.push({
					name: 'file',
					value: buffer,
					options: {
						fileName: binaryData.fileName || 'document.pdf',
						contentType: binaryData.mimeType || 'application/pdf',
					},
				});

				for (const [key, value] of Object.entries(formData)) {
					multipartData.push({ name: key, value });
				}

				const submitResponse = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'deepReadApi',
					{
						method: 'POST',
						url: submitUrl,
						body: multipartData,
						headers: { 'Content-Type': 'multipart/form-data' },
						json: true,
					},
				);

				const jobId = submitResponse.id as string;

				// Poll for results
				const startTime = Date.now();
				let delay = 5000;

				while (Date.now() - startTime < timeout * 1000) {
					await sleep(delay);

					let pollResponse: IDataObject;
					try {
						pollResponse = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'deepReadApi',
							{
								method: 'GET',
								url: `${pollUrlPrefix}/${jobId}`,
								json: true,
							},
						);
					} catch (error) {
						// A poll limit (429) or a transient 5xx is not a failed job:
						// wait as long as Retry-After says, or the current delay, and poll again.
						const retryAfter = transientRetryAfterSeconds(error);
						if (retryAfter === null) {
							throw error;
						}
						delay = Math.max(delay, retryAfter * 1000);
						continue;
					}

					if (pollResponse.status === 'completed') {
						const outputItem: INodeExecutionData = { json: pollResponse };

						// If PII redaction, download the redacted file as binary
						if (operation === 'piiRedact' && pollResponse.redacted_file_url) {
							const redactedFile = await this.helpers.httpRequest({
								method: 'GET',
								url: pollResponse.redacted_file_url as string,
								encoding: 'arraybuffer',
							});
							const binaryOutput = await this.helpers.prepareBinaryData(
								Buffer.from(redactedFile as ArrayBuffer),
								binaryData.fileName ? `redacted_${binaryData.fileName}` : 'redacted_document.pdf',
								binaryData.mimeType,
							);
							outputItem.binary = { data: binaryOutput };
						}

						// If form fill, download the filled file as binary
						if (operation === 'formFill' && pollResponse.filled_form_url) {
							const filledFile = await this.helpers.httpRequest({
								method: 'GET',
								url: pollResponse.filled_form_url as string,
								encoding: 'arraybuffer',
							});
							const binaryOutput = await this.helpers.prepareBinaryData(
								Buffer.from(filledFile as ArrayBuffer),
								binaryData.fileName ? `filled_${binaryData.fileName}` : 'filled_form.pdf',
								binaryData.mimeType,
							);
							outputItem.binary = { data: binaryOutput };
						}

						// If a searchable PDF was produced (OCR/structured + searchable_pdf), download it
						const artifacts = pollResponse.artifacts as { searchable_pdf_url?: string } | undefined;
						if (
							(operation === 'ocrExtract' || operation === 'structuredExtract') &&
							artifacts?.searchable_pdf_url
						) {
							const searchableFile = await this.helpers.httpRequest({
								method: 'GET',
								url: artifacts.searchable_pdf_url,
								encoding: 'arraybuffer',
							});
							const searchableBinary = await this.helpers.prepareBinaryData(
								Buffer.from(searchableFile as ArrayBuffer),
								binaryData.fileName
									? `searchable_${binaryData.fileName}`
									: 'searchable_document.pdf',
								'application/pdf',
							);
							outputItem.binary = { ...(outputItem.binary ?? {}), searchablePdf: searchableBinary };
						}

						returnData.push(outputItem);
						break;
					} else if (pollResponse.status === 'failed') {
						let errorMsg = 'Unknown error';
						if (pollResponse.error) {
							errorMsg = typeof pollResponse.error === 'object'
								? (pollResponse.error as { message?: string }).message || JSON.stringify(pollResponse.error)
								: String(pollResponse.error);
						} else if (pollResponse.error_message) {
							errorMsg = String(pollResponse.error_message);
						}
						throw new NodeOperationError(
							this.getNode(),
							`DeepRead processing failed: ${errorMsg}`,
							{ itemIndex: i },
						);
					}

					delay = Math.min(delay * 1.5, 15000);
				}

				if (returnData.length <= i) {
					throw new NodeOperationError(
						this.getNode(),
						`DeepRead processing timed out after ${timeout} seconds`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
				} else {
					throw error;
				}
			}
		}

		return [returnData];
	}
}
