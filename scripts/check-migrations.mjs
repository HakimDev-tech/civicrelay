import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const directory = join(root, "drizzle");
const files = (await readdir(directory))
  .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
  .sort();
const journal = JSON.parse(await readFile(join(directory, "meta", "_journal.json"), "utf8"));
const entries = journal.entries;

if (entries.length !== files.length) {
  throw new Error("Drizzle journal and SQL migration count differ.");
}

for (const [index, filename] of files.entries()) {
  const tag = filename.replace(/\.sql$/i, "");
  const entry = entries[index];
  if (entry.idx !== index || entry.tag !== tag || entry.dialect !== undefined && entry.dialect !== "postgresql") {
    throw new Error("Drizzle journal entry " + index + " does not match " + filename + ".");
  }
}

console.log("Migration journal is consistent (" + files.length + " SQL migrations).");
