import "server-only";
import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { validateAgainstCapXsd } from "./xsd";

export const CAP_NAMESPACE = "urn:oasis:names:tc:emergency:cap:1.2";
export const DEFAULT_CAP_MAX_BYTES = 1_048_576;

export type CapStatus = "Actual" | "Exercise" | "System" | "Test" | "Draft";
export type CapMessageType = "Alert" | "Update" | "Cancel" | "Ack" | "Error";
export type CapSeverity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
export type CapUrgency = "Immediate" | "Expected" | "Future" | "Past" | "Unknown";
export type CapCertainty = "Observed" | "Likely" | "Possible" | "Unlikely" | "Unknown";

export type CapIssue = {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
};

export type CapParameter = { name: string; value: string };
export type CapGeocode = { valueName: string; value: string };
export type CapArea = {
  description: string;
  polygons: string[][];
  circles: Array<{ latitude: number; longitude: number; radiusKm: number }>;
  geocodes: CapGeocode[];
  altitude: number | null;
  ceiling: number | null;
};
export type CapResource = {
  description: string;
  mimeType: string | null;
  size: number | null;
  uri: string | null;
  dereferencedUri: string | null;
  digest: string | null;
};
export type CapInfo = {
  language: string;
  categories: string[];
  event: string;
  responseTypes: string[];
  urgency: CapUrgency;
  severity: CapSeverity;
  certainty: CapCertainty;
  audience: string | null;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  senderName: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  web: string | null;
  contact: string | null;
  parameters: CapParameter[];
  areas: CapArea[];
  resources: CapResource[];
};
export type NormalizedCapAlert = {
  identifier: string;
  sender: string;
  sent: string;
  sentAt: Date;
  status: CapStatus;
  messageType: CapMessageType;
  scope: "Public" | "Restricted" | "Private";
  source: string | null;
  restriction: string | null;
  addresses: string | null;
  codes: string[];
  note: string | null;
  references: string[];
  incidents: string[];
  infos: CapInfo[];
  sourceXml: string;
  sourceSha256: string;
  sourcePayload: Record<string, unknown>;
  // Repository-ready values derived from the first info block.
  repository: {
    sourceSender: string;
    sourceIdentifier: string;
    severity: CapSeverity;
    urgency: CapUrgency;
    certainty: CapCertainty;
    sentAt: Date;
    effectiveAt: Date | null;
    expiresAt: Date | null;
    headlineFr: string | null;
    descriptionFr: string | null;
    instructionFr: string | null;
    headlineAr: string | null;
    descriptionAr: string | null;
    instructionAr: string | null;
  };
};

export type CapParseResult =
  | { success: true; data: NormalizedCapAlert; issues: CapIssue[] }
  | { success: false; issues: CapIssue[] };

export type ParseCapOptions = {
  maxBytes?: number;
  requirePublicScope?: boolean;
};

const STATUSES = ["Actual", "Exercise", "System", "Test", "Draft"] as const;
const MESSAGE_TYPES = ["Alert", "Update", "Cancel", "Ack", "Error"] as const;
const SCOPES = ["Public", "Restricted", "Private"] as const;
const SEVERITIES = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"] as const;
const URGENCIES = ["Immediate", "Expected", "Future", "Past", "Unknown"] as const;
const CERTAINTIES = ["Observed", "Likely", "Possible", "Unlikely", "Unknown"] as const;
const CATEGORIES = ["Geo", "Met", "Safety", "Security", "Rescue", "Fire", "Health", "Env", "Transport", "Infra", "CBRNE", "Other"] as const;
const RESPONSE_TYPES = ["Shelter", "Evacuate", "Prepare", "Execute", "Avoid", "Monitor", "Assess", "AllClear", "None"] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  allowBooleanAttributes: false,
  htmlEntities: false,
  commentPropName: "#comment",
});

type XmlObject = Record<string, unknown>;

