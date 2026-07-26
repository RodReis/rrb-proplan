---
target: apps/web/src/pages/Catalog.tsx
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-07-26T19-05-09Z
slug: apps-web-src-pages-catalog-tsx
---
⚠️ DEGRADED: single-context (spawn_agent unavailable in this session)

Target: apps/web/src/pages/Catalog.tsx

Design Health Score: 25/40 — Acceptable, with significant layout and viewport issues.

Anti-patterns verdict:
The screen does not look generically AI-made. The Carbono visual language is consistent and restrained. The failure is product layout: the content is constrained to 980px and centered inside a much wider app shell, while the page still scrolls vertically. The result is a narrow “document page” sitting inside a workspace canvas, with unused horizontal space and a visible browser scrollbar.

Detector:
The Impeccable deterministic scan returned no findings for Catalog.tsx. This supports that the issue is not an obvious forbidden pattern, but a composition and information-density problem.

Priority issues:

P1 — The page scrolls vertically when the user expects a fixed workspace.
Why it matters: The screenshot shows a visible browser scrollbar. For an authenticated app surface, this breaks the “panel” mental model: sidebar and topbar are fixed, but content feels like a long landing page. It also hides rows below the fold even though there is unused width available.
Fix: Make the Catalog body a fixed-height work area under the topbar: `min-h-0`, `overflow-hidden` at the page level, and a single internal list region with controlled scroll only when rows exceed available height. Reduce top/bottom padding and remove the large bottom spacer.
Suggested command: $impeccable layout

P1 — The content max width wastes most of the viewport.
Why it matters: `max-w-[980px]` creates large dead zones left and right on 1920px screens. The user sees empty black gutters while the repository list stacks vertically and causes scroll.
Fix: Use a responsive workspace layout instead of centered document width. At desktop widths, use a two-zone layout: left/middle repo list and right status/actions panel, or make the repo list expand to 1200–1400px with a second metadata/action column. Keep a max line length for text inside rows, not for the whole page.
Suggested command: $impeccable layout

P1 — Repository rows are too tall for the task density.
Why it matters: Each row is ~62px, and the hero + connection card consume vertical budget before the user reaches the actual task. With only 7 repos, the page still scrolls; that is a layout smell.
Fix: Compress rows to 44–48px in the default view. Put description/push date in a compact secondary line only when useful, or make it a hover/detail affordance. Align actions in a dedicated right column so each row reads like a dense management table.
Suggested command: $impeccable distill

P2 — The hero banner is visually heavy for a repeat-use app task.
Why it matters: “Catálogo” is not a landing moment; it is a management surface the user returns to repeatedly. A 160px hero consumes the height needed for rows, while its image does not help decide what to manage.
Fix: Collapse the hero into a compact command header: title, short description, repo counts, and primary action in one 64–80px band. Keep the image only as a subtle background strip or remove it on desktop app shell routes.
Suggested command: $impeccable quieter

P2 — The connection card duplicates global context and consumes a full row.
Why it matters: The topbar already shows authenticated user context. The connection card is useful, but its current full-width block pushes the list down.
Fix: Move GitHub connection into a right-side status panel or a compact inline strip beside the catalog header. Keep “Desconectar” visible, but not as a full-height band before the list.
Suggested command: $impeccable layout

P2 — Actions compete inside rows.
Why it matters: Managed rows show both “Abrir workspace” and “Gerenciado”; unmanaged rows show “Gerenciar”. The managed state button is visually button-like even though it is a destructive toggle trigger (“deixar de gerenciar” confirmation). This can create hesitation.
Fix: Separate primary action and state: primary action is “Abrir”; state appears as chip “Gerenciado”; secondary destructive action goes to a menu or explicit small “Remover” affordance. For unmanaged rows, primary action remains “Gerenciar”.
Suggested command: $impeccable clarify

What works:
- The shell is consistent with product UI: fixed sidebar, restrained color, clear active nav.
- Status semantics are mostly right: green managed/active, red disconnect, muted inactive repos.
- The copy correctly explains GitHub App scope and local index behavior; the content model is sound.

Persona red flags:
Alex, power user: Too much vertical travel for a management list. No dense table mode, no bulk manage, no keyboard-visible command path.
Sam, accessibility-dependent user: Browser-level vertical scroll plus nested app shell can be disorienting. Color dots communicate state but need text/state chips to carry the same meaning.
Rodrigo, project owner: The screen wastes exactly the space he needs for comparing repositories. The task is “decide what to manage/open”, but the layout spends prime area on banner and gutters.

Questions to consider:
- Should Catalog behave like a dashboard/table instead of a centered document page?
- Is the banner still earning its height after the user has connected GitHub once?
- What is the primary repeated action here: install more repos, open an existing workspace, or manage/unmanage inventory?
