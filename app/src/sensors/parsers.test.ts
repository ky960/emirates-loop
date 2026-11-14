import { describe, expect, it } from "vitest";
import { parseCsc, parseHr, parseIndoorBike, RevCounter } from "./parsers";

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe("CSC", () => {
  it("parses wheel-only (speed mode)", () => {
    const r = parseCsc(dv([0x01, 0x10, 0x00, 0x00, 0x00, 0x00, 0x04]));
    expect(r).toEqual({ wheelRevs: 16, wheelTime: 1024 });
  });
  it("parses crank-only (cadence mode)", () => {
    const r = parseCsc(dv([0x02, 0x05, 0x00, 0x00, 0x08]));
    expect(r).toEqual({ crankRevs: 5, crankTime: 2048 });
  });
  it("parses both", () => {
    const r = parseCsc(dv([0x03, 1, 0, 0, 0, 0, 4, 2, 0, 0, 8]));
    expect(r).toEqual({ wheelRevs: 1, wheelTime: 1024, crankRevs: 2, crankTime: 2048 });
  });
});

describe("RevCounter", () => {
  it("computes rate and handles 16-bit roll-over", () => {
    const c = new RevCounter(65536, 50);
    expect(c.push(65534, 65000, 0)).toBe(0);
    expect(c.push(1, (65000 + 1536) % 65536, 1000)).toBe(3); // 3 revs in 1.5 s
    expect(c.rate).toBeCloseTo(2);
  });
  it("ignores repeated notifications", () => {
    const c = new RevCounter(2 ** 32, 200);
    c.push(10, 100, 0);
    c.push(12, 1124, 1000);
    expect(c.push(12, 1124, 2000)).toBe(0);
    expect(c.rate).toBeCloseTo(2);
    expect(c.lastEvent).toBe(1000);
  });
  it("rejects implausible jumps", () => {
    const c = new RevCounter(2 ** 32, 200);
    c.push(10, 0, 0);
    expect(c.push(5000, 1024, 1000)).toBe(0);
  });
});

describe("Heart rate", () => {
  it("parses uint8 bpm with contact and RR", () => {
    const r = parseHr(dv([0x16, 72, 0x00, 0x04])); // flags: contact supported+detected, RR present
    expect(r.bpm).toBe(72);
    expect(r.contact).toBe(true);
    expect(r.rr[0]).toBeCloseTo(1);
  });
  it("parses uint16 bpm and energy", () => {
    const r = parseHr(dv([0x09, 0x2c, 0x01, 0x10, 0x00]));
    expect(r.bpm).toBe(300);
    expect(r.energyKj).toBe(16);
    expect(r.contact).toBeUndefined();
  });
});

describe("FTMS indoor bike", () => {
  it("parses speed, cadence and power", () => {
    // flags 0x0044: cadence + power present; speed present because bit0 = 0
    const r = parseIndoorBike(dv([0x44, 0x00, 0xb8, 0x0b, 0xa0, 0x00, 0xc8, 0x00]));
    expect(r.kmh).toBeCloseTo(30);
    expect(r.rpm).toBe(80);
    expect(r.watts).toBe(200);
  });
  it("lets the wheel rate fall away once revolutions stop, instead of holding it", () => {
    const c = new RevCounter(2 ** 32, 200);
    c.push(100, 0, 0);
    c.push(104, 1024, 1000); // 4 rev/s
    expect(c.rateAt(1100)).toBeCloseTo(4);
    expect(c.rateAt(2000)).toBeCloseTo(4); // sensors report ~once a second: not overdue yet
    expect(c.rateAt(3000)).toBeCloseTo(4);
    expect(c.rateAt(3500)).toBeCloseTo(1 / 1.5); // 2.5 s with no revolution: falling away
    expect(c.rateAt(5000)).toBeCloseTo(1 / 3);
  });
});