function asRecord(value: unknown): XmlObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as XmlObject
    : {};
}

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as XmlObject;
    if (typeof object["#text"] === "string") return object["#text"].trim();
  }
  return "";
}

function optionalText(value: unknown): string | null {
  const result = textValue(value);
  return result.length ? result : null;
}

function childText(parent: XmlObject, key: string): string {
  return textValue(parent[key]);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  issues: CapIssue[],
): T {
  const text = textValue(value);
  if (allowed.includes(text as T)) return text as T;
  issues.push({
    code: text ? "CAP_ENUM_INVALID" : "CAP_REQUIRED_FIELD",
    message: text ? `Unsupported value "${text}".` : "Required value is missing.",
    path,
    severity: "error",
  });
  return fallback;
}

function parseCapDate(value: unknown, path: string, issues: CapIssue[], required = false): Date | null {
  const raw = optionalText(value);
  if (!raw) {
    if (required) issues.push({ code: "CAP_REQUIRED_FIELD", message: "Required date-time is missing.", path, severity: "error" });
    return null;
  }
  // CAP timestamps must be unambiguous RFC 3339 date-times with an explicit UTC offset.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-])(\d{2}):(\d{2})$/.exec(raw);
  if (!match) {
    issues.push({ code: "CAP_DATETIME_INVALID", message: "Expected an ISO 8601 date-time with seconds and an explicit timezone.", path, severity: "error" });
    return null;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);

  const daysInMonth = month >= 1 && month <= 12
    ? [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    issues.push({ code: "CAP_DATETIME_INVALID", message: "Date-time contains an out-of-range calendar, clock, or timezone component.", path, severity: "error" });
    return null;
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    issues.push({ code: "CAP_DATETIME_INVALID", message: "Date-time cannot be parsed.", path, severity: "error" });
    return null;
  }
  return date;
}

function validateNamespace(xml: string, issues: CapIssue[]): boolean {
  const xmlWithoutComments = xml.replace(/<!--[\s\S]*?-->/g, "");
  const match = /<((?:[A-Za-z_][\w.-]*:)?alert)\b([^>]*)>/.exec(xmlWithoutComments);
  if (!match) {
    issues.push({ code: "CAP_ROOT_MISSING", message: "The XML document must have a CAP alert root element.", path: "/", severity: "error" });
    return false;
  }
  const qualifiedName = match[1];
  const prefix = qualifiedName.includes(":") ? qualifiedName.split(":")[0] : null;
  const attrName = prefix ? "xmlns:" + prefix.replaceAll(".", "\\.") : "xmlns";
  const namespaceMatch = new RegExp(`(?:^|\\s)${attrName.replace(":", "\\:")}\\s*=\\s*["']([^"']+)["']`).exec(match[2]);
  if (!namespaceMatch || namespaceMatch[1] !== CAP_NAMESPACE) {
    issues.push({
      code: "CAP_NAMESPACE_INVALID",
      message: `The alert root must declare the CAP 1.2 namespace ${CAP_NAMESPACE}.`,
      path: "/alert",
      severity: "error",
    });
    return false;
  }
  return true;
}

function parsePairCoordinates(value: unknown, path: string, issues: CapIssue[]): string[] {
  const raw = textValue(value);
  if (!raw) return [];
  const pairs = raw.split(/\s+/).filter(Boolean);
  const parsed: Array<{ lat: number; lon: number }> = [];
  for (const pair of pairs) {
    const pieces = pair.split(",");
    if (pieces.length !== 2 || pieces.some((part) => !part.trim() || !Number.isFinite(Number(part)))) {
      issues.push({ code: "CAP_POLYGON_COORDINATE_INVALID", message: `Invalid coordinate pair "${pair}". Expected latitude,longitude.`, path, severity: "error" });
      continue;
    }
    const lat = Number(pieces[0]);
    const lon = Number(pieces[1]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      issues.push({ code: "CAP_COORDINATE_OUT_OF_RANGE", message: `Coordinate "${pair}" is outside WGS 84 latitude/longitude bounds.`, path, severity: "error" });
    }
    parsed.push({ lat, lon });
  }
  if (parsed.length < 4) {
    issues.push({ code: "CAP_POLYGON_TOO_SMALL", message: "A polygon requires at least four coordinate pairs, including the closing point.", path, severity: "error" });
  } else {
    const first = parsed[0];
    const last = parsed[parsed.length - 1];
    if (first.lat !== last.lat || first.lon !== last.lon) {
      issues.push({ code: "CAP_POLYGON_NOT_CLOSED", message: "The final polygon coordinate must equal the first coordinate.", path, severity: "error" });
    }
  }
  return pairs;
}

