import assert from "node:assert/strict";
import test from "node:test";
import { decodeBase64Image, leadIdFromImagesPath, sniffLeadImage } from "./lead-images.ts";

function bytes(...values: number[]): Uint8Array {
  const out = new Uint8Array(16);
  values.forEach((value, index) => {
    out[index] = value;
  });
  return out;
}

test("lead images accept png, jpeg, and webp and reject other bytes", () => {
  assert.equal(sniffLeadImage(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0)), "image/png");
  assert.equal(sniffLeadImage(bytes(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0)), "image/jpeg");
  assert.equal(
    sniffLeadImage(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)),
    "image/webp"
  );
  assert.equal(sniffLeadImage(bytes(0x47, 0x49, 0x46, 0x38)), null);
  assert.equal(leadIdFromImagesPath("/api/assistant/leads/11111111-1111-4111-8111-111111111111/images"), "11111111-1111-4111-8111-111111111111");
  assert.equal(leadIdFromImagesPath("/api/assistant/leads/nope/images"), null);
  const png = Buffer.from(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0)).toString("base64");
  const decoded = decodeBase64Image(png);
  assert.equal(decoded ? sniffLeadImage(decoded) : null, "image/png");
});
