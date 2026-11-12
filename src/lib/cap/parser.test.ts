import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseCapXml } from "@/lib/cap/parser";

const namespace = "urn:oasis:names:tc:emergency:cap:1.2";
const info = (language = "fr-FR", extra = "") =>
  "<info><language>" + language + "</language><category>Met</category><event>Inondation</event>" +
  "<responseType>Evacuate</responseType><urgency>Immediate</urgency><severity>Severe</severity>" +
  "<certainty>Observed</certainty><effective>2026-11-12T10:00:00+01:00</effective>" +
  "<expires>2026-11-12T18:00:00+01:00</expires><headline>Alerte inondation</headline>" +
  "<description>Risque de crue dans la zone.</description><instruction>Éloignez-vous des cours d'eau.</instruction>" +
  "<area><areaDesc>Centre-ville</areaDesc><polygon>36.70,4.05 36.71,4.05 36.71,4.06 36.70,4.05</polygon>" +
  "<geocode><valueName>POSTAL</valueName><value>15000</value></geocode></area>" +
  "<parameter><valueName>source</valueName><value>test</value></parameter>" +
  "<resource><resourceDesc>Carte</resourceDesc><mimeType>image/png</mimeType><size>1024</size></resource>" +
  extra + "</info>";

const xml = (body: string, attrs = 'xmlns="' + namespace + '"') =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<alert ' + attrs + ">" +
  "<identifier>flood-001</identifier><sender>alerts@example.dz</sender>" +
  "<sent>2026-11-12T09:30:00+01:00</sent><status>Actual</status>" +
  "<msgType>Alert</msgType><scope>Public</scope>" + body + "</alert>";