function parseArea(value: unknown, infoIndex: number, areaIndex: number, issues: CapIssue[]): CapArea {
  const area = asRecord(value);
  const path = `/alert/info[${infoIndex}]/area[${areaIndex}]`;
  const description = childText(area, "areaDesc");
  if (!description) issues.push({ code: "CAP_REQUIRED_FIELD", message: "areaDesc is required when an area is present.", path: `${path}/areaDesc`, severity: "error" });

  const polygons = asArray(area.polygon).map((polygon, index) =>
    parsePairCoordinates(polygon, `${path}/polygon[${index}]`, issues),
  );

  const circles = asArray(area.circle).flatMap((circle, index) => {
    const raw = textValue(circle);
    const pieces = raw.split(/\s+/);
    if (pieces.length !== 2 || !/^[-+]?\d+(?:\.\d+)?[,]\s*[-+]?\d+(?:\.\d+)?$/.test(pieces[0]) || !Number.isFinite(Number(pieces[1]))) {
      issues.push({ code: "CAP_CIRCLE_INVALID", message: "A circle must contain a latitude,longitude pair and a radius in kilometres.", path: `${path}/circle[${index}]`, severity: "error" });
      return [];
    }
    const [latText, lonText] = pieces[0].split(",");
    const latitude = Number(latText);
    const longitude = Number(lonText);
    const radiusKm = Number(pieces[1]);
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radiusKm <= 0) {
      issues.push({ code: "CAP_CIRCLE_OUT_OF_RANGE", message: "Circle coordinates must be WGS 84 values and radius must be positive.", path: `${path}/circle[${index}]`, severity: "error" });
    }
    return [{ latitude, longitude, radiusKm }];
  });

  const geocodes = asArray(area.geocode).map((item, index) => {
    const code = asRecord(item);
    const valueName = childText(code, "valueName");
    const codeValue = childText(code, "value");
    if (!valueName || !codeValue) {
      issues.push({ code: "CAP_GEOCODE_INVALID", message: "Each geocode requires both valueName and value.", path: `${path}/geocode[${index}]`, severity: "error" });
    }
    return { valueName, value: codeValue };
  });

  if (polygons.length === 0 && circles.length === 0 && geocodes.length === 0) {
    issues.push({ code: "CAP_AREA_GEOMETRY_MISSING", message: "This area has only a textual description; provide polygon, circle, or geocode when machine-readable targeting is required.", path, severity: "warning" });
  }

  const parseOptionalNumber = (key: "altitude" | "ceiling"): number | null => {
    const raw = optionalText(area[key]);
    if (raw === null) return null;
    const number = Number(raw);
    if (!Number.isFinite(number)) {
      issues.push({ code: "CAP_AREA_NUMBER_INVALID", message: `${key} must be numeric.`, path: `${path}/${key}`, severity: "error" });
      return null;
    }
    return number;
  };

  const altitude = parseOptionalNumber("altitude");
  const ceiling = parseOptionalNumber("ceiling");
  if (altitude !== null && ceiling !== null && ceiling < altitude) {
    issues.push({ code: "CAP_ALTITUDE_RANGE_INVALID", message: "ceiling must be greater than or equal to altitude.", path, severity: "error" });
  }

  return { description, polygons, circles, geocodes, altitude, ceiling };
}

