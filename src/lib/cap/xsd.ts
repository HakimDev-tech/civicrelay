import "server-only";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { XmlDocument, XmlValidateError, XsdValidator } from "libxml2-wasm";

let schemaDocument: XmlDocument | undefined;
let validator: XsdValidator | undefined;

function getValidator(): XsdValidator {
  if (validator) return validator;

  const schemaPath = fileURLToPath(new URL("./schema/CAP-v1.2.xsd", import.meta.url));
  const schemaSource = readFileSync(schemaPath, "utf8");
  schemaDocument = XmlDocument.fromString(schemaSource);

  try {
    validator = XsdValidator.fromDoc(schemaDocument);
    return validator;
  } catch (error) {
    schemaDocument.dispose();
    schemaDocument = undefined;
    throw error;
  }
}

/** Validates a CAP XML document against the unmodified OASIS CAP 1.2 XSD. */
export function validateAgainstCapXsd(xml: string): string[] {
  const capValidator = getValidator();
  const document = XmlDocument.fromString(xml);

  try {
    capValidator.validate(document);
    return [];
  } catch (error) {
    if (error instanceof XmlValidateError) {
      return error.message
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 20);
    }
    throw error;
  } finally {
    document.dispose();
  }
}
