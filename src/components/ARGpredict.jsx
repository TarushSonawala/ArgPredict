/**
 * ARGpredict — Arginylation Site Predictor
 * Viral Immunology Laboratory, Department of Biotechnology
 * Indian Institute of Technology Guwahati (IITG)
 *
 * This component implements the core prediction logic and user interface for
 * ARGpredict. It accepts a protein sequence in single-letter amino acid code,
 * identifies candidate arginylation sites (N-terminal Asp, Glu, Cys after Met
 * cleavage, and internal Asp/Glu residues), and scores each site using a
 * weighted positional scoring method based on lab-derived residue scores.
 *
 * All computation runs entirely in the browser. No sequence data is sent to
 * any server operated by this lab. External API calls are made only when the
 * user explicitly searches by accession number, PDB ID, or protein name —
 * in which case data is fetched from UniProt, NCBI, or RCSB respectively.
 */

import { useState, useMemo } from "react";
import { Copy, Check, ChevronDown, ArrowUpDown, Download } from "lucide-react";
// Institution logos — imported (not referenced from /public) so Vite bundles
// them through the asset pipeline and rewrites their URLs correctly under
// the `base: "./"` config, matching how the JS/CSS bundle is handled.
import iitgLogo from "../assets/iitg_logo.png";
import vilLogo from "../assets/vil_logo.png";

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// A single source of truth for all colours used in the interface.
// Changing a value here updates it everywhere — in inline styles and in CSS
// template literals injected via the <style> tag.
// ─────────────────────────────────────────────────────────────────────────────
const TOKENS = {
  // Page background — deep navy, close in hue to Coomassie stain
  paper: "#15132A",
  // Elevated surface (cards, panels) — lighter than page background
  paperRaised: "#201D3D",
  // Primary text colour
  ink: "#EDEBF5",
  // Secondary / muted text
  inkSoft: "#A6A3C2",
  // Border / divider colour
  line: "#3B3768",
  // Brand accent — periwinkle blue used for interactive elements
  brand: "#7C8CFB",
  brandSoft: "#2A2B5C",
  // High likelihood band — Ponceau red (protein-blot stain colour)
  high: "#FF5C82",
  highSoft: "#3A2030",
  // Medium likelihood band — amber
  mid: "#F0AC3D",
  midSoft: "#3A2E14",
  // Low likelihood band — teal
  low: "#2FD9C4",
  lowSoft: "#15332F",
  // Sequence tape panel background — near-black for contrast
  tapeBg: "#0B0918",
  // Muted text inside the dark tape panel
  tapeMuted: "#6F6B95",
};

// Font stack — loaded via Google Fonts in the injected <style> tag
const FONT_DISPLAY = '"Fraunces", serif';  // Headline serif — used for titles
const FONT_BODY    = '"Work Sans", sans-serif'; // Body text
const FONT_MONO    = '"JetBrains Mono", monospace'; // Sequence display and numeric data

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE SEQUENCES
// Two well-characterised human proteins provided as quick-load examples.
// Sequences should be verified against their respective UniProt entries
// before use in any publication.
// ─────────────────────────────────────────────────────────────────────────────
const EXAMPLES = [
  {
    label: "Human Beta-actin (ACTB, P60709)",
    // Source: UniProt P60709. Verify current sequence at uniprot.org/P60709
    seq: "MDDDIAALVVDNGSGMCKAGFAGDDAPRAVFPSIVGRPRHQGVMVGMGQKDSYVGDEAQSKRGILTLKYPIEHGIVTNWDDMEKIWHHTFYNELRVAPEEHPVLLTEAPLNPKANREKMTQIMFETFNTPAMYVAIQAVLSLYASGRTTGIVMDSGDGVTHTVPIYEGYALP",
  },
  {
    label: "Human Ubiquitin (UBB, P0CG48)",
    // Source: UniProt P0CG48. Verify current sequence at uniprot.org/P0CG48
    seq: "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG",
  },
];

