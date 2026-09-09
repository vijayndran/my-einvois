// Cloudflare Worker entry point — the public HTTP surface of the UAT proxy.
//
// Routes (all POST unless noted), JSON in/out:
//   POST /submit   { document: string, format: "JSON"|"XML", codeNumber: string, poll?: boolean }
//                  -> logs in, submits, optionally polls; returns submissionUid,
//                     accepted/rejected docs (with uuid), and status.
//   POST /status   { submissionUid: string }
//                  -> logs in and returns the current submission status.
//   POST /details  { uuid: string }
//                  -> raw LHDN Get Document Details (includes validationResults).
//   POST /diagnose { document, format, codeNumber }
//                  -> submit + poll + fetch details, decoded into plain-English
//                     diagnostics with fix hints (the paid "Diagnose" tier).
//   GET  /health   -> { ok: true, env } (no secrets, no LHDN call)
//
// CORS is locked to ALLOWED_ORIGIN so only your front end can call it.

import {
  MyInvoisClient,
  LhdnApiError,
  type MyInvoisEnv,
  type LoginCredentials,
} from "./lhdn-client.js";
import { prepareForSubmission, looksSigned } from "./signing.js";
import { decodeDocumentDetails } from "./diagnostics.js";

export interface Env {
  MYINVOIS_ENV: string;
  ALLOWED_ORIGIN: string;
  MYINVOIS_CLIENT_ID?: string;
  MYINVOIS_CLIENT_SECRET?: string;
  MYINVOIS_ONBEHALFOF?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, env: env.MYINVOIS_ENV }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/submit") {
        return await handleSubmit(request, env, origin);
      }
      if (request.method === "POST" && url.pathname === "/status") {
        return await handleStatus(request, env, origin);
      }
      if (request.method === "POST" && url.pathname === "/details") {
        return await handleDetails(request, env, origin);
      }
      if (request.method === "POST" && url.pathname === "/diagnose") {
        return await handleDiagnose(request, env, origin);
      }
      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      if (err instanceof LhdnApiError) {
        return json({ error: err.message, status: err.status, details: err.body }, 502, origin);
      }
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, 500, origin);
    }
  },
};

function credentials(env: Env): LoginCredentials {
  if (!env.MYINVOIS_CLIENT_ID || !env.MYINVOIS_CLIENT_SECRET) {
    throw new LhdnApiError(
      "Server is missing MYINVOIS_CLIENT_ID / MYINVOIS_CLIENT_SECRET secrets. " +
        "Set them with `wrangler secret put`.",
      500,
      null
    );
  }
  return {
    clientId: env.MYINVOIS_CLIENT_ID,
    clientSecret: env.MYINVOIS_CLIENT_SECRET,
    onBehalfOf: env.MYINVOIS_ONBEHALFOF,
  };
}

function clientFor(env: Env): MyInvoisClient {
  const which = (env.MYINVOIS_ENV === "prod" ? "prod" : "uat") as MyInvoisEnv;
  return new MyInvoisClient({ env: which });
}

async function handleSubmit(request: Request, env: Env, origin: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    document?: string;
    format?: "JSON" | "XML";
    codeNumber?: string;
    poll?: boolean;
    requireSigned?: boolean;
  } | null;

  if (!body?.document || !body.format || !body.codeNumber) {
    return json({ error: "Body must include document, format, and codeNumber" }, 400, origin);
  }
  if (body.format !== "JSON" && body.format !== "XML") {
    return json({ error: 'format must be "JSON" or "XML"' }, 400, origin);
  }
  // MyInvois sandbox accepts UNSIGNED version 1.0 documents (signature is only
  // validated for v1.1). So we do not hard-block unsigned docs; we only enforce
  // a signature when the caller explicitly asks (requireSigned=true, e.g. when
  // testing the v1.1 signed path). We still report what we detected.
  const signed = looksSigned(body.document, body.format);
  if (body.requireSigned && !signed) {
    return json(
      {
        error:
          "requireSigned=true but no XAdES signature block was detected. " +
          "For v1.1 signature validation the document must be signed.",
      },
      400,
      origin
    );
  }

  const client = clientFor(env);
  const token = await client.login(credentials(env));
  const doc = await prepareForSubmission(body.document, body.format, body.codeNumber);
  const submitResult = await client.submit(token.access_token, [doc]);

  let status = undefined;
  if (body.poll && submitResult.submissionUid) {
    status = await client.pollUntilDone(token.access_token, submitResult.submissionUid);
  }

  return json({ submission: submitResult, status, signed }, 200, origin);
}

async function handleStatus(request: Request, env: Env, origin: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { submissionUid?: string } | null;
  if (!body?.submissionUid) {
    return json({ error: "Body must include submissionUid" }, 400, origin);
  }
  const client = clientFor(env);
  const token = await client.login(credentials(env));
  const status = await client.getSubmission(token.access_token, body.submissionUid);
  return json({ status }, 200, origin);
}

async function handleDetails(request: Request, env: Env, origin: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { uuid?: string } | null;
  if (!body?.uuid) {
    return json({ error: "Body must include uuid" }, 400, origin);
  }
  const client = clientFor(env);
  const token = await client.login(credentials(env));
  const details = await client.getDocumentDetails(token.access_token, body.uuid);
  return json({ details }, 200, origin);
}

// PAID "Diagnose" tier: submit a document, wait for LHDN's verdict, then fetch
// the full document details and decode the raw validationSteps into a clean,
// human-readable list of failures with fix hints. This is the "why did LHDN
// reject me, and how do I fix it" endpoint.
async function handleDiagnose(request: Request, env: Env, origin: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    document?: string;
    format?: "JSON" | "XML";
    codeNumber?: string;
  } | null;

  if (!body?.document || !body.format || !body.codeNumber) {
    return json({ error: "Body must include document, format, and codeNumber" }, 400, origin);
  }
  if (body.format !== "JSON" && body.format !== "XML") {
    return json({ error: 'format must be "JSON" or "XML"' }, 400, origin);
  }

  const client = clientFor(env);
  const token = await client.login(credentials(env));
  const doc = await prepareForSubmission(body.document, body.format, body.codeNumber);
  const submitResult = await client.submit(token.access_token, [doc]);

  // If LHDN rejected it synchronously (structural), surface that as a diagnostic
  // straight away — there's no uuid to fetch details for.
  const accepted = submitResult.acceptedDocuments?.[0];
  const rejected = submitResult.rejectedDocuments?.[0];
  if (!accepted && rejected) {
    return json(
      {
        status: "Invalid",
        valid: false,
        signed: looksSigned(body.document, body.format),
        submissionUid: submitResult.submissionUid,
        diagnostics: [
          {
            message:
              typeof (rejected.error as { message?: string })?.message === "string"
                ? (rejected.error as { message?: string }).message
                : "Document rejected during synchronous validation.",
            severity: "error",
            code: (rejected.error as { code?: string })?.code,
          },
        ],
        raw: submitResult,
      },
      200,
      origin
    );
  }

  if (!accepted) {
    return json({ error: "No document was accepted for processing", raw: submitResult }, 502, origin);
  }

  // Poll to a terminal state, then pull the detailed per-rule results.
  await client.pollUntilDone(token.access_token, submitResult.submissionUid);
  const details = await client.getDocumentDetails(token.access_token, accepted.uuid);
  const diagnosis = decodeDocumentDetails(details);

  return json(
    {
      ...diagnosis,
      submissionUid: submitResult.submissionUid,
      signed: looksSigned(body.document, body.format),
    },
    200,
    origin
  );
}

// ------------------------------- CORS/JSON ---------------------------------

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(payload: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}
