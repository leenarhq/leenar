import { describe, it, expect } from "vitest";
import { toSqlLiteral } from "./sqlLiteral";

describe("toSqlLiteral", () => {
  it("encodes null as NULL", () => {
    expect(toSqlLiteral(null)).toBe("NULL");
  });

  it("encodes undefined as NULL", () => {
    expect(toSqlLiteral(undefined)).toBe("NULL");
  });

  it("encodes true as TRUE", () => {
    expect(toSqlLiteral(true)).toBe("TRUE");
  });

  it("encodes false as FALSE", () => {
    expect(toSqlLiteral(false)).toBe("FALSE");
  });

  it("encodes a plain number", () => {
    expect(toSqlLiteral(42)).toBe("42");
  });

  it("encodes a negative/decimal number", () => {
    expect(toSqlLiteral(-3.5)).toBe("-3.5");
  });

  it("throws on NaN", () => {
    expect(() => toSqlLiteral(NaN)).toThrow();
  });

  it("throws on Infinity", () => {
    expect(() => toSqlLiteral(Infinity)).toThrow();
  });

  it("throws on -Infinity", () => {
    expect(() => toSqlLiteral(-Infinity)).toThrow();
  });

  it("encodes a bigint", () => {
    expect(toSqlLiteral(10n)).toBe("10");
  });

  it("escapes a single quote in a string (O'Brien)", () => {
    expect(toSqlLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it("does not treat a semicolon/DROP as a second statement — still one literal", () => {
    expect(toSqlLiteral("a;DROP")).toBe("'a;DROP'");
  });

  it("leaves backslashes literal (standard_conforming_strings)", () => {
    expect(toSqlLiteral("a\\b")).toBe("'a\\b'");
  });

  it("encodes a plain string with no special characters", () => {
    expect(toSqlLiteral("hello")).toBe("'hello'");
  });

  it("encodes an object as JSONB text", () => {
    expect(toSqlLiteral({ a: 1 })).toBe("'{\"a\":1}'");
  });

  it("escapes single quotes inside JSON-encoded objects", () => {
    expect(toSqlLiteral({ name: "O'Brien" })).toBe(
      `'${JSON.stringify({ name: "O'Brien" }).replace(/'/g, "''")}'`,
    );
  });

  it("encodes an array as JSONB text", () => {
    expect(toSqlLiteral([1, 2, 3])).toBe("'[1,2,3]'");
  });

  it("throws on a symbol", () => {
    expect(() => toSqlLiteral(Symbol("x"))).toThrow(
      /Unsupported SQL literal type: symbol/,
    );
  });

  it("throws on a function", () => {
    expect(() => toSqlLiteral(() => {})).toThrow(
      /Unsupported SQL literal type: function/,
    );
  });
});
