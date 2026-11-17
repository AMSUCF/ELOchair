# ELO 2027 submission invitation

The preview leads with **Ecologies of Attention / Ecologías de la atención** and an invitation to writers, artists and researchers. [elo27.eliterature.org](https://elo27.eliterature.org/) remains the conference landing page and the home of the official CFP; ELOchair helps people contribute.

## Conference theme and bilingual interface

The page uses the conference's fixed forest palette, contour artwork, glass navigation, lime format selection, glass detail panel and metric tiles. These styles are extracted into [theme.css](theme.css) from the conference website's inline styling; the preview does not depend on the conference site serving a separate CSS file.

The actual Bricolage Grotesque, Schibsted Grotesk (roman and italic), JetBrains Mono, Brygada 1918 and Unbounded fonts are bundled locally with their SIL Open Font License files. This avoids fallback fonts and cross-origin font requests.

The title restores the conference's cursor-following focus and blurred text treatment on pointer devices. Buttons, format choices, language controls and contribution links have hover and keyboard-focus feedback. Reduced-motion preferences disable the focus effect, movement and transition time; touch views keep the title sharp. Primary and secondary actions use aligned controls with stacked bilingual labels.

**EN·ES is the default.** The language buttons also provide English-only and Spanish-only views, with appropriate primary typography in either language. Navigation, invitation, contribution groups, all eight formats, requirement descriptions, metrics, dates, local-time display, author/reviewer sign-in, footer and preview settings all have English and Spanish copy with language attributes. Curatorial pitches retain the separate email route.

## Revised direction

The [live preview](https://elo27.jtm.io/elochair-design-preview/) is the current visual reference.

The opening view explains the theme and the people and work the call welcomes. **Start a proposal** is the main action, with the official CFP beside it and the deadline immediately below. Three compact groups show research presentations, art and performance, and workshops. Requirements sit on a separate page, rather than turning the invitation into a process checklist.

Reviewer sign-in stays in the header. Returning authors and organizers have quieter links below the invitation. All entry points use the same account system; choosing a link does not assign permissions.

The sign-in design preserves the intended next step: a proposal draft, existing proposals, or an invited workspace. This is proposed behavior; the production authentication flow has not been changed.

## Interactive preview

Open [index.html](index.html) on a static web server together with `theme.css`, `copy.js`, `preview.js` and `assets/`. The preview does not require the API, a login, Codex, or the VM. The deployment includes the complete asset bundle.

The page opens directly on the revised invitation. **Preview options / Opciones de vista previa** opens the width and call-state controls at the bottom; they are collapsed by default. The format selector, previous/next buttons, mobile format dropdown, dates and sign-in paths work inside the preview. The official CFP link opens the existing conference website.

**This is a design study.** Call states are illustrative, and sign-in is a visual endpoint. No email or account data is collected. Published CFP requirements shown here do not change the app's conference configuration. The English/Spanish interface implements the requested conference-site language pairing; integration into the app must respect its typed message catalogs.

The theme summary, first Latin American ELO conference context, submission languages and format requirements were checked against the [conference website source](https://github.com/XehReyes/elo27/blob/d0849861aaa6c8e225364fa3318b7d0870c7c5ff/index.html) on 2026-11-16, alongside [the repository's CFP format record](https://github.com/AMSUCF/ELOchair/issues/14). The summary is new copy based on that source, not a quotation. Curatorial pitches retain their separate email route.

GitHub's file viewer displays the HTML source rather than executing it. GitHub Pages is currently disabled for this repository; committing this directory alone does not publish a website.

For the existing server at jtm.io, follow [Publish the design preview](../../../deploy/preview.md). That workflow uses GitHub Actions secrets, so it does not require access to Codex environment secrets.

## Earlier structure sketches

The earlier [invitation](companion.svg), [conference front door](conference.svg) and [visitor pathways](pathways.svg) sketches are archived records of the initial comparison. They predate the complete bilingual interface and conference-theme alignment; use the interactive preview to review the current design.

## Next usability checks

- After a brief first view, describe what the conference is about and who should contribute.
- Find a suitable contribution format and the main action for starting a proposal.
- Find the official CFP and distinguish it from local submission guidance.
- Find the required materials and interpret the deadline in the visitor's time zone.
- Explain the difference between starting a draft and submitting a proposal.
- Find reviewer sign-in without entering the author workflow.
- Explain which email an invited reviewer should use and what grants access.
- Check the same paths on a phone, with keyboard navigation, and across call states.
- Switch EN, ES and EN·ES without losing the current page or chosen format.
- Check that the published CSS, scripts, all six font files and artwork are served successfully.

These are design proposals, not participant test results or a deployed authentication system.
