import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

export interface MockOidc {
  issuer: string;
  clientId: string;
  clientSecret: string;
  subject: string;
  email: string;
  name: string;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

/**
 * Minimal standards-compliant OIDC provider for tests: discovery, authorize
 * (auto-approve), token (RS256-signed id_token), and JWKS. Lets the real
 * OidcService run its full discovery + code-exchange + signature-verification
 * path against a controllable issuer.
 */
export async function startMockOidc(): Promise<MockOidc> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "mock-key-1";
  const clientId = "test-client";
  const clientSecret = "test-secret";
  const subject = "oidc-subject-123";
  const email = "oidc-user@example.com";
  const name = "OIDC User";
  const codes = new Set<string>();
  let codeCounter = 0;
  let issuer = "http://127.0.0.1";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://placeholder");
    const path = url.pathname;

    if (path === "/.well-known/openid-configuration") {
      sendJson(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
      return;
    }
    if (path === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state") ?? "";
      if (!redirectUri) return sendJson(res, 400, { error: "missing redirect_uri" });
      const code = `code-${++codeCounter}`;
      codes.add(code);
      const location = `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}`;
      res.writeHead(302, { location });
      res.end();
      return;
    }
    if (path === "/token" && req.method === "POST") {
      void readBody(req).then((body) => {
        const params = new URLSearchParams(body);
        const code = params.get("code");
        if (!code || !codes.has(code)) {
          return sendJson(res, 400, { error: "invalid_grant" });
        }
        codes.delete(code);
        const idToken = jwt.sign({ email, email_verified: true, name }, privateKey, {
          algorithm: "RS256",
          keyid: kid,
          subject,
          audience: clientId,
          issuer,
          expiresIn: 300,
        });
        sendJson(res, 200, { id_token: idToken, access_token: "mock-access", token_type: "Bearer" });
      });
      return;
    }
    if (path === "/jwks") {
      const jwk = publicKey.export({ format: "jwk" });
      sendJson(res, 200, { keys: [{ ...jwk, kid, use: "sig", alg: "RS256" }] });
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  issuer = `http://127.0.0.1:${port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    subject,
    email,
    name,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
