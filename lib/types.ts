export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type CourseSlot = {
  weekday: Weekday;
  startTime: string;
  endTime: string;
  location: string;
};

export type Course = {
  name: string;
  professor: string;
  slots: CourseSlot[];
};
