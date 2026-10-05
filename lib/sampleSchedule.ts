import type { Course, CourseSlot } from "@/lib/types";

const sampleSlots: CourseSlot[] = [
  { weekday: "Monday", startTime: "09:00", endTime: "12:00", location: "" },
  { weekday: "Tuesday", startTime: "13:00", endTime: "15:00", location: "" },
  { weekday: "Wednesday", startTime: "10:00", endTime: "12:00", location: "" },
  { weekday: "Thursday", startTime: "14:00", endTime: "17:00", location: "" },
  { weekday: "Friday", startTime: "10:00", endTime: "12:00", location: "" },
];

type SampleCopy = {
  name: string;
  professor: string;
  location: string;
};

const zhTW: SampleCopy[] = [
  { name: "微積分", professor: "王教授", location: "綜二 302" },
  { name: "資料結構", professor: "林教授", location: "資電館 101" },
  { name: "線性代數", professor: "陳教授", location: "工學院 205" },
  { name: "普通物理實驗", professor: "張教授", location: "物理系館 102" },
  { name: "通識哲學思考", professor: "李教授", location: "博雅 101" },
];

const zhCN: SampleCopy[] = [
  { name: "微积分", professor: "王教授", location: "综二 302" },
  { name: "数据结构", professor: "林教授", location: "资电馆 101" },
  { name: "线性代数", professor: "陈教授", location: "工学院 205" },
  { name: "普通物理实验", professor: "张教授", location: "物理系馆 102" },
  { name: "通识哲学思考", professor: "李教授", location: "博雅 101" },
];

const ja: SampleCopy[] = [
  { name: "微積分学", professor: "王教授", location: "第2総合棟 302" },
  { name: "データ構造", professor: "林教授", location: "情報電子棟 101" },
  { name: "線形代数", professor: "陳教授", location: "工学部棟 205" },
  { name: "物理学実験", professor: "張教授", location: "物理学科棟 102" },
  { name: "教養哲学", professor: "李教授", location: "教養棟 101" },
];

const ko: SampleCopy[] = [
  { name: "미적분학", professor: "왕 교수", location: "제2종합관 302" },
  { name: "자료구조", professor: "임 교수", location: "정보전자관 101" },
  { name: "선형대수학", professor: "진 교수", location: "공학관 205" },
  { name: "일반물리학실험", professor: "장 교수", location: "물리학관 102" },
  { name: "철학적사고", professor: "이 교수", location: "교양관 101" },
];

const es: SampleCopy[] = [
  { name: "Cálculo", professor: "Prof. Wang", location: "Edificio 302" },
  { name: "Estructuras de Datos", professor: "Prof. Lin", location: "Informática 101" },
  { name: "Álgebra Lineal", professor: "Prof. Chen", location: "Ingeniería 205" },
  { name: "Laboratorio de Física", professor: "Prof. Zhang", location: "Física 102" },
  { name: "Pensamiento Filosófico", professor: "Prof. Li", location: "Humanidades 101" },
];

const fr: SampleCopy[] = [
  { name: "Calcul Différentiel", professor: "Prof. Wang", location: "Bâtiment 302" },
  { name: "Structures de Données", professor: "Prof. Lin", location: "Info 101" },
  { name: "Algèbre Linéaire", professor: "Prof. Chen", location: "Ingénierie 205" },
  { name: "TP de Physique", professor: "Prof. Zhang", location: "Physique 102" },
  { name: "Pensée Philosophique", professor: "Prof. Li", location: "Lettres 101" },
];

const de: SampleCopy[] = [
  { name: "Analysis", professor: "Prof. Wang", location: "Gebäude 302" },
  { name: "Datenstrukturen", professor: "Prof. Lin", location: "Informatik 101" },
  { name: "Lineare Algebra", professor: "Prof. Chen", location: "Ingenieurwesen 205" },
  { name: "Physikalisches Praktikum", professor: "Prof. Zhang", location: "Physik 102" },
  { name: "Philosophisches Denken", professor: "Prof. Li", location: "Geisteswissenschaften 101" },
];

const en: SampleCopy[] = [
  { name: "Calculus", professor: "Prof. Wang", location: "General Bldg 302" },
  { name: "Data Structures", professor: "Prof. Lin", location: "CS Bldg 101" },
  { name: "Linear Algebra", professor: "Prof. Chen", location: "Eng Bldg 205" },
  { name: "General Physics Lab", professor: "Prof. Zhang", location: "Physics Bldg 102" },
  { name: "Philosophy", professor: "Prof. Li", location: "Liberal Arts 101" },
];

const copies: Record<string, SampleCopy[]> = {
  "zh-tw": zhTW,
  "zh-cn": zhCN,
  ja,
  ko,
  es,
  fr,
  de,
  en,
};

function sampleLanguage(locale: string): string {
  const normalized = locale.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) return "en";
  if (
    normalized === "zh" ||
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hant") ||
    normalized.startsWith("zh-hk") ||
    normalized.startsWith("zh-mo")
  ) {
    return "zh-tw";
  }
  if (
    normalized.startsWith("zh-cn") ||
    normalized.startsWith("zh-hans") ||
    normalized.startsWith("zh-sg")
  ) {
    return "zh-cn";
  }
  const primary = normalized.split("-")[0] ?? "";
  if (primary === "zh") return "zh-tw";
  return primary || "en";
}

function copyFor(locale: string): SampleCopy[] {
  return copies[sampleLanguage(locale)] ?? en;
}

export function getSampleCourses(locale: string): Course[] {
  return copyFor(locale).map((course, index) => ({
    name: course.name,
    professor: course.professor,
    slots: [{ ...sampleSlots[index], location: course.location }],
  }));
}

export function localizeSampleCourses(current: Course[], locale: string): Course[] {
  const next = getSampleCourses(locale);
  if (current.length !== next.length) return next;
  return next.map((course, index) => {
    const existing = current[index];
    return {
      ...course,
      slots: course.slots.map((slot, slotIndex) => {
        const previous = existing?.slots[slotIndex];
        if (!previous) return slot;
        return {
          ...slot,
          weekday: previous.weekday,
          startTime: previous.startTime,
          endTime: previous.endTime,
        };
      }),
    };
  });
}
