---
name: sbvs-brand
description: Official "Engineered Quiet" brand and design system for SB Venture Solutions (SBVS) and ChangeOS. Governs architecture, typography, chromatic restraint, hairlines, and elimination of AI tropes. Use whenever styling websites, landing pages, UI components, documentation, or technical artifacts.
---
# Engineered Quiet: The SBVS Brand and Design System

A design movement for institutions and systems that earn trust by refusing to perform. Its canvas is the specification sheet itself — the drawing a master engineer pins to the wall before anything is built. Every element exists because it is measured; nothing exists to decorate. Evidence of care is the aesthetic.

## 1. Palette: Closed Chromatic System

Color is a closed system with strict single-channel integrity. No gradients, no floating shadows, no neon glows, no AI-era sparkles or orbit rings.

| Role | Value | Usage |
|---|---|---|
| Primary Navy | #101d33 | Nav bars, headers, structural frames, key boundaries |
| Accent Blue | #17479e | Links, active states, and clinical highlights only |
| Background (Light) | #ffffff | Default surface |
| Neutral Light Surface | #f7f8fa | Cards, alternating registers, inspection panels |
| Text Primary | #121417 | High-contrast body copy |
| Text Secondary | #5b616b | Dimensional annotation, supporting copy |
| Text Tertiary / Label | #8a9099 | Monospace dimension callouts, offset tags, hex values |
| Status Green | #15803d | Cryptographic / verification passes only |
| Status Amber | #b45309 | Warning / pending consensus only |
| Status Red | #b91c1c | Reject / failure signals only |

Dark theme mappings:
- Surface Deep: #07080a / #0b111d
- Surface Raised: #0e1015 / #131c2e
- Hairlines: 1px solid rgba(236, 238, 242, 0.08) (or #e3e6ea in light)

## 2. Blueprint Metrology & Grid Structure

1. **Modular Grid**: Space is governed by a strict modular rhythm. Grid lines and construction markers are allowed to show — faint construction hairlines, dimension ticks, coordinate callouts (e.g. [W:1440 × H:900], SEC-02 // CONSENSUS).
2. **Clearspace as Material**: Negative space is generous, deliberate, and documented.
3. **Calm Horizontal Registers**: Content proceeds in calm horizontal registers separated by 1px hairlines.
4. **Corner Registration**: Corner radius is fixed at 4px. Technical cards feature subtle corner registration marks (⌜ ⌝ ⌞ ⌟).

## 3. Clinical Micro-Typography

- Text appears as clinical annotation: small labels, hex codes, microsecond metrics, byte offsets, never bloated marketing fluff.
- Monospace labels: 10–12px, letterspaced +8–12%, uppercase (ont-family: var(--font-mono)).
- Scale contrast: Monumental structural titles beside whispered, high-precision technical captions.

## 4. Elimination of Stereotypical AI Tropes

- REJECT: Multi-color gradient buttons, spinning mesh gradients, floating blurry orbs, generic checkmark icons, chat bubbles mimicking consumer assistants, and hype buzzwords.
- EMBRACE: Exact protocol dissections, vector clock inspection, byte-level range streaming, cryptographic provenance leaf verification, and verifiable benchmarks.