function parseResource(value: unknown, infoIndex: number, resourceIndex: number, issues: CapIssue[]): CapResource {
  const resource = asRecord(value);
  const description = childText(resource, "resourceDesc");
  const mimeType = optionalText(resource.mimeType);
  if (!description) issues.push({ code: "CAP_REQUIRED_FIELD", message: "resourceDesc is required when a resource is present.", path: `/alert/info[${infoIndex}]/resource[${resourceIndex}]/resourceDesc`, severity: "error" });
  if (!mimeType) issues.push({ code: "CAP_REQUIRED_FIELD", message: "mimeType is required when a resource is present.", path: `/alert/info[${infoIndex}]/resource[${resourceIndex}]/mimeType`, severity: "error" });
  const rawSize = optionalText(resource.size);
  let size: number | null = null;
  if (rawSize !== null) {
    size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0) {
      issues.push({ code: "CAP_RESOURCE_SIZE_INVALID", message: "Resource size must be a non-negative integer.", path: `/alert/info[${infoIndex}]/resource[${resourceIndex}]/size`, severity: "error" });
      size = null;
    }
  }
  const digest = optionalText(resource.digest);
  if (digest && !/^[a-f\d]{40}$/i.test(digest)) {
    issues.push({ code: "CAP_RESOURCE_DIGEST_INVALID", message: "CAP 1.2 resource digest is expected to be a 40-character SHA-1 hex digest.", path: `/alert/info[${infoIndex}]/resource[${resourceIndex}]/digest`, severity: "warning" });
  }
  return {
    description,
    mimeType,
    size,
    uri: optionalText(resource.uri),
    dereferencedUri: optionalText(resource.derefUri),
    digest,
  };
}

