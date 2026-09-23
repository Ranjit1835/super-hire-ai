# Step 7 — Dashboard and reports

## What changed

### Database — `20260923000008_b2b_dashboard.sql`
`org_dashboard_evaluations(org)`: one compact row per scored interview (latest evaluator version) — module, dates,
overall, readiness, primary gap, 8 dimension scores and per-topic scores (`null` = insufficient data). No evidence or
reasons, so a 150-student batch loads quickly. Staff / super-admin only; **plan-gated** (`dashboard_enabled`) — Basic
orgs get individual student reports but no batch dashboard.

### Aggregation — `src/features/b2b/lib/dashboard.ts` (pure, unit-tested)
- Per student: latest interview, latest known score per dimension and topic, first vs latest overall and change.
- **Focus area** (filterable "primary gap"): Ready if readiness is ready, else the weakest skill group —
  technical (technical + module), communication (communication + English + confidence) or analytical
  (analytical + problem solving). The model's free-text gap is still shown on hover, in reports and in Excel.
- Filters: module, batch, department, readiness (click the legend), search. Quick views: All · Ready · Needs
  technical · Needs communication · Needs analytical · Not attempted.
- Batch summary: readiness distribution, average score, first → latest improvement (students with 2+ interviews,
  improved/declined counts), weakest topics (min. 2 students), skill averages with change, weekly average trend.

### UI (institution staff)
- **Readiness** tab (`/org/:orgId/dashboard`): filters, quick views, summary cards, weekly trend, skill averages,
  and the **heatmap**: students × skills, or × topics when one module is selected. Colour bands relative to the pass
  mark; sortable columns (no-data always last); sticky name column; click a row for the drill-down.
- **Student drill-down** (`/org/:orgId/students/:userId`, every plan): all interviews, score-over-time chart with
  the pass line, the full report (scores, reasons, **evidence quotes**, speaking metrics) for any interview, and the
  transcript with topic and difficulty per question. Overview roster names link here.
- **Excel** (`exceljs`, loaded only on export): Summary, Students (every dimension, focus area, AI gap, first score,
  change; colour-coded, frozen header, filters) and Topics sheets. Exports exactly the filtered view. Values are never
  written as formulas.
- **PDF per student** (`pdf-lib`): institution logo (PNG/JPG fetched from `logo_url`; falls back to the name if the
  host blocks cross-origin requests), readiness, main gap, practise-next, skills with bars + reason + a quote,
  topics, speaking metrics, progress list, footer "AI-assisted; scores are indicative". Non-Latin characters are
  replaced so a name in another script never breaks the export.
- **Students** see only their own reports (RLS) and now a first → latest progress line on `/learn`.

### Tests
DB 3 (plan gate, isolation, latest-version) · aggregation 8 · exports 4 (reads the xlsx back; parses the PDF) ·
dashboard/drill-down UI 7.

## Notes
- Host logos on a CORS-friendly URL (e.g. a Supabase Storage public bucket) so the PDF can embed them.
- Visual check pending: the pages are covered by component tests but haven't been viewed with real data yet — Step 8's
  demo org is the intended way to review them.

## Verify
1. `npm test`.
2. Deploy: `supabase db push`.
3. As org admin: Readiness tab → filter a batch, click "Needs communication", sort by English, switch module → Topics.
4. Export Excel → open in Excel/Sheets: 3 sheets, colours, filters match the screen.
5. Click a student → switch between interviews → PDF report → logo and scores present.
6. Super-admin: move the org to Basic → Readiness tab shows the plan message; drill-down still works.
