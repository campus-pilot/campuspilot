import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  it("matches the known vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches node:crypto across padding boundaries and multi-byte text", () => {
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const text = "a".repeat(length);
      expect(sha256Hex(text)).toBe(
        createHash("sha256").update(text).digest("hex"),
      );
    }
    const hindi = "समीकरण 2x+3=11 का हल है:";
    expect(sha256Hex(hindi)).toBe(
      createHash("sha256").update(hindi).digest("hex"),
    );
  });
});
