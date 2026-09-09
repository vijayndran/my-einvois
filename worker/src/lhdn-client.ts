// LHDN MyInvois API client — the login -> submit -> poll pipeline.
//
// This runs inside a Cloudflare Worker (server-side), which is what makes it
// possible at all: the browser cannot call these endpoints (no CORS headers
// from LHDN) and must not hold the client_secret. The Worker holds the secret,
// speaks server-to-server to LHDN, and returns clean JSON to the front end.
//
// Contract confirmed against the official SDK:
//   Login:  POST {identity}/connect/token   (OAuth2 client_credentials)
//   Submit: POST {api}/api/v1.0/documentsubmissions/  -> 202 { submissionUid,
//           acceptedDocuments:[{ uuid, invoiceCodeNumber }], rejectedDocuments }
//   Poll:   GET  {api}/api/v1.0/documentsubmissions/{submissionUid}
//
// Sizes: <=300 KB per document, <=5 MB per submission, <=100 docs per batch.

export type MyInvoisEnv = "uat" | "prod";

export interface EnvBaseUrls {
  /** Identity service base (the /connect/token host). */
  identity: string;
  /** e-Invoice API base (the /api/v1.0/... host). */
  api: string;
}

// In MyInvois both identity and API are served from the same host per
// environment; kept as separate fields so prod/UAT (or a future split) is easy.
export const BASE_URLS: Record<MyInvoisEnv, EnvBaseUrls> = {
  uat: {
    identity: "https://preprod-api.myinvois.hasil.gov.my",
    api: "https://preprod-api.myinvois.hasil.gov.my",
  },
  prod: {
    identity: "https://api.myinvois.hasil.gov.my",
    api: "https://api.myinvois.hasil.gov.my",
  },
};

export interface LoginCredentials {
  clientId: string;
  clientSecret: string;
  /** Optional: taxpayer TIN when logging in as an intermediary on their behalf. */
  onBehalfOf?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface SubmissionDocument {
  /** "JSON" or "XML" — must match the actual encoded document. */
  format: "JSON" | "XML";
  /** Base64 of the (signed) document bytes. */
  document: string;
  /** Lowercase hex SHA-256 of the raw (pre-base64) document bytes. */
  documentHash: string;
  /** Supplier's internal reference number, echoed back for mapping. */
  codeNumber: string;
}

export interface AcceptedDocument {
  uuid: string;
  invoiceCodeNumber: string;
}

export interface RejectedDocument {
  invoiceCodeNumber: string;
  error: unknown;
}

export interface SubmitResponse {
  submissionUid: string;
  acceptedDocuments: AcceptedDocument[];
  rejectedDocuments: RejectedDocument[];
}

export interface SubmissionStatus {
  submissionUid: string;
  /** "InProgress" | "Valid" | "Invalid" | "PartiallyValid" (LHDN vocabulary). */
  overallStatus: string;
  documentCount?: number;
  documentSummary?: unknown[];
  [k: string]: unknown;
}

/** Thrown for any non-success HTTP response; carries status + parsed body. */
export class LhdnApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "LhdnApiError";
  }
}

export interface ClientOptions {
  env: MyInvoisEnv;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class MyInvoisClient {
  private readonly urls: EnvBaseUrls;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.urls = BASE_URLS[opts.env];
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /** OAuth2 client_credentials login. Returns the token response. */
  async login(creds: LoginCredentials): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "client_credentials",
      scope: "InvoicingAPI",
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    // Intermediary-on-behalf-of a taxpayer uses this header on login.
    if (creds.onBehalfOf) headers["onbehalfof"] = creds.onBehalfOf;

    const res = await this.fetchImpl(`${this.urls.identity}/connect/token`, {
      method: "POST",
      headers,
      body: body.toString(),
    });

    const parsed = await safeJson(res);
    if (!res.ok) {
      throw new LhdnApiError(`Login failed (HTTP ${res.status})`, res.status, parsed);
    }
    return parsed as TokenResponse;
  }

  /**
   * Submit one or more signed documents. Returns 202 with submissionUid and the
   * accepted/rejected breakdown. Enforces LHDN's size/count limits client-side
   * so we fail fast with a clear message instead of a generic 400.
   */
  async submit(accessToken: string, documents: SubmissionDocument[]): Promise<SubmitResponse> {
    if (documents.length === 0) {
      throw new LhdnApiError("No documents to submit", 400, null);
    }
    if (documents.length > 100) {
      throw new LhdnApiError("Batch exceeds 100 documents", 400, null);
    }
    for (const d of documents) {
      const bytes = base64ByteLength(d.document);
      if (bytes > 300 * 1024) {
        throw new LhdnApiError(`Document ${d.codeNumber} exceeds 300 KB`, 400, null);
      }
    }

    const payload = JSON.stringify({ documents });
    if (byteLength(payload) > 5 * 1024 * 1024) {
      throw new LhdnApiError("Submission exceeds 5 MB", 400, null);
    }

    const res = await this.fetchImpl(`${this.urls.api}/api/v1.0/documentsubmissions/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: payload,
    });

    const parsed = await safeJson(res);
    // 202 Accepted is the success code here (async validation still pending).
    if (res.status !== 202 && !res.ok) {
      throw new LhdnApiError(`Submit failed (HTTP ${res.status})`, res.status, parsed);
    }
    return parsed as SubmitResponse;
  }

  /** Fetch the current status of a submission by its submissionUid. */
  async getSubmission(accessToken: string, submissionUid: string): Promise<SubmissionStatus> {
    const res = await this.fetchImpl(
      `${this.urls.api}/api/v1.0/documentsubmissions/${encodeURIComponent(submissionUid)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const parsed = await safeJson(res);
    if (!res.ok) {
      throw new LhdnApiError(`Get submission failed (HTTP ${res.status})`, res.status, parsed);
    }
    return parsed as SubmissionStatus;
  }

  /**
   * Poll getSubmission until the overall status is terminal (not "InProgress")
   * or attempts run out. Returns the last status seen.
   */
  async pollUntilDone(
    accessToken: string,
    submissionUid: string,
    opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
  ): Promise<SubmissionStatus> {
    const attempts = opts.attempts ?? 6;
    const delayMs = opts.delayMs ?? 3000;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    let last: SubmissionStatus | undefined;
    for (let i = 0; i < attempts; i++) {
      last = await this.getSubmission(accessToken, submissionUid);
      if (last.overallStatus && last.overallStatus.toLowerCase() !== "inprogress") {
        return last;
      }
      if (i < attempts - 1) await sleep(delayMs);
    }
    return last!;
  }
}

// --------------------------- helpers ---------------------------------------

/** Lowercase hex SHA-256 of a UTF-8 string, via WebCrypto (available in Workers). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64 of a UTF-8 string (Worker/Node compatible). */
export function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Byte length of a UTF-8 string. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Decoded byte length represented by a base64 string (no full decode). */
export function base64ByteLength(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return (len * 3) / 4 - padding;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
