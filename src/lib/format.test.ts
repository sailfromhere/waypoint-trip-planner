import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { parseTime24, defaultNewDayDate } from "./format";

test("parseTime24: colon forms normalize to HH:MM 24h", () => {
  assert.equal(parseTime24("9:30"), "09:30");
  assert.equal(parseTime24("09:30"), "09:30");
  assert.equal(parseTime24("21:5"), "21:05");
  assert.equal(parseTime24("13:00"), "13:00");
  assert.equal(parseTime24("0:0"), "00:00");
});

test("parseTime24: bare digits — 1–2 = hour, 3–4 = HMM/HHMM", () => {
  assert.equal(parseTime24("9"), "09:00");
  assert.equal(parseTime24("09"), "09:00");
  assert.equal(parseTime24("930"), "09:30");
  assert.equal(parseTime24("0930"), "09:30");
  assert.equal(parseTime24("2130"), "21:30");
});

test("parseTime24: blank and out-of-range / garbage → null", () => {
  assert.equal(parseTime24(""), null);
  assert.equal(parseTime24("   "), null);
  assert.equal(parseTime24("24:00"), null); // hour > 23
  assert.equal(parseTime24("12:60"), null); // minute > 59
  assert.equal(parseTime24("999"), null); // 9:99 → minute > 59
  assert.equal(parseTime24("abc"), null);
  assert.equal(parseTime24("9:30pm"), null); // no 12h/suffix support
});

test("parseTime24: trims surrounding whitespace", () => {
  assert.equal(parseTime24("  9:30  "), "09:30");
});

test("defaultNewDayDate: empty itinerary → today (local)", () => {
  assert.equal(defaultNewDayDate([]), DateTime.now().toISODate());
  // Items present but none dated → still today.
  assert.equal(
    defaultNewDayDate([{ date: null }, { date: null }]),
    DateTime.now().toISODate()
  );
});

test("defaultNewDayDate: dated items → day after the latest", () => {
  assert.equal(
    defaultNewDayDate([{ date: "2026-08-01" }, { date: "2026-08-03" }, { date: "2026-08-02" }]),
    "2026-08-04"
  );
  // Month rollover.
  assert.equal(defaultNewDayDate([{ date: "2026-08-31" }]), "2026-09-01");
  // Mixed null + dated.
  assert.equal(
    defaultNewDayDate([{ date: null }, { date: "2026-12-31" }]),
    "2027-01-01"
  );
});
