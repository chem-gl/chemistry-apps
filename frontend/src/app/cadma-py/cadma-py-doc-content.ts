import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const CADMA_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'cadmaPy.doc.tabOverview',
    content: `
<h3>Overview</h3>
<p>
  CADMA Py is a graphical interface for the CADMA-Chem protocol (Computer-Assisted
  Design of Multifunctional Antioxidants based on Chemical properties). It is intended to:
</p>
<ul>
  <li>Compare pharmacokinetic-relevant properties between a reference set
    and one or more sets of proposed molecules.</li>
  <li>Combine ADME, toxicity and synthetic accessibility into a single
    selection score \\(S_S\\) that can be used as a first filter.</li>
  <li>Build or update disease-specific reference sets that serve as normalization
    anchors for future projects.</li>
</ul>
<p>
  The software does not replace detailed pharmacokinetic modelling,
  full QSAR development or expert medicinal chemistry judgement. It provides a
  transparent scoring layer to triage large lists of drug-like molecules consistently.
</p>

<h4>The CADMA-Chem protocol in three stages</h4>

<p>Stage 1 — Reference set.
  Define the disease or therapeutic problem. Build a curated list of oral drugs
  used for that indication, with experimental or predicted ADMETSA data. Compute
  mean and standard deviation for all properties.</p>

<p>Stage 2 — First-pass screening (where CADMA Py is focused).
  Design or import candidates (SMILES). Predict ADME descriptors, toxicity and SA.
  Normalise each property with respect to the reference set. Compute multiparametric
  scores and rank candidates.</p>

<p>Stage 3 — Refinement.
  For the most promising candidates, perform detailed quantum chemistry, pKa and
  speciation analysis, passive transport estimations, docking, similarity indices,
  and retrosynthetic planning.</p>
`,
  },
  {
    id: 'workflow',
    titleKey: 'cadmaPy.doc.tabWorkflow',
    content: `
<h3>Workflow</h3>

<p>
  CADMA Py implements the Stage 2 — first-pass screening of the CADMA-Chem
  protocol. The wizard guides you through four steps.
  The full protocol diagram (Stages 1–3) is available from
  the 📊 Protocol diagram button.
</p>

<h4>Step 1 — Select a reference family</h4>
<p>
  Choose a pre-built disease baseline (<em>Neuro</em> for neurological
  drugs, <em>RETT</em> for Rett syndrome) or create a custom family
  from your own SMILES, toxicity and SA data.
</p>
<p>
  The reference set provides the mean and standard deviation for every
  property — these are the normalisation anchors for all scores.
</p>

<h4>Step 2 — Import candidates</h4>
<p>
  Upload molecular data through one of three routes:
</p>
<ul>
  <li>Smile-it: combinatorial SMILES generation.</li>
  <li>Toxicity + SA jobs: predictions from the ADMET
    apps already available in this platform.</li>
  <li>CSV upload: bulk import with column mapping.</li>
</ul>

<h4>Step 3 — Configure the formula</h4>
<p>
  Adjust ADME interval windows and component weights for your specific
  screening needs. Every parameter has sensible defaults derived from
  classical drug-likeness rules.
</p>

<h4>Step 4 — Review results</h4>
<p>
  Inspect the ranked candidates table, score histograms and per-metric
  plots. The global selection score \\(S_S\\) combines ADME, toxicity
  and synthetic accessibility. Export the full report as CSV.
</p>
`,
  },
  {
    id: 'adme-intervals',
    titleKey: 'cadmaPy.doc.tabAdmeIntervals',
    content: `
<h3>ADME interval window</h3>

<p>
  The ADME intervals in CADMA-Chem derive from classical medicinal chemistry rules
  for oral drug-likeness. Each rule proposes acceptable physicochemical limits;
  CADMA-Chem adopts the restrictive overlap of these ranges to
  create a clear, practical filter for early screening.
</p>

<h4>Origin of CADMA-Chem intervals</h4>

<table>
  <thead>
    <tr>
      <th>Rule / author</th><th>MW</th><th>logP</th><th>HBLD</th><th>HBLA</th><th>PSA (Å²)</th><th>RB</th><th>MR</th><th>AtX</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Lipinski (Ro5)</td><td>≤500</td><td>≤5</td><td>≤5</td><td>≤10</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
    <tr><td>Ghose</td><td>160–480</td><td>−0.4–5.6</td><td>—</td><td>—</td><td>—</td><td>—</td><td>40–130</td><td>20–70</td></tr>
    <tr><td>Veber</td><td>—</td><td>—</td><td>—</td><td>—</td><td>≤140</td><td>≤10</td><td>—</td><td>—</td></tr>
    <tr><td>Walters &amp; Murcko</td><td>200–500</td><td>−2–5</td><td>≤5</td><td>≤10</td><td>—</td><td>≤8</td><td>—</td><td>20–50</td></tr>
    <tr><td>Teague (lead-like)</td><td>100–350</td><td>1–3</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
    <tr><td>CNS-oriented</td><td>≤400</td><td>2–4</td><td>≤3</td><td>≤6</td><td>≤70</td><td>—</td><td>—</td><td>—</td></tr>
    <tr><td>CADMA-Chem</td><td>200–480</td><td>−0.4–5.0</td><td>0–5</td><td>0–10</td><td>0–70</td><td>0–8</td><td>40–130</td><td>20–50</td></tr>
  </tbody>
</table>

<h4>Additional heuristics</h4>
<ul>
  <li>CNS polarity window: TPSA ≤ 60–70 Å², MW ≤ 400, logP ~2–4 → favours CNS penetration.</li>
  <li>Pfizer 3/75: logP &gt; 3 and TPSA &lt; 75 Å² → higher toxicity risk from excessive permeability.</li>
  <li>Pfizer 2/100: HBD ≤ 2 and TPSA &lt; 100 Å² → good probability of oral absorption.</li>
  <li>GSK 4/400: logP ≤ 4 and MW ≤ 400 → reduced clinical failure probability from toxicity.</li>
  <li>Teague lead optimisation: early leads: MW 100–350, logP 1–3 — leaves room for growth during optimisation.</li>
  <li>Brenk structural alerts: identifies reactive substructures that may compromise safety.</li>
</ul>

<p>
  Each physicochemical metric has a configurable interval window
  (min–max). A candidate passes a metric when its value falls inside the band.
</p>

<table>
  <thead>
    <tr><th>Metric</th><th>Description</th><th>Default min</th><th>Default max</th></tr>
  </thead>
  <tbody>
    <tr><td>MW</td><td>Molecular Weight (Da)</td><td>200</td><td>480</td></tr>
    <tr><td>logP</td><td>Octanol-water partition coefficient</td><td>−0.4</td><td>5.0</td></tr>
    <tr><td>MR</td><td>Molar Refractivity (cm³)</td><td>40</td><td>130</td></tr>
    <tr><td>AtX</td><td>Heavy atom count</td><td>20</td><td>50</td></tr>
    <tr><td>HBLA</td><td>HB Acceptors</td><td>0</td><td>10</td></tr>
    <tr><td>HBLD</td><td>HB Donors</td><td>0</td><td>5</td></tr>
    <tr><td>RB</td><td>Rotatable Bonds</td><td>0</td><td>8</td></tr>
    <tr><td>PSA</td><td>Polar Surface Area (Å²)</td><td>0</td><td>70</td></tr>
  </tbody>
</table>

<p>
  These intervals can be adjusted for specialised chemotypes or non-classical
  delivery strategies.
</p>
`,
  },
  {
    id: 'adme-properties',
    titleKey: 'cadmaPy.doc.tabAdmeProperties',
    content: `
<h3>ADME properties</h3>

<p>
  CADMA Py relies on RDKit to compute a panel of physicochemical
  descriptors for every molecule. These form the ADME dimension of the selection score.
</p>

<h4>Descriptor calculation</h4>
<table>
  <thead>
    <tr><th>Symbol</th><th>Property</th><th>RDKit function</th></tr>
  </thead>
  <tbody>
    <tr><td>MW</td><td>Molecular Weight</td><td><code>Descriptors.MolWt</code></td></tr>
    <tr><td>logP</td><td>Octanol/water partition coeff.</td><td><code>Descriptors.MolLogP</code></td></tr>
    <tr><td>MR</td><td>Molar Refractivity</td><td><code>Descriptors.MolMR</code></td></tr>
    <tr><td>AtX</td><td>Heavy atom count</td><td><code>Descriptors.HeavyAtomCount</code></td></tr>
    <tr><td>HBLA</td><td>H-Bond Acceptors (Lipinski)</td><td><code>CalcNumLipinskiHBA</code></td></tr>
    <tr><td>HBLD</td><td>H-Bond Donors (Lipinski)</td><td><code>CalcNumLipinskiHBD</code></td></tr>
    <tr><td>RB</td><td>Rotatable Bonds</td><td><code>CalcNumRotatableBonds</code></td></tr>
    <tr><td>PSA</td><td>Topological Polar Surface Area</td><td><code>CalcTPSA</code></td></tr>
    <tr><td>DT</td><td>Developmental Toxicity (0–1)</td><td>TEST prediction</td></tr>
    <tr><td>M</td><td>Mutagenicity / Ames (0–1)</td><td>TEST prediction</td></tr>
    <tr><td>LD50</td><td>Oral rat LD50 (mg/kg)</td><td>TEST prediction</td></tr>
    <tr><td>SA</td><td>Synthetic Accessibility</td><td>AMBIT / BRSA / RDKit</td></tr>
  </tbody>
</table>

<h4>Per-metric alignment score</h4>
<p>
  For each metric the reference family supplies a mean and standard
  deviation. The binary flag for each property is:
</p>

$$
\\mathrm{ADME}_P(i) = \\begin{cases}
  1 & \\text{if } P_{\\min} \\leq P(i) \\leq P_{\\max} \\\\
  0 & \\text{otherwise}
\\end{cases}
$$

<p>The aggregate ADME score is:</p>

$$
S_{\\mathrm{ADME}}(i) =
\\frac{\\displaystyle\\sum_{P} \\mathrm{ADME}_P(i)}
     {\\Sigma_{\\mathrm{ADME,ref}}}
$$

<p>
  where \\(\\Sigma_{\\mathrm{ADME,ref}}\\) is the number of ADME properties that
  the reference set itself satisfies within the same intervals.
  By construction, \\(S_{\\mathrm{ADME}}\\) grows when more properties fall
  inside the desired ADME window.
</p>
`,
  },
  {
    id: 'reference-sets',
    titleKey: 'cadmaPy.doc.tabReferenceSets',
    content: `
<h3>Reference sets</h3>

<p>
  A reference set is a curated collection of drugs that define
  the desired ADMETSA behaviour for a given disease. CADMA Py uses them to
  compute mean and standard deviation of all properties, which serve as
  normalisation anchors for selection scores.
</p>

<h4>Included seed families</h4>

<table>
  <thead>
    <tr><th>Set</th><th>Mean MW</th><th>Mean logP</th><th>Mean LD50 (mg/kg)</th><th>Mean SA</th></tr>
  </thead>
  <tbody>
    <tr><td>Neuro</td><td>291.31</td><td>2.55</td><td>1131.37</td><td>74.07</td></tr>
    <tr><td>RETT</td><td>289.77</td><td>2.22</td><td>1751.04</td><td>76.98</td></tr>
  </tbody>
</table>

<ul>
  <li>Neuro — approved drugs for neurological conditions (epilepsy, Parkinson's, Alzheimer's, etc.)</li>
  <li>RETT — compounds relevant to Rett syndrome and related developmental disorders</li>
</ul>

<h4>Required input files for custom families</h4>
<p>To build a new reference set you need:</p>
<ol>
  <li>SMILES file — containing <code>name</code> and <code>smile</code> columns.</li>
  <li>Toxicity CSVs — from EPA TEST: DT, M (Ames), LD50.</li>
  <li>Synthetic accessibility CSV — SA index from AMBIT (scale 1–100).</li>
</ol>

<h4>Processing pipeline</h4>
<p>
  Internally, CADMA Py reads and sanitises the SMILES, computes ADME descriptors
  with RDKit, merges toxicity and SA tables using molecule names as keys,
  computes averages and standard deviations, and stores these statistics
  persistently for future sessions.
</p>
`,
  },
  {
    id: 'selection-scores',
    titleKey: 'cadmaPy.doc.tabSelectionScores',
    content: `
<h3>Selection scores</h3>

<p>
  CADMA Py combines ADME, toxicity and synthetic accessibility into a set of
  scalar scores. All formulas are explicit so every ranking can be traced back
  to the original data.
</p>

<h4>Toxicity sub-scores</h4>

<p>LD50 alignment (higher LD50 → less toxic → rewarded):</p>

$$
S_{\\mathrm{LD50}}(i) =
1 + \\log_{10}\\left(
  \\frac{1 + \\mathrm{LD50}(i)}
       {1 + \\overline{\\mathrm{LD50}}_{\\mathrm{ref}}}
\\right)
$$

<p>Mutagenicity and developmental toxicity (lower values → less toxic → rewarded):</p>

$$
S_M(i) = 1 - \\log_{10}\\left(
  \\frac{1 + M(i)}{1 + \\overline{M}_{\\mathrm{ref}}}
\\right)
\\qquad
S_{\\mathrm{DT}}(i) = 1 - \\log_{10}\\left(
  \\frac{1 + \\mathrm{DT}(i)}{1 + \\overline{\\mathrm{DT}}_{\\mathrm{ref}}}
\\right)
$$

<p>The "+1" shift avoids taking the logarithm of zero for very small predicted values.</p>

<p>Overall toxicity score (arithmetic mean of the three):</p>

$$
S_T(i) = \\frac{S_{\\mathrm{LD50}}(i) + S_M(i) + S_{\\mathrm{DT}}(i)}{3}
$$

<h4>ADME–toxicity combined score</h4>

$$
S_{\\mathrm{ADMET}}(i) = S_{\\mathrm{ADME}}(i) + S_T(i)
$$

<h4>Synthetic accessibility score</h4>

$$
S_{\\mathrm{SA}}(i) = \\frac{\\mathrm{SA}(i)}{\\overline{\\mathrm{SA}}_{\\mathrm{ref}}}
$$

<p>
  \\(S_{\\mathrm{SA}} > 1\\) indicates the derivative is easier to synthesise
  than the reference drugs. Higher SA values mean easier synthesis on the AMBIT scale.
</p>

<h4>Global selection score \\(S_S\\)</h4>

<p>The three blocks are combined with fixed weights:</p>

$$
S_S(i) =
\\underbrace{0.4 \\cdot S_{\\mathrm{ADME}}(i)}_{\\text{ADME weight}} +
\\underbrace{0.4 \\cdot S_T(i)}_{\\text{Toxicity weight}} +
\\underbrace{0.2 \\cdot S_{\\mathrm{SA}}(i)}_{\\text{SA weight}}
$$

<p>
  Interpretation:
  \\(S_S = 1\\) is the reference threshold — the derivative is, on average,
  as "good" as the reference drugs. \\(S_S > 1\\) indicates global improvement.
  Results are sorted from highest to lowest \\(S_S\\).
</p>

<h4>Reference formula values</h4>
<table>
  <thead>
    <tr><th>Metric</th><th>Symbol</th><th>Default reference</th></tr>
  </thead>
  <tbody>
    <tr><td>LD50</td><td>LD50_ref</td><td>450 mg/kg</td></tr>
    <tr><td>Mutagenicity</td><td>M_ref</td><td>0.12</td></tr>
    <tr><td>Dev. Toxicity</td><td>DT_ref</td><td>0.20</td></tr>
    <tr><td>SA Score</td><td>SA_ref</td><td>84</td></tr>
  </tbody>
</table>

<p>
  Default references are the averages of the selected reference family.
  All values are overridable in the formula controls.
</p>
`,
  },
  {
    id: 'conformers',
    titleKey: 'cadmaPy.doc.tabConformers',
    content: `
<h3>Conformers from SMILES</h3>

<p>
  CADMA Py can generate 3D conformers for selected molecules and export them as
  SDF files for quantum chemistry, docking or other 3D-based workflows.
</p>

<h4>Input modes</h4>
<ol>
  <li>From a selection-score CSV: load a \\(S_S\\) CSV, pick the top-N
    molecules by score, and generate their 3D structures.</li>
  <li>From a manual SMILES list: paste SMILES strings (one per line).
    Invalid entries are discarded automatically.</li>
</ol>

<h4>Conformer count by flexibility</h4>
<table>
  <thead>
    <tr><th>Rotatable Bonds (RB)</th><th>Conformers generated</th></tr>
  </thead>
  <tbody>
    <tr><td>≤ 2</td><td>10</td></tr>
    <tr><td>3 – 5</td><td>20</td></tr>
    <tr><td>6 – 8</td><td>30</td></tr>
    <tr><td>9 – 12</td><td>50</td></tr>
    <tr><td>&gt; 12</td><td>75</td></tr>
  </tbody>
</table>

<h4>Workflow</h4>
<ol>
  <li>SMILES → <code>MolFromSmiles</code></li>
  <li>Add explicit hydrogens (<code>AddHs</code>)</li>
  <li>Generate \\(N\\) conformers using ETKDGv3</li>
  <li>Optimise with UFF force field</li>
  <li>Select the lowest-energy conformer → SDF export</li>
</ol>

<p>
  The SDF output contains optimised 3D coordinates, compound name, selection
  score and other properties as SD tags, ready for external tools (Gaussian,
  ORCA, AutoDock, etc.).
</p>

<div class="infobox">
  Note: Generated conformers are starting points
  — they lack solvent effects and electronic-level optimisation. Re-optimisation
  with DFT or other appropriate methods is essential before final energy
  calculations or docking.
</div>
`,
  },
];
