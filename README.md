# ARGpredict

**Arginylation Site Predictor**
Viral Immunology Laboratory, Department of Biotechnology
Indian Institute of Technology Guwahati (IITG)

---

## What this tool does

ARGpredict is a web-based computational tool for predicting arginylation sites
in protein sequences. Given any protein sequence in single-letter amino acid
code, it identifies candidate sites — N-terminal aspartate, glutamate, or
cysteine residues, and internal aspartate or glutamate residues — and assigns
each one a likelihood score based on the local sequence environment.

The output is a colour-coded sequence view and a sortable, filterable results
table showing each candidate site's position, residue type, and likelihood
percentage. Results can be exported as a CSV file.

---

## Use case

Arginylation is a post-translational modification catalysed by the enzyme
Arginyl-tRNA protein transferase 1 (ATE1). It involves the addition of
arginine to the N-terminus of a protein, typically after methionine cleavage
exposes an aspartate, glutamate, or cysteine residue. Arginylation is part of
the N-end rule pathway and plays roles in protein stability, cytoskeleton
organisation, and stress response.

ARGpredict allows researchers to screen a protein sequence for residues that
may be subject to arginylation, prioritised by a positional scoring model,
before committing to experimental validation.

**This tool produces computational predictions only. All results must be
experimentally validated before any biological conclusions are drawn.**

---

## Scoring methodology

### Candidate site identification

The tool flags the following residues as candidate arginylation sites:

- **N-terminal (position 2):** If the sequence begins M–D, M–E, or M–C,
  the second residue is flagged. This reflects co-translational cleavage of
  the initiator methionine by methionine aminopeptidase, exposing D, E, or C
  at the new N-terminus.
- **N-terminal (position 1):** If the sequence begins directly with D, E, or
  C (without a preceding methionine), position 1 is flagged.
- **Mid-chain:** Every internal aspartate (D) and glutamate (E) in the
  remainder of the sequence is flagged. Internal cysteine is not flagged —
  arginylation of cysteine is considered an N-terminal-specific event in this
  implementation.

### Residue scores

Each amino acid has a score reflecting its contribution to the arginylation
likelihood of a nearby candidate site. These values were provided by the
Viral Immunology Laboratory, IIT Guwahati (source: Scores_2.xlsx, Sheet 2).

| Residue | Score | Residue | Score |
|---------|-------|---------|-------|
| D       | +0.70 | G       |  0.00 |
| E       | +0.70 | L       | −0.10 |
| C       | +0.40 | I       | −0.10 |
| H       | +0.30 | V       | −0.10 |
| P       | +0.30 | M       | −0.10 |
| S       | +0.20 | F       | −0.10 |
| Y       | +0.20 | W       | −0.10 |
| N       | +0.15 | K       | −0.20 |
| Q       | +0.15 | R       | −0.20 |
| T       | +0.10 | — | — |
| A       | +0.10 | — | — |

### Distance decay

Neighbors closer to the candidate site contribute more to its score. The
contribution of a neighbor at distance *d* positions away is weighted by:

```
w(d) = 1 / 2^d
```

| Distance | Weight  |
|----------|---------|
| 1        | 0.5000  |
| 2        | 0.2500  |
| 3        | 0.1250  |
| 4        | 0.0625  |
| 5        | 0.0313  |

### Likelihood formula

For each candidate site, the score is computed as:

```
          S(site) + Σ [ w(d_i) × S(i) ]
Score = ────────────────────────────────────
        MAX_SCORE + Σ [ w(d_i) × MAX_SCORE ]
```

Where:
- `S(site)` — score of the candidate residue from the table above
- `S(i)` — score of the neighbor at position i
- `w(d_i)` — distance decay weight for that neighbor
- `MAX_SCORE` — the highest possible residue score (0.7, for D or E)
- The sum Σ runs over all neighbors within ±5 positions of the candidate site

The denominator represents the maximum possible numerator (as if all positions
in the window held the highest-scoring residue). This normalises the output
to the range [0, 1], clamped to a maximum of 0.99.

**Note on the scoring formula:** The weighted sum structure, 1/2^d decay,
±5 window, and normalization approach have not been independently published.
The residue score values are lab-derived; the formula structure requires
experimental validation against confirmed arginylation sites before it can
be used as a quantitative predictor.

