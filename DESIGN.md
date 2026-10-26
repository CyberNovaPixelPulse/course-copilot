---
name: Course Copilot
description: A practical workspace for checking a timetable against its source.
colors:
  primary: "#176b5b"
  primary-hover: "#207b65"
  primary-soft: "#eaf3ee"
  background: "#f1f4f5"
  foreground: "#233238"
  surface: "#ffffff"
  line: "#cbd5d6"
  muted: "#52656c"
  field-line: "#cbd5e1"
  field-text: "#1e293b"
  field-focus: "#498e77"
  course-border: "#b8cdc5"
  course-sage: "#DCEBE2"
  course-sage-text: "#233E34"
  course-rose: "#EAE2E8"
  course-rose-text: "#543747"
  course-sand: "#F0E7D3"
  course-sand-text: "#574728"
  course-leaf: "#DFEAE2"
  course-leaf-text: "#2C4837"
  course-blue: "#DDE8F0"
  course-blue-text: "#29465B"
  course-lavender: "#E6E3EF"
  course-lavender-text: "#453B61"
  course-sea: "#DAE9E7"
  course-sea-text: "#2C4A46"
  course-peach: "#F0E1D5"
  course-peach-text: "#5D402C"
typography:
  headline:
    fontFamily: "Noto Sans TC, Geist, sans-serif"
    fontSize: "clamp(26px, 2.4vw, 32px)"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Noto Sans TC, Geist, sans-serif"
    fontSize: "19px"
    fontWeight: 650
  body:
    fontFamily: "Noto Sans TC, Geist, sans-serif"
    fontSize: "14px"
    lineHeight: 1.8
  label:
    fontFamily: "Noto Sans TC, Geist, sans-serif"
    fontSize: "12px"
  brand:
    fontFamily: "Geist, sans-serif"
    fontSize: "25px"
    fontWeight: 650
    letterSpacing: "-0.035em"
rounded:
  course: "3px"
  control: "6px"
  panel: "8px"
  field: "12px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  panel: "20px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#334155"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.field-text}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "20px"
  course:
    backgroundColor: "{colors.course-sage}"
    textColor: "{colors.course-sage-text}"
    rounded: "{rounded.course}"
    padding: "4px 8px"
---

# Design System: Course Copilot

## Overview

**Creative North Star: "課表整理工作台"**

A calm, practical workspace makes the source image and the weekly timetable easy to inspect. Course names, exact times, classrooms, and functional grid lines supply the visual character. The approved Operate direction uses white work surfaces on cool gray, restrained teal actions, and small functional corners.

The interface supports checking and correcting information. Keep real state, preview state, eligibility, and recovery choices legible. No marketing hero, decorative illustration, or unnecessary animation belongs in this workbench.

**Key Characteristics:**
- Source and result remain easy to compare.
- Quiet surfaces and subdued course colors support reading.
- Functional controls, visible focus, and precise time alignment.

## Colors

### Primary
The primary teal marks actions, upload affordances, sample links, and selected language options. The existing Tailwind indigo namespace is remapped to a teal ramp in `app/globals.css`; its name does not imply a purple accent. Primary hover is lighter than primary in the implemented buttons.

### Neutral
Background is cool gray; surface is white; foreground is deep gray; muted supports explanatory text. Line defines workspace separators. Field colors preserve the existing slate input treatment.

Course colors are categorical pairs from `WeeklyCalendar.tsx`, assigned by a stable hash of the course name. Keep their paired deep text colors. They do not encode validation status or severity. The eight pairs in frontmatter are the actual event backgrounds and text colors, not a synthesized status system.

**The Quiet Surface Rule.** Use neutral work surfaces and reserve teal for functional emphasis.

## Typography

Noto Sans TC leads Chinese content with Geist and sans-serif fallbacks. Geist supplies the desktop English wordmark; Geist Mono remains available for technical build metadata. The mobile wordmark uses the compact navigation text treatment rather than the desktop brand size.

The headline role is the compact page heading. Title is the work-panel heading and becomes (17px) below the small-screen breakpoint. Body documents the introductory description, limited to (65ch). Labels and supporting information range from (11px) to (14px); they are not interchangeable with the main heading. Calendar course names use (14px), weight (600), and line height (20px); times and classrooms use (12px). Time gutter digits use tabular figures.

