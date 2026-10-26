/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  ts = require("typescript");
require.extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    f,
  );
const time = require("../lib/course-time.ts");
const slot = (startTime = "07:10", endTime = "08:00", weekday = "Monday") => ({
  startTime,
  endTime,
  weekday,
  location: "",
});
const course = (slots = [slot()]) => ({ name: "早課", professor: "", slots });
test("early and weekend courses normalize without losing precise minutes and expand the visible window", () => {
  const result = time.inspectSchedule([
    course([slot(" 7:10 ", "08:00"), slot("23:58", "23:59", "Sunday")]),
  ]);
  assert.deepEqual(result.problems, []);
  assert.equal(result.courses[0].slots[0].startTime, "07:10");
  assert.deepEqual(result.window, { start: 420, end: 1440 });
  assert.equal(result.days.length, 7);
});
test("move preserves minute offset and duration; boundaries do not shrink courses", () => {
  assert.deepEqual(
    time.changeSlotTime(slot("08:10", "09:00"), "move", 15, {
      start: 480,
      end: 1320,
    }),
    slot("08:25", "09:15"),
  );
  assert.deepEqual(
    time.changeSlotTime(slot("21:10", "22:00"), "move", 30, {
      start: 480,
      end: 1320,
    }),
    slot("21:10", "22:00"),
  );
  assert.deepEqual(
    time.changeSlotTime(slot("08:10", "09:00"), "start", 90, {
      start: 480,
      end: 1320,
    }),
    slot("08:59", "09:00"),
  );
});
test("overlaps remain distinct and adjacent slots are not conflicts", () => {
  const courses = [
    course([slot("09:00", "10:00"), slot("10:00", "11:00")]),
    course([slot("09:30", "09:45")]),
  ];
  assert.equal(time.overlappingSlots(courses).length, 1);
  assert.equal(
    time.inspectSchedule(courses).courses.flatMap((c) => c.slots).length,
    3,
  );
});
test("repairable values survive structural loading, but export requires a fully valid nonempty schedule", () => {
  const broken = [course([slot("08:99", "09:00", "Funday")]), course([])];
  assert.equal(time.isCourseStructure(broken), true);
  assert.equal(time.inspectSchedule(broken).problems.length, 2);
  assert.throws(() => time.exportableCourses(broken), /早課/);
  assert.throws(() => time.exportableCourses([]), /尚無/);
  assert.equal(time.isCourseStructure([{ name: "x", slots: [null] }]), false);
  assert.deepEqual(
    time.exportableCourses([course([slot(" 7:10 ", "08:00")])])[0].slots[0],
    slot(),
  );
  for (const s of [
    slot("08:99", "09:00"),
    slot("24:00", "24:01"),
    slot("10:00", "09:00"),
    slot("09:00", "09:00"),
  ])
    assert.ok(time.slotProblem(s));
});
test("ICS preserves precise times and every valid slot; invalid schedule never becomes a partial or overnight export", () => {
  const { coursesToIcs } = require("../lib/ics.ts");
  const ics = coursesToIcs(
    [course([slot(" 7:10 ", "08:00"), slot("23:58", "23:59", "Sunday")])],
    { from: new Date(2026, 9, 26) },
  );
  assert.match(ics, /DTSTART:20261026T071000/);
  assert.match(ics, /DTEND:20261101T235900/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.throws(
    () => coursesToIcs([course(), course([slot("10:00", "09:00")])]),
    /結束時間/,
  );
});
test("shared overlap placement keeps chained conflicts inside their day columns", () => {
  const placed = time.placeTimeRanges([
    { id: "a", start: 540, end: 600 },
    { id: "b", start: 540, end: 600 },
    { id: "c", start: 570, end: 630 },
  ]);
  assert.deepEqual(
    placed.map((p) => [p.id, p.col, p.cols]),
    [
      ["a", 0, 3],
      ["b", 1, 3],
      ["c", 2, 3],
    ],
  );
});
test("share rejects invalid and empty schedules before any canvas work", async () => {
  const { renderShareCard } = require("../lib/shareCard.ts");
  const labels = { heading: "Test", footer: "Test", weekdays: {} };
  await assert.rejects(
    renderShareCard([course([slot("08:99", "09:00")])], labels),
    /00:00/,
  );
  await assert.rejects(renderShareCard([], labels), /尚無/);
});
test("forms normalize a slot through one operation and keep input unchanged on error", () => {
  const input = slot(" 7:10 ", "08:00");
  assert.deepEqual(time.normalizeSlot(input), { slot: slot(), problem: null });
  assert.equal(input.startTime, " 7:10 ");
  const invalid = time.normalizeSlot(slot("08:99", "09:00"));
  assert.equal(invalid.slot, null);
  assert.match(invalid.problem, /00:00/);
});
test("early boundary preserves duration and the end handle preserves start", () => {
  assert.deepEqual(
    time.changeSlotTime(slot("08:10", "09:00"), "move", -30, {
      start: 480,
      end: 1320,
    }),
    slot("08:00", "08:50"),
  );
  assert.deepEqual(
    time.changeSlotTime(slot("08:10", "09:00"), "end", 15, {
      start: 480,
      end: 1320,
    }),
    slot("08:10", "09:15"),
  );
  assert.deepEqual(
    time.changeSlotTime(slot("08:10", "09:00"), "end", -120, {
      start: 480,
      end: 1320,
    }),
    slot("08:10", "08:11"),
  );
});