describe("parseCapXml", () => {
  it("parses CAP 1.2 and produces a stable repository projection", () => {
    const source = xml(info());
    const result = parseCapXml(source);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.identifier).toBe("flood-001");
    expect(result.data.infos[0].language).toBe("fr-FR");
    expect(result.data.infos[0].areas[0].geocodes[0].value).toBe("15000");
    expect(result.data.repository.severity).toBe("Severe");
    expect(result.data.repository.headlineFr).toBe("Alerte inondation");
    expect(result.data.sourceSha256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(result.data.sourceXml).toBe(source);
  });

  it("preserves multiple language info blocks", () => {
    const result = parseCapXml(xml(info("fr-FR") + info("ar-DZ")));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.infos).toHaveLength(2);
      expect(result.data.repository.headlineAr).toBe("Alerte inondation");
    }
  });

  it("accepts a prefixed CAP namespace", () => {
    const source = '<cap:alert xmlns:cap="' + namespace + '">' +
      "<cap:identifier>x</cap:identifier><cap:sender>s</cap:sender>" +
      "<cap:sent>2026-11-12T09:30:00-00:00</cap:sent><cap:status>Actual</cap:status>" +
      "<cap:msgType>Alert</cap:msgType><cap:scope>Public</cap:scope></cap:alert>";
    expect(parseCapXml(source).success).toBe(true);
  });

  it("requires and validates Update references", () => {
    const missing = parseCapXml(xml(info()).replace("<msgType>Alert</msgType>", "<msgType>Update</msgType>"));
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.issues.some((issue) => issue.code === "CAP_REFERENCES_REQUIRED")).toBe(true);
  });

  it("accepts Cancel without info when it references an earlier message", () => {
    const source = xml("").replace("<msgType>Alert</msgType>", "<msgType>Cancel</msgType>")
      .replace("</scope>", "</scope><references>alerts@example.dz,flood-000,2026-11-12T08:30:00-00:00</references>");
    expect(parseCapXml(source).success).toBe(true);
  });

  it("rejects malformed XML", () => {
    const result = parseCapXml(xml(info()).replace("</alert>", ""));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0].code).toBe("CAP_XML_MALFORMED");
  });

  it("rejects a wrong namespace", () => {
    const result = parseCapXml(xml(info(), 'xmlns="urn:wrong"'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_NAMESPACE_INVALID")).toBe(true);
  });

  it("rejects DTD and custom entity declarations", () => {
    const source = '<!DOCTYPE alert [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' + xml(info());
    const result = parseCapXml(source);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0].code).toBe("CAP_DTD_FORBIDDEN");
  });

  it("enforces the configured byte limit", () => {
    const result = parseCapXml(xml(info()), { maxBytes: 32 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0].code).toBe("CAP_PAYLOAD_TOO_LARGE");
  });

  it("rejects timestamps without an explicit timezone", () => {
    const result = parseCapXml(xml(info()).replace("2026-11-12T09:30:00+01:00", "2026-11-12T09:30:00"));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_DATETIME_INVALID")).toBe(true);
  });

  it("rejects coordinates outside WGS 84 bounds", () => {
    const badInfo = info().replace("36.70,4.05 36.71,4.05 36.71,4.06 36.70,4.05", "95,4 36,4 36,5 95,4");
    const result = parseCapXml(xml(badInfo));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_COORDINATE_OUT_OF_RANGE")).toBe(true);
  });

  it("requires addresses for Private scope", () => {
    const result = parseCapXml(xml(info()).replace("<scope>Public</scope>", "<scope>Private</scope>"));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_ADDRESSES_REQUIRED")).toBe(true);
  });

  it("warns rather than rejects a CAP Alert without info", () => {
    const result = parseCapXml(xml(""));
    expect(result.success).toBe(true);
    if (result.success) expect(result.issues.some((issue) => issue.code === "CAP_INFO_RECOMMENDED")).toBe(true);
  });
  it("rejects impossible calendar dates instead of accepting JavaScript date rollover", () => {
    const result = parseCapXml(xml(info()).replace("2026-11-12T09:30:00+01:00", "2026-02-31T09:30:00+01:00"));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_DATETIME_INVALID")).toBe(true);
  });

  it("rejects CAP categories outside the 1.2 vocabulary", () => {
    const result = parseCapXml(xml(info().replace("<category>Met</category>", "<category>UnknownCategory</category>")));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_CATEGORY_INVALID")).toBe(true);
  });

  it("rejects unsupported response types", () => {
    const result = parseCapXml(xml(info().replace("<responseType>Evacuate</responseType>", "<responseType>Launch</responseType>")));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_RESPONSE_TYPE_INVALID")).toBe(true);
  });

  it("validates timestamps inside CAP references", () => {
    const source = xml(info())
      .replace("<msgType>Alert</msgType>", "<msgType>Update</msgType>")
      .replace("</scope>", "</scope><references>alerts@example.dz,flood-000,2026-02-31T08:30:00-00:00</references>");
    const result = parseCapXml(source);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_DATETIME_INVALID")).toBe(true);
  });

  it("decodes predefined XML entities in human-readable fields", () => {
    const source = xml(info().replace("Risque de crue dans la zone.", "Alerte &amp; sécurité."));
    const result = parseCapXml(source);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.infos[0].description).toBe("Alerte & sécurité.");
  });
  it.each(["flood-alert.xml", "flood-update.xml", "flood-cancel.xml"])("parses the operational fixture %s", (filename) => {
    const source = readFileSync(new URL("./fixtures/" + filename, import.meta.url), "utf8");
    const result = parseCapXml(source, { requirePublicScope: true });
    expect(result.success).toBe(true);
  });

  it("accepts descriptive-only areas and warns when machine-readable geometry is absent", () => {
    const source = xml(info().replace("<polygon>36.70,4.05 36.71,4.05 36.71,4.06 36.70,4.05</polygon>", ""))
      .replace("<geocode><valueName>POSTAL</valueName><value>15000</value></geocode>", "");
    const result = parseCapXml(source);
    expect(result.success).toBe(true);
    if (result.success) expect(result.issues.some((issue) => issue.code === "CAP_AREA_GEOMETRY_MISSING" && issue.severity === "warning")).toBe(true);
  });

  it("requires mimeType on CAP resources", () => {
    const result = parseCapXml(xml(info().replace("<mimeType>image/png</mimeType>", "")));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => (issue.path ?? "").endsWith("/mimeType"))).toBe(true);
  });

  it("does not mistake a commented fake root for the document root", () => {
    const source = xml(info()).replace(
      "?>",
      "?>\n<!-- <alert xmlns=\"" + "urn:wrong" + "\"> -->",
    );
    expect(parseCapXml(source).success).toBe(true);
  });
  it("rejects non-UTF-8 XML declarations", () => {
    const result = parseCapXml(xml(info()).replace("encoding=\"UTF-8\"", "encoding=\"UTF-16\""));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0].code).toBe("CAP_XML_ENCODING_UNSUPPORTED");
  });

  it("rejects XML versions other than 1.0", () => {
    const result = parseCapXml(xml(info()).replace("version=\"1.0\"", "version=\"1.1\""));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0].code).toBe("CAP_XML_VERSION_UNSUPPORTED");
  });
  it("rejects alphabetic UTC designators and positive zero offsets under OASIS CAP 1.2", () => {
    for (const invalid of ["2026-11-12T09:30:00Z", "2026-11-12T09:30:00+00:00"]) {
      const result = parseCapXml(xml(info()).replace("2026-11-12T09:30:00+01:00", invalid));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_DATETIME_INVALID")).toBe(true);
    }
  });

  it("accepts the OASIS UTC representation -00:00", () => {
    const result = parseCapXml(xml(info()).replace("2026-11-12T09:30:00+01:00", "2026-11-12T09:30:00-00:00"));
    expect(result.success).toBe(true);
  });

    it("rejects timezone offsets that are not XML Schema compliant", () => {
      const result = parseCapXml(xml(info()).replace("+01:00", "+0100"));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.issues.some((issue) => issue.code === "CAP_DATETIME_INVALID")).toBe(true);
    });
});
