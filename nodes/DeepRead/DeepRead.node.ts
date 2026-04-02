import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

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
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 300,
				description: 'Maximum time to wait for processing to complete',
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
				const formData: Record<string, unknown> = {};

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
					multipartData.push({ name: key, value: value as string });
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

					const pollResponse = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'deepReadApi',
						{
							method: 'GET',
							url: `${pollUrlPrefix}/${jobId}`,
							json: true,
						},
					);

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

						returnData.push(outputItem);
						break;
					} else if (pollResponse.status === 'failed') {
						throw new NodeOperationError(
							this.getNode(),
							`DeepRead processing failed: ${pollResponse.error || pollResponse.error_message || 'Unknown error'}`,
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