**The Working Hierarchy Rule.** Keep the timetable and its controls visually ahead of supporting instructions and footer details.

## Layout

The implemented desktop workbench has a maximum width of (1600px), horizontal padding of (24px), a gap of (20px), and columns `minmax(280px, 0.9fr) minmax(0, 2.2fr)`. This produces the selected approximate 30/70 source/result composition. Panel padding is the panel spacing token. The introduction and desktop navigation use (32px) horizontal padding.

At widths up to (1023px), source and result stack in that order with (20px) outer padding. At widths up to (639px), workbench padding becomes (12px), gap (14px), result padding (14px), and source padding remains (18px). Supporting workflow instructions also stack. Desktop navigation replaces compact navigation at the Tailwind md breakpoint (768px); brand descriptor and help link hide at (1100px) and below.

The calendar maintains an internal minimum width of (720px), a time gutter of (56px), and equal weekday columns. One hour occupies (72px). Horizontal scrolling belongs inside the calendar; mobile weekday buttons locate a day without widening the page. Calendar viewport maximum heights are (620px), (560px), and (480px) across desktop, stacked, and small-screen layouts. Precise details remain available below the calendar controls.

## Elevation & Depth

White against cool gray and thin separators establish depth. Work panels, calendar events, and dialogs have no decorative shadow; the global stylesheet explicitly removes event and dialog shadows. The secondary add-course control retains a small utility shadow. Existing transient notifications may retain their own shadows; do not extrapolate them into a floating-card system.

**The Working Surface Rule.** Use tonal separation and functional lines for the workbench's structure.

## Shapes

Use the control radius for workspace and navigation buttons, the panel radius for work surfaces and dialogs, and the course radius for calendar events. The upload zone uses a dashed border and the control radius. Existing form fields retain the larger field radius. Circular avatars and narrow resize handles are functional exceptions; small corners do not prohibit those shapes.

## Components

### Buttons
Primary actions use teal, white text, medium (14px) labels, and the primary component padding. Secondary actions use white and a light slate border. Workspace button corners follow the control token despite legacy rounded-full utility classes. Disabled buttons use a not-allowed cursor and state-specific subdued treatments. On coarse pointers, non-calendar buttons have minimum (44px) height and width.

### Inputs / Fields
Existing add-course fields use white, a slate stroke, the field radius, and field padding. Focus shifts the border to the field-focus color. Preserve labels, validation, and disabled behavior rather than conveying them with color alone.

### Navigation
A white fixed header uses a thin lower divider. Desktop content is (68px) high, with a compact alternative on mobile. Language and account actions remain functional; the credit badge retains its incumbent blue treatment. Do not reinterpret course colors as account-state colors.

### Cards / Containers
Source and result are quiet work panels. Account and recovery sections use separators and their existing disclosures. Do not promote every subsection into a new card. The source dropzone contains the upload affordance, supported formats, and a genuine choose-file action.

### Calendar events
Use the course color pair, a thin course-border stroke, no shadow, and tightly rounded corners. Name, precise time, and classroom form the reading order. Editable events retain drag and resize handles; read-only preview events remain noninteractive. Course events have no general (44px) minimum because their height represents duration.

### Focus and motion
The shared focus-visible treatment is a (2px) primary outline with (3px) offset; fields use (1px) offset where that rule applies. Existing local outline overrides must be checked before assuming this global rule reaches every field. Keep transitions functional. The reduced-motion media query shortens animations and transitions and disables smooth scrolling.

## Do's and Don'ts

### Do:
- **Do** keep source and result readable together on desktop and stacked in order on smaller screens.
- **Do** use paired subdued course backgrounds and deep text with tabular time labels.
- **Do** preserve real data, explicit sample labeling, keyboard focus, and account-state behavior.

### Don't:
- **Don't** add a marketing hero, decorative illustrations, or unnecessary animation to the workbench.
- **Don't** use course colors as validation or payment status semantics.
- **Don't** replace precise time and classroom information with decorative summaries.