// The 20 standard amino acid single-letter codes.
// Used to detect and flag non-standard characters in user input.
const VALID_RESIDUES = new Set("ACDEFGHIKLMNPQRSTVWY".split(""));

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND TEXTURE GENERATOR
// Produces a small tile of amino acid single-letter codes as a data-URI SVG,
// used as a CSS `background-repeat: repeat` pattern. Tiling scales to any
// viewport width or zoom level automatically, with no JS resize handling.
// The deterministic index formula (row*7 + col*13) % 20 cycles through all
// 20 residues without using randomness, so the tile is identical every time.
// ─────────────────────────────────────────────────────────────────────────────
function buildTextureTile() {
  const letters = "ACDEFGHIKLMNPQRSTVWY"; // All 20 standard amino acids
  const cols = 10, rows = 6;
  const cellW = 22, cellH = 15; // px per letter cell — tile is cols*cellW by rows*cellH
  let glyphs = "";
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Deterministic index — produces a visually even distribution
      const ch = letters[(row * 7 + col * 13) % letters.length];
      const x  = col * cellW + 4;
      const y  = row * cellH + 11;
      glyphs += `<text x="${x}" y="${y}" font-family="monospace" font-size="11" fill="${TOKENS.ink}">${ch}</text>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cellW}" height="${rows * cellH}">${glyphs}</svg>`;
  return {
    url:  `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    size: `${cols * cellW}px ${rows * cellH}px`,
  };
}
// Build once at module load; never rebuilt during the session
const TEXTURE_TILE = buildTextureTile();

// ─────────────────────────────────────────────────────────────────────────────
// DISTANCE DECAY FUNCTION
// Returns the positional weight for a neighbor at a given distance from the
// candidate arginylation site.
//
// Formula:  w(d) = 1 / 2^d
//
// This is an exponential decay: a neighbor one position away contributes half
// the weight of the site itself; two positions away contributes a quarter; and
// so on. The decay ensures that residues immediately flanking the candidate
// site have the greatest influence on its score.
//
// Distance →  1      2      3       4        5
// Weight   →  0.5    0.25   0.125   0.0625   0.03125
//
// ─────────────────────────────────────────────────────────────────────────────
function calc(distance) {
  let weight = 1;
  for (let i = 1; i <= distance; i++) {
    weight = weight / 2; // Halve for each step away from the candidate site
  }
  return weight;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIDUE SCORES
// Lab-derived score values for all 20 standard amino acids.
// Source: Sheet 2 of Scores_2.xlsx, provided by the Viral Immunology
// Laboratory, IIT Guwahati.
//
// Interpretation:
//   Positive scores — residue environment is favourable for arginylation
//   Negative scores — residue environment is unfavourable for arginylation
//   D and E score highest (0.7) as they are the primary arginylation substrates
//
// These values are used both for scoring the candidate site itself and for
// weighting its neighbours within the ±5 window.
// ─────────────────────────────────────────────────────────────────────────────
const SCORES = {
  D:  0.70,  // Aspartic acid   — primary arginylation substrate
  E:  0.70,  // Glutamic acid   — primary arginylation substrate
  C:  0.40,  // Cysteine        — neighbour contribution only (no longer a candidate site)
  H:  0.30,  // Histidine       — favourable neighbour
  P:  0.30,  // Proline         — favourable neighbour
  Y:  0.30,  // Tyrosine        — moderately favourable
  S:  0.15,  // Serine          — moderately favourable
  N:  0.15,  // Asparagine      — moderately favourable
  Q:  0.15,  // Glutamine       — moderately favourable
  T:  0.15,  // Threonine       — moderately favourable
  A:  0.10,  // Alanine         — weakly favourable
  G:  0.00,  // Glycine         — neutral
  L: -0.10,  // Leucine         — unfavourable (hydrophobic)
  I: -0.10,  // Isoleucine      — unfavourable (hydrophobic)
  V: -0.10,  // Valine          — unfavourable (hydrophobic)
  M: -0.10,  // Methionine      — unfavourable (hydrophobic)
  F: -0.10,  // Phenylalanine   — unfavourable (hydrophobic)
  W: -0.10,  // Tryptophan      — unfavourable (hydrophobic)
  K: -0.20,  // Lysine          — strongly unfavourable (basic)
  R: -0.20,  // Arginine        — strongly unfavourable (basic)
};

// Pre-computed maximum score (D = E = 0.7).
// Used as the denominator baseline when normalising the weighted sum.
const MAX_SCORE = Math.max(...Object.values(SCORES));

// ─────────────────────────────────────────────────────────────────────────────
// LIKELIHOOD SCORING FUNCTION
// Computes a normalised arginylation likelihood score for a candidate site.
//
// Parameters:
//   neighborhood  — substring of the full sequence centred on the candidate
//                   site, extending up to 5 positions in each direction
//   residuePos    — index of the candidate residue within `neighborhood`
//
// Formula:
//
//   Score = [ S(site) + Σ w(d_i) × S(i) ]
//           ─────────────────────────────
//           [ MAX  +  Σ w(d_i) × MAX    ]
//
//   where:
//     S(site)  = score of the candidate residue itself (from SCORES table)
//     S(i)     = score of neighbor i (from SCORES table)
//     w(d_i)   = distance decay weight for neighbor at distance d_i (= 1/2^d)
//     MAX      = maximum possible residue score (0.7, for D or E)
//
//   The denominator equals what the numerator would be if every position in
//   the window were an aspartate (highest-scoring residue). This normalises
//   the output to the range [0, 1].
//
// The result is clamped:
//   — lower bound 0: prevents negative scores when surrounded by K/R
//   — upper bound 0.99: 1.0 is reserved as a theoretical maximum
//
// Note: This scoring formula has not been independently published.
// Results should be treated as computational predictions and require
// experimental validation.
// ─────────────────────────────────────────────────────────────────────────────
function calculateLikelihood(neighborhood, residuePos) {
  let score    = 0; // Running weighted sum of residue scores
  let totalMax = 0; // Running weighted sum assuming all positions are D (max)

  // Contribution from the candidate site itself (unweighted — distance = 0)
  if (residuePos !== -1) {
    score    += SCORES[neighborhood[residuePos]] ?? 0;
    totalMax += MAX_SCORE;
  }

  // Contribution from each neighbor within the window
  for (let i = 0; i < neighborhood.length; i++) {
    if (i === residuePos) continue; // Skip the candidate site itself

    const dist = Math.abs(residuePos - i); // Distance in residues
    const w    = calc(dist);               // Positional weight: 1/2^dist

    totalMax += w * MAX_SCORE;                     // Max possible contribution
    score    += w * (SCORES[neighborhood[i]] ?? 0); // Actual contribution
  }

  if (totalMax === 0) return 0;

  // Normalise and clamp to [0, 0.99]
  return Math.min(Math.max(score / totalMax, 0), 0.99);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROTEIN SEQUENCE ANALYSER
// Scans a protein sequence for candidate arginylation sites and scores each one.
//
// Candidate site rules (based on the N-end rule pathway):
//
//   N-terminal sites (higher arginylation relevance):
//     1. If sequence begins M–D, M–E, or M–C: the second residue (position 2)
//        is flagged. This reflects methionine cleavage by methionine
//        aminopeptidase exposing D, E, or C at the new N-terminus.
//     2. If the sequence begins directly with D, E, or C (no methionine):
//        position 1 is flagged as an N-terminal site.
//
//   Mid-chain sites:
//     Every internal D or E residue is flagged as a potential arginylation
//     site. Internal C is not flagged — arginylation of cysteine is considered
//     an N-terminal-specific event in this implementation.
//
//   Window for context (windowSize, default ±5):
//     The neighborhood extracted for scoring extends up to `windowSize`
//     positions upstream and downstream of each candidate site.
//
// Returns: { sequence (cleaned), sites (array of scored site objects) }
// ─────────────────────────────────────────────────────────────────────────────
function analyzeProtein(rawSequence, windowSize = 5) {
  // Strip whitespace, numbers, and non-letter characters; convert to uppercase
  const sequence = rawSequence.toUpperCase().replace(/[^A-Z]/g, "");
  const length   = sequence.length;
  const sites    = [];
  let i          = 0; // Current scan position

  // ── N-terminal site detection ─────────────────────────────────────────────
  if (sequence[0] === "M" && ["D", "E"].includes(sequence[1])) {
    // Pattern: Met at position 1, D/E at position 2
    // Met is cleaved co-translationally; D/E becomes the N-terminus
    // Note: N-terminal cysteine is NOT flagged as a candidate site in this implementation
    const center       = sequence[1];
    const downstream   = sequence.slice(2, 7); // Up to 5 residues after site
    const neighborhood = sequence.slice(1, Math.min(length, 7)); // ±5 window from pos 2
    const likelihood   = calculateLikelihood(neighborhood, 0); // Site is at index 0 in neighborhood
    sites.push({
      position:   2,
      residue:    center,
      type:       "N-terminal",
      upstream:   "",           // No upstream context — this is position 2
      downstream: downstream,
      likelihood,
    });
    i = 2; // Begin mid-chain scan after this N-terminal site
  } else if (["D", "E"].includes(sequence[0])) {
    // Pattern: sequence starts directly with D or E (no methionine)
    // Note: N-terminal cysteine is NOT flagged as a candidate site in this implementation
    const center       = sequence[0];
    const downstream   = sequence.slice(1, 6);
    const neighborhood = sequence.slice(0, Math.min(length, 6));
    const likelihood   = calculateLikelihood(neighborhood, 0);
    sites.push({
      position:   1,
      residue:    center,
      type:       "N-terminal",
      upstream:   "",
      downstream: downstream,
      likelihood,
    });
    i = 1;
  }

  // ── Mid-chain site scan ───────────────────────────────────────────────────
  // Scan every remaining position for internal D or E residues.
  // Internal C is excluded — see function-level comment above.
  for (; i < length; i++) {
    if (!["D", "E"].includes(sequence[i])) continue;

    // Extract neighborhood: up to ±5 positions around the candidate site
    const lo           = Math.max(0, i - 5);
    const neighborhood = sequence.slice(lo, Math.min(length, i + 6));
    const likelihood   = calculateLikelihood(neighborhood, i - lo);

    // Context window for display (may differ from scoring window)
    const start = Math.max(0, i - windowSize);
    const end   = Math.min(length, i + windowSize + 1);

    sites.push({
      position:   i + 1,           // Convert to 1-based position
      residue:    sequence[i],
      type:       "Mid-chain",
      upstream:   sequence.slice(start, i),
      downstream: sequence.slice(i + 1, end),
      likelihood,
    });
  }

  return { sequence, sites };
}

// ─────────────────────────────────────────────────────────────────────────────
// SITE COLOURS
// All candidate sites are highlighted in SITE_COLOR.
// The single highest-scoring site is highlighted in TOP_COLOR.
// ─────────────────────────────────────────────────────────────────────────────
const SITE_COLOR = TOKENS.brand;       // All sites — periwinkle blue
const SITE_SOFT  = TOKENS.brandSoft;   // Row highlight when selected
const TOP_COLOR  = TOKENS.high;        // Strongest site — pink/red
const TOP_SOFT   = TOKENS.highSoft;    // Row highlight for strongest site when selected

// ─────────────────────────────────────────────────────────────────────────────
// LOGO BADGE
// Wraps an institution/lab logo in a small white rounded chip so artwork
// with a plain white background sits cleanly on the dark header instead of
// showing as a stray white rectangle.
// Props: src (image), alt (accessible label)
// ─────────────────────────────────────────────────────────────────────────────
function LogoBadge({ src, alt }) {
  return (
    <div
      className="flex items-center justify-center flex-shrink-0 rounded-xl sm:rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3"
      style={{ background: "#FFFFFF", boxShadow: "0 2px 14px rgba(0,0,0,0.32)" }}
    >
      <img src={src} alt={alt} className="h-16 sm:h-24 w-auto block" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL-PAGE SPINE
// Peptide backbone zigzag that runs the full height of the page so background
// decoration doesn't run out on long sequences. 10 000 px covers any realistic
// protein analysis session.
// ─────────────────────────────────────────────────────────────────────────────
function FullPageSpine() {
  const segs = 130;
  const h    = 10000;
  const pts  = Array.from({length: segs + 1}, (_, i) => `${i % 2 === 0 ? 60 : 86},${((i / segs) * h).toFixed(1)}`).join(" ");
  return (
    <svg
      width="100" height={h} viewBox={`0 0 100 ${h}`}
      style={{ position: "fixed", top: 0, left: 0, zIndex: 0, opacity: 0.18, pointerEvents: "none", width: "90px", height: "100vh" }}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <polyline points={pts} fill="none" stroke={TOKENS.brand} strokeWidth="2"/>
      {Array.from({length: segs + 1}, (_, i) => (
        <circle key={i} cx={i % 2 === 0 ? 60 : 86} cy={((i / segs) * h).toFixed(1)} r="4"
          fill={i % 3 === 0 ? TOKENS.high : TOKENS.brand} opacity=".6"/>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DECORATIVE SVG — PEPTIDE BACKBONE MOTIF
// Stylised zigzag representing alternating alpha-carbon positions in a peptide
// backbone. Purely decorative; hidden on small screens via Tailwind's `sm:`
// responsive prefix.
// ─────────────────────────────────────────────────────────────────────────────
function PeptideMotif() {
  return (
    <svg
      width="220" height="90" viewBox="0 0 220 90"
      aria-hidden="true"
      className="hidden sm:block"
      style={{ position: "absolute", top: 8, right: 0, opacity: 0.22, pointerEvents: "none" }}
    >
      {/* Backbone zigzag — alternating high/low positions */}
      <polyline
        points="0,70 25,30 55,70 85,30 115,70 145,30 175,70 205,30"
        fill="none" stroke={TOKENS.brand} strokeWidth="3"
      />
      {/* Low-position nodes (even-indexed) */}
      {[0, 55, 115, 175].map((x) => (
        <circle key={x} cx={x === 0 ? 0 : x} cy="70" r="5" fill={TOKENS.high} />
      ))}
      {/* High-position nodes (odd-indexed) */}
      {[25, 85, 145, 205].map((x) => (
        <circle key={x} cx={x} cy="30" r="5" fill={TOKENS.brand} />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APPLICATION COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ARGpredict() {

  // ── Sequence input and analysis state ──────────────────────────────────────
  const [input,      setInput]      = useState("");       // Raw textarea value
  const [analysis,   setAnalysis]   = useState(null);     // Result of analyzeProtein()
  const [runId,      setRunId]      = useState(0);        // Incremented each run to retrigger animations
  const [error,      setError]      = useState("");       // Input validation error message
  const [selected,   setSelected]   = useState(null);     // Position of selected site (1-based)
  const [copied,     setCopied]     = useState(false);    // Copy-to-clipboard feedback flag
  const [showMethod, setShowMethod] = useState(false);    // Methodology panel open/closed

  // ── Results table state ─────────────────────────────────────────────────────
  const [sortKey,     setSortKey]     = useState("position"); // Active sort column
  const [sortDir,     setSortDir]     = useState("asc");      // Sort direction

  // ── Database search state ───────────────────────────────────────────────────
  const [searchMode,    setSearchMode]    = useState(null);  // "accession" | "pdb" | "name" | null
  const [searchQuery,   setSearchQuery]   = useState("");    // Search input field value
  const [searchResults, setSearchResults] = useState([]);   // Array of result objects
  const [searchLoading, setSearchLoading] = useState(false); // Loading indicator flag
  const [searchError,   setSearchError]   = useState("");    // Search error message

  // ─────────────────────────────────────────────────────────────────────────────
  // DATABASE SEARCH HANDLER
  // Fetches protein sequence data from external public databases.
  // No data is stored or logged by this application.
  //
  // Accession number:
  //   Attempts UniProt REST API first (rest.uniprot.org).
  //   Falls back to NCBI Entrez efetch for non-UniProt accessions.
  //
  // Protein name:
  //   Queries UniProt full-text search, returning up to 8 results.
  //
  // PDB ID:
  //   Fetches entry metadata and polymer entity sequences from RCSB PDB.
  //   Each protein chain is returned as a separate selectable result.
  // ─────────────────────────────────────────────────────────────────────────────
  async function doSearch() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);

    try {
      let results = [];

      if (searchMode === "accession") {
        const q = searchQuery.trim();

        // Try UniProt first — handles UniProt accessions (e.g. P60709)
        const uRes = await fetch(`https://rest.uniprot.org/uniprotkb/${q}.json`);
        if (uRes.ok) {
          const d = await uRes.json();
          // Prefer recommended name; fall back to submitted name or UniProt ID
          const name = d.proteinDescription?.recommendedName?.fullName?.value
            || d.proteinDescription?.submittedName?.[0]?.fullName?.value
            || d.uniProtkbId || q;
          results = [{
            id:       d.primaryAccession,
            name,
            organism: d.organism?.scientificName || "",
            sequence: d.sequence?.value || "",
            source:   "UniProt",
            length:   d.sequence?.length,
          }];
        } else {
          // Fall back to NCBI Entrez — handles RefSeq and GenBank accessions
          const nRes = await fetch(
            `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=${q}&rettype=fasta&retmode=text`
          );
          if (nRes.ok) {
            const txt = await nRes.text();
            if (txt.startsWith(">")) {
              const lines = txt.split("\n");
              // FASTA format: first line is header (>...), remainder is sequence
              const seq = lines.slice(1).join("").replace(/\s/g, "");
              results = [{
                id:       q,
                name:     lines[0].slice(1), // Strip the leading ">"
                organism: "",
                sequence: seq,
                source:   "NCBI",
                length:   seq.length,
              }];
            }
          }
        }

      } else if (searchMode === "name") {
        // UniProt full-text search — returns up to 8 matching proteins
        const res = await fetch(
          `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(searchQuery.trim())}&format=json&size=8&fields=accession,protein_name,organism_name,length,sequence`
        );
        if (res.ok) {
          const d = await res.json();
          results = (d.results || []).map((r) => ({
            id:       r.primaryAccession,
            name:     r.proteinDescription?.recommendedName?.fullName?.value
                   || r.proteinDescription?.submittedName?.[0]?.fullName?.value
                   || r.uniProtkbId,
            organism: r.organism?.scientificName || "",
            sequence: r.sequence?.value || "",
            source:   "UniProt",
            length:   r.sequence?.length,
          }));
        }

      } else if (searchMode === "pdb") {
        const pdbId = searchQuery.trim().toUpperCase();

        // Fetch entry-level metadata (title, organism, entity IDs)
        const entryRes = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${pdbId}`);
        if (!entryRes.ok) throw new Error("PDB entry not found");
        const entry = await entryRes.json();

        // Get the list of polymer entity IDs from the entry metadata
        const entityIds = entry.rcsb_entry_container_identifiers?.polymer_entity_ids || ["1"];

        // Fetch sequence data for each polymer entity in parallel
        const entities = await Promise.all(
          entityIds.map((eid) =>
            fetch(`https://data.rcsb.org/rest/v1/core/polymer_entity/${pdbId}/${eid}`)
              .then((r) => r.ok ? r.json() : null)
          )
        );

        // Extract sequence and chain identifiers from each entity
        results = entities
          .filter(Boolean)
          .map((e) => {
            const chains = e.rcsb_polymer_entity_container_identifiers?.asym_ids?.join(", ") || "";
            // pdbx_seq_one_letter_code_can — canonical one-letter sequence
            const seq = (e.entity_poly?.pdbx_seq_one_letter_code_can || "").replace(/\s/g, "");
            return {
              id:       `${pdbId} · Chain ${chains}`,
              name:     e.rcsb_polymer_entity?.pdbx_description || entry.struct?.title || pdbId,
              organism: entry.rcsb_entry_info?.organism_scientific_name?.[0] || "",
              sequence: seq,
              source:   "PDB",
              length:   seq.length,
            };
          })
          .filter((r) => r.sequence.length > 0); // Discard non-protein entities
      }

      if (results.length === 0) {
        setSearchError("No results found. Check the ID or try a different query.");
      } else {
        setSearchResults(results);
      }
    } catch {
      setSearchError("Search failed. Check your internet connection and try again.");
    }

    setSearchLoading(false);
  }

  // Loads a search result into the textarea and closes the search panel
  function pickResult(seq) {
    setInput(seq);
    setSearchMode(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
    setError("");
  }

  // ── Input validation ────────────────────────────────────────────────────────
  // Detects uppercase letters in the input that are not valid amino acid codes.
  // Re-computed only when `input` changes.
  const invalidChars = useMemo(() => {
    const found = new Set();
    input.toUpperCase().split("").forEach((c) => {
      if (/[A-Z]/.test(c) && !VALID_RESIDUES.has(c)) found.add(c);
    });
    return Array.from(found);
  }, [input]);

  // ── Analysis trigger ────────────────────────────────────────────────────────
  function handleAnalyze() {
    if (input.trim() === "") {
      setError("Add a sequence before analyzing.");
      setAnalysis(null);
      return;
    }
    setError("");
    setSelected(null);
    setAnalysis(analyzeProtein(input)); // Run the scoring algorithm
    setRunId((r) => r + 1);            // Increment to retrigger CSS animations
  }

  // Loads an example sequence and runs analysis immediately
  function loadExample(seq) {
    setInput(seq);
    setError("");
    setAnalysis(analyzeProtein(seq));
    setSelected(null);
    setRunId((r) => r + 1);
  }

  // ── Utility handlers ────────────────────────────────────────────────────────

  // Copies the cleaned (stripped) sequence to the clipboard
  function handleCopy() {
    if (!analysis) return;
    navigator.clipboard?.writeText(analysis.sequence);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Exports all scored sites as a CSV file for download
  function handleDownload() {
    if (!analysis) return;
    const header = "position,residue,type,likelihood_percent,upstream,downstream\n";
    const rows = analysis.sites
      .map((s) =>
        `${s.position},${s.residue},${s.type},${(s.likelihood * 100).toFixed(2)},${s.upstream},${s.downstream}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "argpredict_results.csv";
    a.click();
    URL.revokeObjectURL(url); // Free memory after triggering download
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  // Build a position → site lookup map for the tape visualisation.
  // Re-computed only when analysis changes.
  const siteByPosition = useMemo(() => {
    const map = new Map();
    if (analysis) analysis.sites.forEach((s) => map.set(s.position, s));
    return map;
  }, [analysis]);

  // Filtered and sorted list of sites for the results table.
  // Re-computed when analysis, filter, sort column, or sort direction changes.
  const visibleSites = useMemo(() => {
    if (!analysis) return [];
    let list = analysis.sites;

    // Sort by selected column
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return sorted;
  }, [analysis, sortKey, sortDir]);

  // Toggle sort column / direction for the results table
  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Summary statistics for the three stat cards above the results table
  const stats = useMemo(() => {
    if (!analysis || analysis.sites.length === 0) return null;
    const total = analysis.sites.length;
    const avg   = analysis.sites.reduce((sum, s) => sum + s.likelihood, 0) / total;
    const top   = analysis.sites.reduce((a, b) => (b.likelihood > a.likelihood ? b : a));
    return { total, avg, top };
  }, [analysis]);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen w-full"
      style={{ background: TOKENS.paper, color: TOKENS.ink, fontFamily: FONT_BODY, position: "relative" }}
    >
      {/* ── Global styles injected at runtime ─────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700;800&family=Work+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        .focus-ring:focus-visible { outline: 2px solid ${TOKENS.brand}; outline-offset: 2px; }

        /* Entrance animation for results panel */
        @keyframes sweepIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .sweep { animation: sweepIn 420ms ease-out; }

        /* Per-letter reveal animation in the sequence tape */
        @keyframes letterIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .letter-in { animation: letterIn 240ms ease-out both; }

        /* Respect OS-level motion preference */
        @media (prefers-reduced-motion: reduce) { .sweep, .letter-in { animation: none; } }

        .tape-letter { transition: transform 120ms ease, box-shadow 120ms ease; }
        .tape-letter--site:hover, .tape-letter--site:focus-visible { transform: translateY(-2px); }

        /* Specimen slide corner ticks on the input card */
        .slide-card { position: relative; }
        .slide-card::before, .slide-card::after,
        .slide-card .tick-br, .slide-card .tick-bl {
          content: ""; position: absolute; width: 14px; height: 14px; border-color: ${TOKENS.brand};
        }
        .slide-card::before { top: -1px; left: -1px; border-top: 2px solid; border-left: 2px solid; }
        .slide-card::after  { top: -1px; right: -1px; border-top: 2px solid; border-right: 2px solid; }
        .slide-card .tick-bl { bottom: -1px; left: -1px; border-bottom: 2px solid; border-left: 2px solid; }
        .slide-card .tick-br { bottom: -1px; right: -1px; border-bottom: 2px solid; border-right: 2px solid; }

        .dark-input::placeholder { color: ${TOKENS.inkSoft}; opacity: 0.8; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${TOKENS.line}; border-radius: 8px; }
      `}</style>

      {/* ── Background: amino acid letter grain ───────────────────────────── */}
      {/* aria-hidden: purely decorative, not read by screen readers */}
      {/* Tiled background-image, not layout text — fills any viewport size */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
          opacity: 0.07, backgroundImage: TEXTURE_TILE.url,
          backgroundRepeat: "repeat", backgroundSize: TEXTURE_TILE.size,
        }}
      />

      {/* ── Top gradient bar: colours match the band legend ───────────────── */}
      <div style={{
        height: "5px",
        background: `linear-gradient(90deg, ${TOKENS.low}, ${TOKENS.mid}, ${TOKENS.high})`,
        position: "relative", zIndex: 1,
      }} />

      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
        {/* Full-page spine runs the full page height so background art doesn't run out */}
        <FullPageSpine />

        {/* ── Sticky header ───────────────────────────────────────────────── */}
        {/* Institution logos sit at the true page edges; the existing title
            block stays centered within the same max-w-5xl column used by
            the rest of the page, so it lines up with the content below. */}
        <header
          className="px-4 sm:px-8 pt-5 pb-5 border-b sticky top-0 z-20"
          style={{
            borderColor: TOKENS.line,
            background: "rgba(21,19,42,0.88)",
            backdropFilter: "blur(8px)", // Frosted-glass effect behind scrolled content
          }}
        >
          <div className="flex items-center gap-3 sm:gap-5">
            <LogoBadge src={iitgLogo} alt="Indian Institute of Technology Guwahati" />

            <div className="max-w-5xl mx-auto flex-1 flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs uppercase tracking-widest" style={{ color: TOKENS.inkSoft, letterSpacing: "0.12em" }}>
                  Viral Immunology Laboratory &middot; IIT Guwahati
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold mt-1" style={{ fontFamily: FONT_DISPLAY }}>
                  {/* "ARG" highlighted — refers to arginine, the modifying amino acid */}
                  <span style={{ color: TOKENS.brand }}>ARG</span>predict
                </h1>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: TOKENS.line, color: TOKENS.inkSoft }}>
                heuristic scoring &middot; no data stored
              </span>
            </div>

            <LogoBadge src={vilLogo} alt="Viral Immunology Laboratory" />
          </div>
        </header>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="px-5 sm:px-10 py-10 max-w-5xl mx-auto">

          {/* Hero section */}
          <div style={{ position: "relative" }}>
            <PeptideMotif />
            <h2 className="text-3xl sm:text-5xl font-bold leading-tight max-w-xl" style={{ fontFamily: FONT_DISPLAY }}>
              See where <span style={{ color: TOKENS.high }}>arginylation</span> is likely.
            </h2>
            <p className="mt-3 max-w-lg" style={{ color: TOKENS.inkSoft }}>
              Paste or search an amino acid sequence to score every aspartate and glutamate
              site for arginylation likelihood.
            </p>
          </div>

          {/* ── Input card ─────────────────────────────────────────────────── */}
          <div className="mt-7 rounded-2xl border p-4 sm:p-5 slide-card"
            style={{ background: TOKENS.paperRaised, borderColor: TOKENS.line }}>
            <span className="tick-bl" /><span className="tick-br" />

            {/* Database search mode buttons */}
            <div className="flex gap-2 mb-3 flex-wrap">
              <span className="text-xs self-center" style={{ color: TOKENS.inkSoft }}>Fetch from:</span>
              {[
                { key: "accession", label: "Accession No." },
                { key: "pdb",       label: "PDB ID" },
                { key: "name",      label: "Protein Name" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    // Toggle: clicking the active mode closes the panel
                    setSearchMode(searchMode === key ? null : key);
                    setSearchResults([]);
                    setSearchError("");
                    setSearchQuery("");
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border focus-ring"
                  style={{
                    borderColor: searchMode === key ? TOKENS.brand : TOKENS.line,
                    background:  searchMode === key ? TOKENS.brandSoft : "transparent",
                    color:       searchMode === key ? TOKENS.brand : TOKENS.inkSoft,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Inline search panel — shown only when a search mode is active */}
            {searchMode && (
              <div className="mb-3 rounded-xl border p-3"
                style={{ borderColor: TOKENS.brand, background: TOKENS.tapeBg }}>

                {/* Context-sensitive hint text */}
                <p className="text-xs mb-2" style={{ color: TOKENS.inkSoft }}>
                  {searchMode === "accession" && "Enter a UniProt or NCBI accession number (e.g. P60709, NP_001092.1)"}
                  {searchMode === "pdb"       && "Enter a PDB ID — each chain will appear as a separate result (e.g. 1ATN, 2HHB)"}
                  {searchMode === "name"      && "Search UniProt by protein name — top 8 matches shown (e.g. actin, hemoglobin)"}
                </p>

                <div className="flex gap-2">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doSearch()} // Allow Enter key
                    placeholder={
                      searchMode === "accession" ? "e.g. P60709" :
                      searchMode === "pdb"       ? "e.g. 1ATN"   : "e.g. actin"
                    }
                    className="flex-1 px-3 py-2 rounded-lg border outline-none focus-ring text-sm"
                    style={{ borderColor: TOKENS.line, background: TOKENS.paperRaised, color: TOKENS.ink, fontFamily: FONT_MONO }}
                  />
                  <button
                    onClick={doSearch}
                    disabled={searchLoading}
                    className="px-4 py-2 rounded-lg text-sm font-semibold focus-ring"
                    style={{ background: TOKENS.brand, color: "#fff", opacity: searchLoading ? 0.6 : 1 }}
                  >
                    {searchLoading ? "Searching…" : "Search"}
                  </button>
                </div>

                {/* Error message */}
                {searchError && (
                  <p className="text-xs mt-2" style={{ color: TOKENS.high }}>{searchError}</p>
                )}

                {/* Search result cards — each clickable to load the sequence */}
                {searchResults.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    {searchResults.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => pickResult(r.sequence)}
                        className="text-left rounded-lg border p-3 focus-ring"
                        style={{ borderColor: TOKENS.line, background: TOKENS.paperRaised }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold" style={{ color: TOKENS.ink }}>{r.name}</p>
                            <p className="text-xs mt-0.5" style={{ color: TOKENS.inkSoft }}>
                              {r.id}{r.organism ? ` · ${r.organism}` : ""}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: TOKENS.brandSoft, color: TOKENS.brand }}>
                              {r.source}
                            </span>
                            <p className="text-xs mt-1" style={{ color: TOKENS.inkSoft }}>{r.length} aa</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sequence textarea */}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste a protein sequence, or fetch one above…"
              className="w-full h-32 sm:h-28 p-3 rounded-lg border outline-none resize-none focus-ring dark-input"
              style={{
                borderColor: TOKENS.line, fontFamily: FONT_MONO,
                fontSize: "0.9rem", background: TOKENS.paperRaised, color: TOKENS.ink,
              }}
            />

            {/* Character count and invalid character warning */}
            <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
              <span className="text-xs" style={{ color: TOKENS.inkSoft }}>
                {input.replace(/[^A-Za-z]/g, "").length} characters
                {invalidChars.length > 0 && (
                  <span style={{ color: TOKENS.high }}>
                    {" "}&middot; unrecognized: {invalidChars.join(", ")}
                  </span>
                )}
              </span>
              {/* Example sequence quick-load buttons */}
              <div className="flex gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => loadExample(ex.seq)}
                    className="text-xs px-3 py-1.5 rounded-full border focus-ring"
                    style={{ borderColor: TOKENS.line, color: TOKENS.inkSoft }}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm mt-2" style={{ color: TOKENS.high }}>{error}</p>}

            <button
              onClick={handleAnalyze}
              className="mt-4 px-5 py-2.5 rounded-lg font-semibold text-sm focus-ring"
              style={{ background: TOKENS.brand, color: "#FFFFFF" }}
            >
              Analyze sequence
            </button>
          </div>

          {/* ── Empty state preview cards ─────────────────────────────────── */}
          {/* Shown before any analysis has been run */}
          {!analysis && (
            <div className="grid sm:grid-cols-3 gap-3 mt-8">
              <PreviewCard
                eyebrow="Color-coded read"
                desc="Every flagged residue lights up inline, scaled by confidence."
                swatch={
                  <div className="flex gap-1" style={{ fontFamily: FONT_MONO, fontSize: "0.8rem" }}>
                    {["M","D","K","V","L","N","R","E"].map((c, i) => (
                      <span key={i} className="px-1 rounded" style={{
                        background: i===1 ? TOKENS.highSoft : i===6 ? TOKENS.lowSoft : "transparent",
                        color:      i===1 ? TOKENS.high     : i===6 ? TOKENS.low     : TOKENS.inkSoft,
                        fontWeight: i===1 || i===6 ? 700 : 400,
                      }}>
                        {c}
                      </span>
                    ))}
                  </div>
                }
              />
              <PreviewCard
                eyebrow="Colour-coded sites"
                desc="The strongest site is highlighted in a distinct colour from all other candidate sites."
                swatch={
                  <div className="flex gap-3 text-xs">
                    <span className="flex items-center gap-1" style={{ color: TOKENS.inkSoft }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: TOP_COLOR }} />
                      Strongest
                    </span>
                    <span className="flex items-center gap-1" style={{ color: TOKENS.inkSoft }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: SITE_COLOR }} />
                      Candidate
                    </span>
                  </div>
                }
              />
              <PreviewCard
                eyebrow="Export results"
                desc="Sort and download every candidate site as CSV."
                swatch={
                  <div className="flex flex-col gap-1 w-full">
                    <div className="h-1.5 rounded-full" style={{ width: "82%", background: TOP_COLOR }} />
                    <div className="h-1.5 rounded-full" style={{ width: "60%", background: SITE_COLOR }} />
                    <div className="h-1.5 rounded-full" style={{ width: "40%", background: SITE_COLOR }} />
                  </div>
                }
              />
            </div>
          )}

          {/* ── Results section ───────────────────────────────────────────── */}
          {analysis && (
            <div className="mt-10 sweep">

              {/* Sequence tape — dark panel showing the full sequence with sites highlighted */}
              <div className="rounded-2xl p-4 sm:p-5 overflow-x-auto"
                style={{ background: TOKENS.tapeBg }}>
                <p className="text-xs uppercase tracking-widest mb-3"
                  style={{ color: TOKENS.tapeMuted, letterSpacing: "0.1em" }}>
                  Sequence read
                </p>

                {/*
                  Each character in the sequence is rendered individually.
                  Candidate sites become clickable buttons coloured by their band.
                  The `key` on the container includes `runId` so React re-mounts
                  the children on each new analysis, retriggering the letter-in
                  animation.
                */}
                <div key={`tape-${runId}`} className="flex flex-wrap"
                  style={{ fontFamily: FONT_MONO, fontSize: "0.95rem", lineHeight: "1.9rem" }}>
                  {analysis.sequence.split("").map((char, idx) => {
                    const position = idx + 1;
                    const site     = siteByPosition.get(position);
                    // Stagger animation delay: max 500 ms so long sequences don't wait forever
                    const delay    = `${Math.min(idx * 6, 500)}ms`;

                    if (!site) {
                      // Non-candidate residue — muted plain text
                      return (
                        <span key={position} className="letter-in"
                          style={{ color: TOKENS.tapeMuted, animationDelay: delay }}>
                          {char}
                        </span>
                      );
                    }

                    // Candidate site — TOP_COLOR for strongest, SITE_COLOR for all others
                    const isTop      = stats?.top?.position === position;
                    const siteCol    = isTop ? TOP_COLOR : SITE_COLOR;
                    const isSelected = selected === position;
                    return (
                      <button
                        key={position}
                        title={`${site.residue}${position} — ${site.type} — ${(site.likelihood * 100).toFixed(2)}%`}
                        onClick={() => setSelected(position)}
                        className="tape-letter tape-letter--site letter-in focus-ring"
                        style={{
                          color:      "#FFFFFF",
                          background: siteCol,
                          fontWeight: 700,
                          borderRadius: "4px",
                          padding: "0 2px",
                          boxShadow: isSelected
                            ? `0 0 0 2px ${TOKENS.tapeBg}, 0 0 0 4px ${siteCol}`
                            : "none",
                          animationDelay: delay,
                        }}
                      >
                        {char}
                      </button>
                    );
                  })}
                </div>

                {/* Site colour legend */}
                <div className="flex gap-4 mt-4 flex-wrap text-xs" style={{ color: TOKENS.tapeMuted }}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: TOP_COLOR }} />
                    Strongest site
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: SITE_COLOR }} />
                    Candidate site
                  </span>
                </div>
              </div>

              {/* ── Summary stat cards ──────────────────────────────────────── */}
              {stats ? (
                <div className="grid grid-cols-3 gap-3 mt-5">
                  <StatCard label="Sites found"     value={stats.total}                                  accent={TOKENS.brand} />
                  <StatCard label="Strongest site"  value={`${stats.top.residue}${stats.top.position}`} accent={TOKENS.mid} />
                  <StatCard label="Likelihood"      value={`${(stats.top.likelihood * 100).toFixed(2)}%`} accent={TOKENS.high} />
                </div>
              ) : (
                <p className="mt-5 text-sm" style={{ color: TOKENS.inkSoft }}>
                  No aspartate, glutamate, or qualifying N-terminal sites were found.
                </p>
              )}

              {/* ── Results table ─────────────────────────────────────────── */}
              {stats && (
                <>
                  {/* Filter pills and action buttons */}
                  <div className="flex items-center justify-end mt-8 gap-2">
                    <button
                      onClick={handleCopy}
                      className="text-xs px-3 py-1.5 rounded-full border flex items-center gap-1.5 focus-ring"
                      style={{ borderColor: TOKENS.line, color: TOKENS.inkSoft }}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copied" : "Copy sequence"}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="text-xs px-3 py-1.5 rounded-full border flex items-center gap-1.5 focus-ring"
                      style={{ borderColor: TOKENS.line, color: TOKENS.inkSoft }}
                    >
                      <Download size={13} />
                      Export CSV
                    </button>
                  </div>

                  {/* Results data table */}
                  <div className="mt-3 rounded-2xl border overflow-hidden" style={{ borderColor: TOKENS.line }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: TOKENS.brandSoft }}>
                          {[
                            { key: "position",   label: "Pos" },
                            { key: "residue",    label: "Res" },
                            { key: "type",       label: "Type" },
                            { key: "likelihood", label: "Likelihood" },
                          ].map((col) => (
                            <th
                              key={col.key}
                              onClick={() => toggleSort(col.key)}
                              className="text-left px-4 py-2.5 cursor-pointer select-none focus-ring"
                            >
                              <span className="flex items-center gap-1" style={{ color: TOKENS.ink }}>
                                {col.label}
                                <ArrowUpDown size={12} opacity={sortKey === col.key ? 1 : 0.35} />
                              </span>
                            </th>
                          ))}
                          <th className="text-left px-4 py-2.5" style={{ color: TOKENS.ink }}>
                            Context
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSites.map((s) => {
                          const isTop      = stats?.top?.position === s.position;
                          const rowColor   = isTop ? TOP_COLOR : SITE_COLOR;
                          const rowSoft    = isTop ? TOP_SOFT  : SITE_SOFT;
                          const isSelected = selected === s.position;
                          return (
                            <tr
                              key={s.position}
                              onClick={() => setSelected(s.position)}
                              className="cursor-pointer"
                              style={{
                                background: isSelected ? rowSoft : "transparent",
                                borderTop:  `1px solid ${TOKENS.line}`,
                              }}
                            >
                              <td className="px-4 py-2.5" style={{ fontFamily: FONT_MONO }}>{s.position}</td>
                              <td className="px-4 py-2.5" style={{ fontFamily: FONT_MONO }}>{s.residue}</td>
                              <td className="px-4 py-2.5" style={{ color: TOKENS.inkSoft }}>{s.type}</td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-1.5 rounded-full overflow-hidden"
                                    style={{ background: TOKENS.line }}>
                                    <div className="h-full rounded-full"
                                      style={{ width: `${s.likelihood * 100}%`, background: rowColor }} />
                                  </div>
                                  <span style={{ fontFamily: FONT_MONO, fontSize: "0.8rem" }}>
                                    {(s.likelihood * 100).toFixed(2)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5"
                                style={{ fontFamily: FONT_MONO, fontSize: "0.8rem", color: TOKENS.inkSoft }}>
                                {s.upstream}
                                <span style={{ color: TOKENS.ink, fontWeight: 700 }}>{s.residue}</span>
                                {s.downstream}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Methodology disclosure panel ──────────────────────────────── */}
          <div className="mt-12 rounded-2xl border p-4 sm:p-5" style={{ borderColor: TOKENS.line, background: TOKENS.paper }}>
            <button
              onClick={() => setShowMethod(!showMethod)}
              className="flex items-center justify-between w-full text-left focus-ring"
            >
              <span className="text-sm font-semibold">
                About this score
              </span>
              <ChevronDown
                size={16}
                style={{
                  transform: showMethod ? "rotate(180deg)" : "none",
                  transition: "transform 150ms",
                }}
              />
            </button>
            {showMethod && (
              <p className="text-sm mt-3 leading-relaxed" style={{ color: TOKENS.inkSoft }}>
                Each candidate site (D or E) is analyzed to give arginylation
                likelihood with the site's own score contributing directly and neighboring
                residues within a ±5 window contributing their score weighted by a
                1/2<sup>d</sup> positional weight.
                <br /><br />
                <em>Disclaimer: Results are computational predictions requiring experimental validation.</em>
              </p>
            )}
          </div>
        </main>

        <footer className="px-5 sm:px-10 py-6 text-xs text-center" style={{ color: TOKENS.inkSoft }}>
          © Indian Institute of Technology, Guwahati (IITG), India.
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT CARD — one of the three summary cards above the results table
// Props: label (string), value (string|number), accent (hex colour)
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-xl border p-3"
      style={{
        borderColor: TOKENS.line,
        background:  TOKENS.paperRaised,
        borderTop:   `3px solid ${accent}`, // Coloured top edge identifies the band
      }}>
      <p className="text-xs" style={{ color: TOKENS.inkSoft }}>{label}</p>
      <p className="text-lg font-bold mt-0.5" style={{ fontFamily: FONT_DISPLAY }}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW CARD — feature illustration shown before first analysis
// Props: eyebrow (label string), desc (description string), swatch (JSX)
// ─────────────────────────────────────────────────────────────────────────────
function PreviewCard({ eyebrow, desc, swatch }) {
  return (
    <div className="rounded-xl border p-4 flex flex-col gap-3"
      style={{ borderColor: TOKENS.line, background: TOKENS.paperRaised }}>
      <p className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: TOKENS.brand, letterSpacing: "0.06em" }}>
        {eyebrow}
      </p>
      <div>{swatch}</div>
      <p className="text-xs" style={{ color: TOKENS.inkSoft }}>{desc}</p>
    </div>
  );
}