function parseInfo(value: unknown, index: number, issues: CapIssue[]): CapInfo {
  const info = asRecord(value);
  const path = `/alert/info[${index}]`;
  const categories = asArray(info.category).map(textValue).filter(Boolean);
  if (categories.length === 0) issues.push({ code: "CAP_REQUIRED_FIELD", message: "At least one category is required in an info block.", path: path + "/category", severity: "error" });
  for (const category of categories) {
    if (!CATEGORIES.includes(category as typeof CATEGORIES[number])) {
      issues.push({ code: "CAP_CATEGORY_INVALID", message: "Unsupported CAP category " + category + ".", path: path + "/category", severity: "error" });
    }
  }
  const event = childText(info, "event");
  if (!event) issues.push({ code: "CAP_REQUIRED_FIELD", message: "event is required in an info block.", path: path + "/event", severity: "error" });
  if (event.length > 255) issues.push({ code: "CAP_FIELD_TOO_LONG", message: "event exceeds the 255-character application limit.", path: path + "/event", severity: "error" });

  const urgency = enumValue(info.urgency, URGENCIES, "Unknown", `${path}/urgency`, issues);
  const severity = enumValue(info.severity, SEVERITIES, "Unknown", `${path}/severity`, issues);
  const certainty = enumValue(info.certainty, CERTAINTIES, "Unknown", `${path}/certainty`, issues);

  const effectiveDate = parseCapDate(info.effective, `${path}/effective`, issues);
  const onsetDate = parseCapDate(info.onset, `${path}/onset`, issues);
  const expiresDate = parseCapDate(info.expires, `${path}/expires`, issues);
  if (effectiveDate && expiresDate && expiresDate <= effectiveDate) {
    issues.push({ code: "CAP_INFO_TIME_RANGE_INVALID", message: "expires must be later than effective.", path, severity: "error" });
  }
  if (onsetDate && expiresDate && expiresDate <= onsetDate) {
    issues.push({ code: "CAP_INFO_ONSET_RANGE_INVALID", message: "expires must be later than onset.", path, severity: "error" });
  }

  const responseTypes = asArray(info.responseType).map(textValue).filter(Boolean);
  for (const responseType of responseTypes) {
    if (!RESPONSE_TYPES.includes(responseType as typeof RESPONSE_TYPES[number])) {
      issues.push({ code: "CAP_RESPONSE_TYPE_INVALID", message: "Unsupported CAP responseType " + responseType + ".", path: path + "/responseType", severity: "error" });
    }
  }
  const language = optionalText(info.language) ?? "en-US";
  try { Intl.getCanonicalLocales(language); } catch {
    issues.push({ code: "CAP_LANGUAGE_INVALID", message: "Invalid BCP 47 language tag " + language + ".", path: path + "/language", severity: "error" });
  }
  const headline = optionalText(info.headline);
  const description = optionalText(info.description);
  const instruction = optionalText(info.instruction);
  if (headline && headline.length > 500) issues.push({ code: "CAP_FIELD_TOO_LONG", message: "headline exceeds the 500-character application limit.", path: path + "/headline", severity: "error" });
  if (description && description.length > 10000) issues.push({ code: "CAP_FIELD_TOO_LONG", message: "description exceeds the 10,000-character application limit.", path: path + "/description", severity: "error" });
  if (instruction && instruction.length > 10000) issues.push({ code: "CAP_FIELD_TOO_LONG", message: "instruction exceeds the 10,000-character application limit.", path: path + "/instruction", severity: "error" });

  const parameters = asArray(info.parameter).map((item, parameterIndex) => {
    const parameter = asRecord(item);
    const name = childText(parameter, "valueName");
    const parameterValue = childText(parameter, "value");
    if (!name || !parameterValue) {
      issues.push({ code: "CAP_PARAMETER_INVALID", message: "Each parameter requires valueName and value.", path: `${path}/parameter[${parameterIndex}]`, severity: "error" });
    }
    return { name, value: parameterValue };
  });

  return {
    language,
    categories,
    event,
    responseTypes,
    urgency,
    severity,
    certainty,
    audience: optionalText(info.audience),
    effective: effectiveDate?.toISOString() ?? null,
    onset: onsetDate?.toISOString() ?? null,
    expires: expiresDate?.toISOString() ?? null,
    senderName: optionalText(info.senderName),
    headline,
    description,
    instruction,
    web: optionalText(info.web),
    contact: optionalText(info.contact),
    parameters,
    areas: asArray(info.area).map((area, areaIndex) => parseArea(area, index, areaIndex, issues)),
    resources: asArray(info.resource).map((resource, resourceIndex) => parseResource(resource, index, resourceIndex, issues)),
  };
}

function splitReferences(value: unknown): string[] {
  const raw = optionalText(value);
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}

function validateReference(reference: string, index: number, issues: CapIssue[]): void {
  const path = "/alert/references[" + index + "]";
  const parts = reference.split(",");
  if (parts.length !== 3 || !parts[0].trim() || !parts[1].trim()) {
    issues.push({ code: "CAP_REFERENCE_INVALID", message: "Each reference must use sender,identifier,sent format.", path, severity: "error" });
    return;
  }
  if (parts[0].length > 255 || parts[1].length > 255) {
    issues.push({ code: "CAP_REFERENCE_INVALID", message: "Reference sender and identifier must not exceed 255 characters.", path, severity: "error" });
  }
  parseCapDate(parts[2], path + "/sent", issues, true);
}

function makeRepositoryProjection(
  alert: Omit<NormalizedCapAlert, "repository">,
  infos: CapInfo[],
): NormalizedCapAlert["repository"] {
  const fr = infos.find((info) => /^fr(?:-|$)/i.test(info.language));
  const ar = infos.find((info) => /^ar(?:-|$)/i.test(info.language));
  const primary = fr ?? infos[0];
  const parseDate = (value: string | null) => value ? new Date(value) : null;
  return {
    sourceSender: alert.sender,
    sourceIdentifier: alert.identifier,
    severity: primary?.severity ?? "Unknown",
    urgency: primary?.urgency ?? "Unknown",
    certainty: primary?.certainty ?? "Unknown",
    sentAt: alert.sentAt,
    effectiveAt: parseDate(primary?.effective ?? null),
    expiresAt: parseDate(primary?.expires ?? null),
    headlineFr: fr?.headline ?? null,
    descriptionFr: fr?.description ?? null,
    instructionFr: fr?.instruction ?? null,
    headlineAr: ar?.headline ?? null,
    descriptionAr: ar?.description ?? null,
    instructionAr: ar?.instruction ?? null,
  };
}

