# Heuristic Syllabus Parser Guide

**Cost:** $0 (no API calls)  
**Accuracy:** ~80-90% on typical syllabi  
**Implementation:** Regex patterns + keyword matching

## What Gets Parsed

### ✅ Extracted Well

**Course Info**
- Name ("Introduction to Computer Science")
- Code ("CS 101")
- Instructor name & email
- Term dates (when provided by user)

**Meeting Schedule**
- Days & times ("MWF 10:00-11:15am", "TR 2:00-3:30pm")
- Location (when stated near meeting time)

**Grading**
- Weight breakdown ("40% Midterm, 35% Final, 25% Participation")
- Recognizes: percent signs, "out of", "points"

**Deadlines**
- Assignment due dates (various formats: "11/15", "Nov 15", "Due Week 4")
- Time detection ("11:59pm", "23:59")
- Exam dates (midterm, final, pop quizzes)

**Policies**
- Late submission windows ("48 hours", "up to one week")
- Penalties ("10% per day")
- Attendance/absences

**Study Materials** 🎓 (new!)
- Required/recommended readings
- Textbook references
- Database/library access info
- External resource URLs
- Consolidated in `test_info.preparation_notes`

### ⚠️ Extracted Partially

- Weekly schedule (only captures keywords, not structured dates)
- Quiz frequency (regex matches "weekly", "bi-weekly")
- Test formats ("multiple choice" detected if mentioned)
- Cumulative exams (keyword matching)

### ❌ Not Extracted

- PDF/image files (must convert to text first)
- Structured by-week topics (would need date math)
- Office hours (pattern not yet implemented)
- Prerequisite info (requires semantic understanding)

## Common Format Examples

### Meeting Times

✅ Works:
```
Class meets: M, W, F 10:00 am - 11:15 am, Room 301
Monday and Wednesday 2:00-3:30 PM
TR 9:30-10:45 AM in Building A, Room 102
```

❌ Needs fixing:
```
Class time TBA
Some sections on Wed evenings
```

### Grading

✅ Works:
```
Grade Components:
- Midterm Exam: 40%
- Final Project: 35%
- Participation: 25%

or

40% Midterm, 35% Final, 25% Participation
```

❌ Needs fixing:
```
Grading scale: A+ (95-100), A (90-94), etc. [This is letter conversion, not weights]
Based on performance
```

### Due Dates

✅ Works:
```
Assignment 1 due 9/15
Quiz 3 - Due 11/22 11:59pm
Final project submission: December 10, 2024
Due Week 5
```

❌ Needs fixing:
```
Due: last day of the month
Submission at the start of the next class
Before Thanksgiving break
```

### Late Policy

✅ Works:
```
Late submissions accepted up to 48 hours with 10% penalty per day.
Work up to one week late loses 5% per day.
No late work accepted without prior permission.
```

## Testing the Parser

### Step 1: Paste Syllabus Text

1. Open the app at https://jivvy-study.vercel.app/
2. Sign in
3. **More → Add Syllabus** (or **+** button)
4. Paste a complete syllabus (or upload as text)

### Step 2: Review the Parse

The app shows:
- ✅ What it found (assignments, exams, grades, meetings)
- ⚠️ Warnings (things it wasn't sure about)
- Full parsed JSON (you can inspect it)

### Step 3: Edit Before Saving

**This is crucial.** Fix:
- Missing or wrong dates
- Incorrect grade weights
- Misidentified assignment types
- Missing study materials (add manually if needed)

Once you click **Save**, it's committed to your account.

## Improving the Parser

The parser improves when:
1. **You edit parses** — saves corrections to the database
2. **You identify patterns** — report new syllabus formats
3. **You add regex rules** — modify `supabase/functions/_shared/heuristic-parse.ts`

### Adding a New Pattern

Example: Extract office hours

```typescript
// In heuristic-parse.ts, add to the extraction functions:

function extractOfficeHours(text: string): string | null {
  const match = text.match(/(?:office\s+hours?|oh):\s*(.+?)(?:\n|$)/i);
  return match?.[1]?.trim() || null;
}
```

Then add to `ParsedSyllabus` return value.

## Workarounds

### My syllabus didn't parse well

1. **Paste text instead of uploading** — Text extracts better than PDF
2. **Reformatted syllabus first** — Put deadlines on one line each
3. **Use the review screen** — Edit and fix manually (takes 2-3 min)

### Study materials are missing

The parser looks for:
- "Required reading:"
- "Recommended:"
- "Textbook:"
- "Access:" (databases)
- URLs (http/https)

If your syllabus uses different keywords, manually add them in the review screen under **Course Details → Notes**.

## Performance

- **Speed:** Instant (no network call)
- **Reliability:** Deterministic — same input, same output
- **Edge cases:** Usually require manual fixes (acceptable)

---

**Best for:** Most standard syllabi (CS, math, humanities, sciences)  
**Not ideal for:** Highly non-standard formats, scanned PDFs, handwritten notes
