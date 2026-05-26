import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const CADMA_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'cadmaPy.doc.tabOverview',
    content: `
      <h3>Overview</h3>
      <p>
        CADMA Py (Candidate Drug Molecule Assessment) is a compound prioritisation
        tool that scores candidate molecules against a disease-specific reference
        drug family. The score combines three complementary dimensions:
      </p>
      <ul>
        <li><strong>ADME alignment</strong> — how well the candidate's physicochemical properties fit the reference band</li>
        <li><strong>Toxicity alignment</strong> — how favourable the predicted LD50, mutagenicity and developmental toxicity are relative to the reference</li>
        <li><strong>Synthetic accessibility (SA)</strong> — how easy the compound is to synthesise</li>
      </ul>
      <p>
        The result is a single <strong>selection score</strong> (0–1) for each candidate,
        enabling transparent, reproducible ranking of compound libraries.
      </p>
    `,
  },
  {
    id: 'workflow',
    titleKey: 'cadmaPy.doc.tabWorkflow',
    content: `
      <h3>Workflow</h3>
      <p>The CADMA Py wizard guides you through four steps:</p>
      <ol>
        <li><strong>Select a reference family</strong> — pick a pre-built disease baseline (Neuro, RETT, etc.) or create a custom family from your own CSV data.</li>
        <li><strong>Upload candidates</strong> — import molecular data from Smile-it, Toxicity Properties and SA Score jobs, or upload a combined CSV. You can auto-launch missing predictions from a SMILES guide.</li>
        <li><strong>Configure the formula</strong> — adjust reference values, ADME interval windows and component weights to tune the ranking.</li>
        <li><strong>View results</strong> — inspect the ranked table, score chart and per-metric comparison plots, then export the selection CSV.</li>
      </ol>
      <p>The current session can be paused at any time and resumed later from the Jobs Monitor.</p>
    `,
  },
  {
    id: 'adme-intervals',
    titleKey: 'cadmaPy.doc.tabAdmeIntervals',
    content: `
      <h3>ADME interval window</h3>
      <p>
        Each physicochemical metric has a configurable <strong>interval window</strong>
        (min–max). A candidate passes a metric when its value falls inside the band.
        The reference band is computed as <code>mean ± std dev</code> of the reference
        family; you can widen or narrow it manually in step 3.
      </p>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Description</th>
            <th>Default min</th>
            <th>Default max</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><strong>MW</strong></td><td>Molecular Weight (Da)</td><td>200</td><td>480</td></tr>
          <tr><td><strong>logP</strong></td><td>Octanol-water partition coefficient</td><td>−0.4</td><td>5.0</td></tr>
          <tr><td><strong>MR</strong></td><td>Molar Refractivity (cm³)</td><td>40</td><td>130</td></tr>
          <tr><td><strong>AtX</strong></td><td>Number of heavy atoms</td><td>20</td><td>70</td></tr>
          <tr><td><strong>HBLA</strong></td><td>HB Acceptors count</td><td>0</td><td>10</td></tr>
          <tr><td><strong>HBLD</strong></td><td>HB Donors count</td><td>0</td><td>5</td></tr>
          <tr><td><strong>RB</strong></td><td>Rotatable Bonds count</td><td>0</td><td>10</td></tr>
          <tr><td><strong>PSA</strong></td><td>Polar Surface Area (Å²)</td><td>0</td><td>130</td></tr>
        </tbody>
      </table>
    `,
  },
  {
    id: 'adme-properties',
    titleKey: 'cadmaPy.doc.tabAdmeProperties',
    content: `
      <h3>ADME properties</h3>
      <p>
        The physicochemical properties below are computed automatically by RDKit
        for every compound loaded into a reference family. They form the ADME
        dimension of the selection score.
      </p>
      <div class="metric-grid">
        <div class="metric-item"><span class="metric-code">MW</span> — Molecular Weight</div>
        <div class="metric-item"><span class="metric-code">logP</span> — Partition coefficient</div>
        <div class="metric-item"><span class="metric-code">MR</span> — Molar Refractivity</div>
        <div class="metric-item"><span class="metric-code">AtX</span> — Heavy atom count</div>
        <div class="metric-item"><span class="metric-code">HBLA</span> — H-bond acceptors</div>
        <div class="metric-item"><span class="metric-code">HBLD</span> — H-bond donors</div>
        <div class="metric-item"><span class="metric-code">RB</span> — Rotatable bonds</div>
        <div class="metric-item"><span class="metric-code">PSA</span> — Polar surface area</div>
      </div>
      <p>
        For each metric the reference family supplies a <strong>mean and standard
        deviation</strong>. The alignment score for a single metric is:
      </p>
      <div class="formula-block">
        S_ADME(m) = 1 − |candidate(m) − ref_mean(m)| / ref_span(m)
      </div>
      <p>
        where <code>ref_span</code> is the full width of the interval window.
        The overall <strong>S_ADME</strong> is the average across all 8 metrics.
      </p>
    `,
  },
  {
    id: 'reference-sets',
    titleKey: 'cadmaPy.doc.tabReferenceSets',
    content: `
      <h3>Reference sets</h3>
      <p>
        CADMA Py ships with pre-built <strong>seed families</strong> curated from
        literature. Each seed contains approved drugs for a specific disease area
        with their experimental ADMET profile.
      </p>
      <h4>Available seeds</h4>
      <ul>
        <li><strong>Neuro</strong> — approved drugs for neurological conditions (epilepsy, Parkinson's, Alzheimer's, etc.)</li>
        <li><strong>RETT</strong> — compounds relevant to Rett syndrome and related developmental disorders</li>
      </ul>
      <p>
        Seed families are read-only templates. To customise one, click <strong>"Copy family"</strong>
        to create your own editable version. You can add or remove compounds, update
        references, and adjust the disease annotation.
      </p>
      <p>
        You can also create entirely new families from CSV/SMI files. The importer
        detects column headers, maps SMILES and metric columns, and computes RDKit
        descriptors on the fly.
      </p>
    `,
  },
  {
    id: 'selection-scores',
    titleKey: 'cadmaPy.doc.tabSelectionScores',
    content: `
      <h3>Selection scores</h3>
      <p>
        The final <strong>selection score</strong> <code>S_S</code> is a weighted
        combination of three alignment components:
      </p>
      <div class="formula-block">
        S_S = w_ADME · S_ADME + w_Toxicity · S_Toxicity + w_SA · S_SA
      </div>
      <p>where <code>w_ADME + w_Toxicity + w_SA = 1</code> (defaults: 0.4, 0.4, 0.2).</p>

      <h4>Alignment scores</h4>
      <p><strong>S_ADME</strong> — average of per-metric ADME alignment scores
        (each normalised to [0, 1] by how far the candidate falls from the
        reference mean within the interval window).</p>
      <p><strong>S_Toxicity</strong> — average of three toxicity alignments:</p>
      <ul>
        <li><strong>LD50</strong> — acute oral toxicity (mg/kg)</li>
        <li><strong>M</strong> — Ames mutagenicity (binary: 0 = non-mutagenic, 1 = mutagenic)</li>
        <li><strong>DT</strong> — developmental toxicity (binary: 0 = non-toxic, 1 = toxic)</li>
      </ul>
      <p><strong>S_SA</strong> — synthetic accessibility alignment based on the
        SA Score method (AMBIT, BRSA or RDKit). SA is normalised so that lower
        scores (easier to synthesise) align with higher S_SA values.</p>

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
        Default references are computed as the average of the selected reference
        family. You can override them in the formula controls.
      </p>
    `,
  },
];
