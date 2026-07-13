import path from "node:path";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.resolve(__dirname, "..");

loadEnvConfig(projectDir);

export { projectDir };