/**
 * Parse and validate one OASIS CAP 1.2 alert.
 *
 * This function is intentionally side-effect free: it never publishes, sends,
 * fetches external resources, or treats parsing as operational approval.
 */
export function parseCapXml(xml: string, options: ParseCapOptions = {}): CapParseResult {
  const issues: CapIssue[] = [];
  const maxBytes = options.maxBytes ?? Number(process.env.CAP_MAX_PAYLOAD_BYTES ?? DEFAULT_CAP_MAX_BYTES);

  if (typeof xml !== "string" || xml.trim().length === 0) {
    return { success: false, issues: [{ code: "CAP_XML_EMPTY", message: "CAP XML input is empty.", path: "/", severity: "error" }] };
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return { success: false, issues: [{ code: "CAP_MAX_BYTES_INVALID", message: "Configured CAP maximum size must be a positive safe integer.", path: "/", severity: "error" }] };
  }

  const byteLength = Buffer.byteLength(xml, "utf8");
  if (byteLength > maxBytes) {
    return { success: false, issues: [{ code: "CAP_PAYLOAD_TOO_LARGE", message: `CAP XML is ${byteLength} bytes; configured maximum is ${maxBytes} bytes.`, path: "/", severity: "error" }] };
  }

  const declaration = /^\uFEFF?\s*<\?xml\s+([^?]+)\?>/i.exec(xml)?.[1];
  if (declaration) {
    const version = /\bversion\s*=\s*(['"])(.*?)\1/i.exec(declaration)?.[2];
    const encoding = /\bencoding\s*=\s*(['"])(.*?)\1/i.exec(declaration)?.[2];
    if (version && version !== "1.0") {
      return { success: false, issues: [{ code: "CAP_XML_VERSION_UNSUPPORTED", message: "CAP XML must use XML 1.0.", path: "/", severity: "error" }] };
    }
    if (encoding && !/^utf-?8$/i.test(encoding)) {
      return { success: false, issues: [{ code: "CAP_XML_ENCODING_UNSUPPORTED", message: "CAP XML must be supplied as UTF-8 text.", path: "/", severity: "error" }] };
    }
  }

  // DTDs and custom entities are not needed by CAP and create entity-expansion / XXE risk.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    return { success: false, issues: [{ code: "CAP_DTD_FORBIDDEN", message: "DOCTYPE and custom entity declarations are forbidden.", path: "/", severity: "error" }] };
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)) {
    return { success: false, issues: [{ code: "CAP_XML_CONTROL_CHAR", message: "XML contains forbidden control characters.", path: "/", severity: "error" }] };
  }

  const syntax = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (syntax !== true) {
    const error = typeof syntax === "object" ? syntax.err : null;
    return { success: false, issues: [{
      code: "CAP_XML_MALFORMED",
      message: error ? `${error.msg} (line ${error.line}, column ${error.col}).` : "XML is malformed.",
      path: "/",
      severity: "error",
    }] };
  }

  if (!validateNamespace(xml, issues)) return { success: false, issues };

  let document: XmlObject;
  try {
    document = asRecord(parser.parse(xml));
  } catch {
    return { success: false, issues: [{ code: "CAP_XML_PARSE_FAILED", message: "XML parser could not construct the CAP document.", path: "/", severity: "error" }] };
  }

  const root = asRecord(document.alert);
  if (Object.keys(root).length === 0) {
    return { success: false, issues: [{ code: "CAP_ROOT_INVALID", message: "Expected one alert root element.", path: "/", severity: "error" }] };
  }

  const identifier = childText(root, "identifier");
  const sender = childText(root, "sender");
  const sentRaw = childText(root, "sent");
  if (!identifier) issues.push({ code: "CAP_REQUIRED_FIELD", message: "identifier is required.", path: "/alert/identifier", severity: "error" });
  else if (identifier.length > 255) issues.push({ code: "CAP_FIELD_TOO_LONG", message: "identifier exceeds the 255-character application limit.", path: "/alert/identifier", severity: "error" });
  if (!sender) issues.push({ code: "CAP_REQUIRED_FIELD", message: "sender is required.", path: "/alert/sender", severity: "error" });
  else if (sender.length > 255) issues.push({ code: "CAP_FIELD_TOO_LONG", message: "sender exceeds the 255-character application limit.", path: "/alert/sender", severity: "error" });
  const sentAt = parseCapDate(sentRaw, "/alert/sent", issues, true);
  const status = enumValue(root.status, STATUSES, "Draft", "/alert/status", issues);
  const messageType = enumValue(root.msgType, MESSAGE_TYPES, "Alert", "/alert/msgType", issues);
  const scope = enumValue(root.scope, SCOPES, "Private", "/alert/scope", issues);

  const restriction = optionalText(root.restriction);
  const addresses = optionalText(root.addresses);
  if (scope === "Restricted" && !restriction) {
    issues.push({ code: "CAP_RESTRICTION_REQUIRED", message: "Restricted scope requires a restriction description.", path: "/alert/restriction", severity: "error" });
  }
  if (scope === "Private" && !addresses) {
    issues.push({ code: "CAP_ADDRESSES_REQUIRED", message: "Private scope requires recipient addresses.", path: "/alert/addresses", severity: "error" });
  }
  if (options.requirePublicScope && scope !== "Public") {
    issues.push({ code: "CAP_SCOPE_NOT_PUBLIC", message: "This intake endpoint accepts Public CAP messages only.", path: "/alert/scope", severity: "error" });
  }

  const references = splitReferences(root.references);
  references.forEach((reference, index) => validateReference(reference, index, issues));
  if ((messageType === "Update" || messageType === "Cancel") && references.length === 0) {
    issues.push({ code: "CAP_REFERENCES_REQUIRED", message: `${messageType} messages must identify the message(s) they update or cancel.`, path: "/alert/references", severity: "error" });
  }

  const infos = asArray(root.info).map((info, index) => parseInfo(info, index, issues));
  if (messageType === "Alert" && infos.length === 0) {
    issues.push({ code: "CAP_INFO_RECOMMENDED", message: "Alert messages should contain at least one info block.", path: "/alert/info", severity: "warning" });
  }
  if ((messageType === "Cancel" || messageType === "Ack" || messageType === "Error") && infos.length > 0) {
    issues.push({ code: "CAP_INFO_UNEXPECTED", message: `${messageType} messages normally do not contain info blocks; verify the source profile.`, path: "/alert/info", severity: "warning" });
  }

  const errors = issues.some((issue) => issue.severity === "error");
  if (errors || !sentAt || !identifier || !sender) return { success: false, issues };

  const base = {
    identifier,
    sender,
    sent: sentRaw,
    sentAt,
    status,
    messageType,
    scope,
    source: optionalText(root.source),
    restriction,
    addresses,
    codes: asArray(root.code).map(textValue).filter(Boolean),
    note: optionalText(root.note),
    references,
    incidents: splitReferences(root.incidents),
    infos,
    sourceXml: xml,
    sourceSha256: createHash("sha256").update(xml, "utf8").digest("hex"),
    sourcePayload: JSON.parse(JSON.stringify(document)) as Record<string, unknown>,
  };
  const data: NormalizedCapAlert = {
    ...base,
    repository: makeRepositoryProjection(base, infos),
  };
  return { success: true, data, issues };
}
