import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const TOXICITY_PROPERTIES_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'toxicityProperties.doc.tabOverview',
    content: `
<h3>Toxicity Properties with ADMET-AI</h3>

<p>
  This app predicts key <strong>toxicological properties</strong> for a list of
  molecules using the <strong>ADMET-AI</strong> machine learning platform. For
  each molecule it computes acute toxicity (LD50), mutagenicity (Ames test)
  and developmental toxicity (DevTox).
</p>

<h4>ADMET-AI</h4>
<p>
  ADMET-AI (Swanson et al., 2024) is a deep-learning model trained on large-scale
  experimental ADMET datasets. It provides fast, high-throughput predictions
  suitable for screening large chemical libraries prior to experimental testing.
</p>

<h4>Predicted end-points</h4>
<ul>
  <li><strong>LD50 (acute toxicity)</strong> — median lethal dose in mg/kg (oral, rat). Higher values indicate lower acute toxicity.</li>
  <li><strong>Ames mutagenicity</strong> — probability (0–1) that the compound is mutagenic. Classified as Positive ≥ 0.5.</li>
  <li><strong>Developmental toxicity (DevTox)</strong> — probability (0–1) of developmental toxicity risk. Classified as Positive ≥ 0.7.</li>
</ul>
`,
  },
  {
    id: 'interpretation',
    titleKey: 'toxicityProperties.doc.tabInterpretation',
    content: `
<h3>Interpretation of results</h3>

<h4>LD50 (mg/kg)</h4>
<table>
  <thead>
    <tr><th>LD50 range (mg/kg)</th><th>Toxicity classification</th></tr>
  </thead>
  <tbody>
    <tr><td>≤ 5</td><td>Super toxic</td></tr>
    <tr><td>5 – 50</td><td>Extremely toxic</td></tr>
    <tr><td>50 – 500</td><td>Highly toxic</td></tr>
    <tr><td>500 – 5000</td><td>Moderately toxic</td></tr>
    <tr><td>&gt; 5000</td><td>Practically non-toxic</td></tr>
  </tbody>
</table>

<p>
  The LD50 is log-transformed by ADMET-AI and converted back to mg/kg using
  the molecular weight. Higher LD50 values are generally preferred in drug
  discovery.
</p>

<h4>Ames mutagenicity</h4>
<ul>
  <li><strong>Score ≥ 0.5</strong> → Positive (mutagenic — potential safety concern)</li>
  <li><strong>Score &lt; 0.5</strong> → Negative (non-mutagenic)</li>
</ul>

<h4>Developmental toxicity</h4>
<ul>
  <li><strong>Score ≥ 0.7</strong> → Positive (developmental toxicity risk)</li>
  <li><strong>Score &lt; 0.7</strong> → Negative (low risk)</li>
</ul>

<p>
  The thresholds (0.5 for Ames, 0.7 for DevTox) follow the ADMET-AI recommended
  operating points and are consistent with the original publication.
</p>
`,
  },
  {
    id: 'references',
    titleKey: 'toxicityProperties.doc.tabReferences',
    content: `
<h3>Scientific references</h3>
<ul>
  <li>Swanson, K.; Walther, P.; Leitz, J.; Mukherjee, S.; Wu, J. C.; Shivnaraine, R. V.; Zou, J. <em>Bioinformatics</em> <strong>2024</strong>, 40(7), btae416. <a href="https://doi.org/10.1093/bioinformatics/btae416" target="_blank">DOI: 10.1093/bioinformatics/btae416</a></li>
  <li>Huang, K.; Fu, T.; Gao, W.; et al. <em>Nat. Chem. Biol.</em> <strong>2022</strong>, 18(10), 1033. <a href="https://doi.org/10.1038/s41589-022-01116-9" target="_blank">DOI: 10.1038/s41589-022-01116-9</a></li>
  <li>Zhang, J.; Li, H.; Zhang, Y.; et al. <em>Brief. Bioinform.</em> <strong>2025</strong>, 26(5).</li>
  <li>Hansen, K. et al. <em>J. Chem. Inf. Model.</em> <strong>2009</strong>, 49, 2077. (Ames model) <a href="https://doi.org/10.1021/ci900161a" target="_blank">DOI: 10.1021/ci900161a</a></li>
</ul>
`,
  },
];
