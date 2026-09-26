import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name} (see .env.example)`);
  return value;
}
