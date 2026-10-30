import { EngineError } from '../engine.port';
import { blobOf, requestJson, type HttpDeps } from '../http';

export interface VlmRunClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  detail: 'lo' | 'hi' | 'auto';
  environment: 'dev' | 'staging' | 'prod';
}

export type VlmStatus = 'pending' | 'enqueued' | 'running' | 'paused' | 'completed' | 'failed';

export interface VlmPrediction {
  id: string;
  status: VlmStatus;
  response?: unknown;
  fallback?: boolean;
  usage?: { cost_dollars?: number; credits_used?: number; duration_seconds?: number };
}

/**
 * Transport only (vlm-run/implementation-plan V1). Plain fetch, no SDK, so we control every byte
 * that leaves the process. Endpoints per research §1-2:
 *   POST /v1/files, POST /v1/document/generate, GET /v1/predictions/{id}, DELETE /v1/files/{id}
 */
export class VlmRunClient {
  constructor(
    private readonly cfg: VlmRunClientConfig,
    private readonly http: HttpDeps,
  ) {}

  async uploadFile(bytes: Buffer, filename: string, mimeType: string): Promise<{ fileId: string }> {
    const form = new FormData();
    form.append('file', blobOf(bytes, mimeType), filename);
    const res = await requestJson<{ id?: string; file_id?: string }>(
      this.http,
      `${this.cfg.baseUrl}/v1/files`,
      {
        method: 'POST',
        headers: this.headers(),
        body: form,
      },
    );
    const fileId = res.id ?? res.file_id;
    if (!fileId) throw new EngineError('vlmrun', 'NO_FILE_ID', false);
    return { fileId };
  }

  generate(req: {
    fileId: string;
    jsonSchema: object;
    domain: string;
    pageIndices?: number[];
  }): Promise<VlmPrediction> {
    return requestJson<VlmPrediction>(this.http, `${this.cfg.baseUrl}/v1/document/generate`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(this.generateBody(req)),
    });
  }

  /** Exposed for tests: the privacy flags below must never flip (research §6.3). */
  generateBody(req: { fileId: string; jsonSchema: object; domain: string; pageIndices?: number[] }) {
    // Official generate shape: file_id + domain + model. json_schema overrides the hub model.
    return {
      file_id: req.fileId,
      model: this.cfg.model,
      domain: req.domain,
      batch: true,
      config: {
        json_schema: flattenNullableTypes(req.jsonSchema),
        grounding: true,
        confidence: true,
        detail: this.cfg.detail,
        temperature: 0,
        ...(req.pageIndices ? { page_indices: req.pageIndices } : {}),
      },
      // Vendor defaults are all true. PHI must never be logged, trained on or retained.
      metadata: {
        allow_logging: false,
        allow_training: false,
        allow_retention: false,
        environment: this.cfg.environment,
      },
    };
  }

  getPrediction(id: string): Promise<VlmPrediction> {
    return requestJson<VlmPrediction>(
      this.http,
      `${this.cfg.baseUrl}/v1/predictions/${encodeURIComponent(id)}`,
      { method: 'GET', headers: this.headers() },
    );
  }

  async deleteFile(fileId: string): Promise<void> {
    await requestJson<unknown>(
      this.http,
      `${this.cfg.baseUrl}/v1/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
        headers: this.headers(),
      },
    );
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.cfg.apiKey}`, accept: 'application/json' };
  }
}

/** Hub domain required by /v1/document/generate when no skill is set. json_schema still wins. */
export function vlmDomainFor(formId: string): string {
  switch (formId) {
    case 'CMS1500':
    case 'UB04':
      return 'healthcare.claims-processing';
    case 'PATIENT_INTAKE':
    case 'INSURANCE_CARD':
      return 'healthcare.patient-identification';
    case 'BOOKING_SHEET':
      return 'healthcare.physician-order';
    default:
      return 'document.invoice';
  }
}

/** VLM Run's schema validator rejects JSON Schema union types like ["string","null"]. */
export function flattenNullableTypes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(flattenNullableTypes);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t) => t !== 'null');
      out.type = types.length === 1 ? types[0] : types;
      continue;
    }
    out[key] = flattenNullableTypes(value);
  }
  return out;
}
