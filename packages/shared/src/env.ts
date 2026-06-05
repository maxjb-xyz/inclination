/** Tiny typed environment reader used by the Node services. */

export function requireEnv(name: string, source: NodeJS.ProcessEnv = process.env): string {
  const value = source[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function envOrDefault(
  name: string,
  fallback: string,
  source: NodeJS.ProcessEnv = process.env,
): string {
  const value = source[name];
  return value === undefined || value === "" ? fallback : value;
}

export function envInt(
  name: string,
  fallback: number,
  source: NodeJS.ProcessEnv = process.env,
): number {
  const raw = source[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  }
  return parsed;
}

export function envBool(
  name: string,
  fallback: boolean,
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = source[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}