### Confidence bands

| Band       | Score range | Interpretation |
|------------|-------------|----------------|
| High       | ≥ 75%       | Strong positive local environment |
| Medium     | 50–75%      | Moderate positive environment |
| Low        | 30–50%      | Weakly positive environment |
| Negligible | < 30%       | Insufficient signal |

---

## How the application works

ARGpredict is a single-page web application with no server component. All
computation runs entirely in the user's browser using JavaScript.

- **No sequence data is transmitted** to any server operated by this
  laboratory. Sequences entered into the tool remain on the user's device.
- **External API calls** are made only when the user explicitly searches by
  accession number, PDB ID, or protein name. In that case, data is fetched
  directly from the relevant public database (UniProt, NCBI, or RCSB PDB)
  and is not routed through any intermediate server.
- **No results are stored.** When the browser tab is closed or refreshed,
  all results are discarded. Results can be preserved using the CSV export.

### Technology

The application is built with:
- **React 18** — UI component framework
- **Vite 6** — build tool and development server
- **Tailwind CSS** — utility CSS framework for layout and spacing
- **lucide-react** — icon set

Fonts are loaded from Google Fonts at runtime (Fraunces, Work Sans,
JetBrains Mono). An internet connection is required for fonts to display
correctly, but the prediction itself runs offline.

---

## Database search feature

The "Fetch from" buttons allow loading a sequence directly from a public
database without leaving the application:

| Mode            | Source                  | Example input        |
|-----------------|-------------------------|----------------------|
| Accession No.   | UniProt (primary)       | P60709               |
|                 | NCBI Entrez (fallback)  | NP_001092.1          |
| PDB ID          | RCSB Protein Data Bank  | 1ATN                 |
| Protein Name    | UniProt full-text search| actin, hemoglobin    |

For PDB entries, each polymer chain is returned as a separate result because
a single PDB structure may contain multiple non-identical chains.

---

## Running locally

### Requirements

- Node.js 18 or higher ([nodejs.org](https://nodejs.org))
- npm (bundled with Node.js)

Verify your Node version before proceeding:

```bash
node --version
# Should print v18.x.x or higher
```

### Setup (run once)

```bash
# 1. Navigate into the project folder
cd ARGpredict

# 2. Install dependencies
npm install
```

### Start the development server

```bash
npm run dev
```

Open your browser and go to: `http://localhost:5173`

To stop the server, press `Ctrl + C` in the terminal.

### Build for deployment

```bash
npm run build
```

This produces a `dist/` folder containing the compiled, production-ready
static files. Copy the contents of `dist/` to the web server directory
(e.g. `/public_html/ARGPredict/`) to deploy.

---

## Deploying to a web server

Because ARGpredict has no server-side component, deploying it requires only
copying the compiled static files to a web-accessible folder.

1. Run `npm run build` locally
2. Copy the contents of the resulting `dist/` folder to the server directory
3. The application will be live at the corresponding URL

No web server configuration, database setup, or server-side runtime is needed.

---

## Example sequences

Two example sequences are provided as quick-load buttons:

| Protein            | UniProt | Notes |
|--------------------|---------|-------|
| Human Beta-actin   | P60709  | Has N-terminal Asp at position 2; multiple internal sites |
| Human Ubiquitin    | P0CG48  | 76 residues; 11 candidate mid-chain sites |

Verify these sequences against their UniProt entries before use in any
publication, as database records may be updated over time.

---

## Limitations

- The scoring formula is a heuristic. It has not been trained on or validated
  against a dataset of experimentally confirmed arginylation sites.
- The ±5 window and 1/2^d decay function were not derived from a published
  source; their biological justification has not been independently verified.
- The tool flags internal D and E residues but does not account for protein
  folding or accessibility — a buried D or E residue would not be accessible
  to ATE1 in vivo regardless of its sequence score.
- Isoforms, signal peptides, and post-translational processing beyond
  methionine cleavage are not accounted for.

---

## Contact

Viral Immunology Laboratory
Department of Biotechnology
Indian Institute of Technology Guwahati
Guwahati, Assam, India

Website: [iitg.ac.in](https://www.iitg.ac.in)
