import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const indexPath = path.join(root, "lib", "api-zod", "src", "index.ts");

writeFileSync(indexPath, 'export * from "./generated/api";\n', "utf8");
