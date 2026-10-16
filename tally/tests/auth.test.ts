import { describe, expect, it } from "vitest";
import { equalsPlain, hashPassword, passwordVersion, verifyPassword } from "@/lib/auth/password";
import { signSession, verifySession } from "@/lib/auth/token";

describe("auth", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("compares the env password in constant time", () => {
    expect(equalsPlain("tally", "tally")).toBe(true);
    expect(equalsPlain("tally", "tally2")).toBe(false);
  });
  it("signs and verifies sessions, rejects tampering", async () => {
    const t = await signSession({ pv: "abc" });
    expect(await verifySession(t)).toEqual({ pv: "abc" });
    expect(await verifySession(t.slice(0, -2) + "xx")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
  it("password version changes when the password changes", () => {
    expect(passwordVersion(null, "a")).not.toBe(passwordVersion(null, "b"));
    expect(passwordVersion("scrypt$1", "a")).not.toBe(passwordVersion(null, "a"));
  });
});
