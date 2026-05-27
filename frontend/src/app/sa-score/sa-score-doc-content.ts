import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const SA_SCORE_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'saScore.doc.tabOverview',
    content: `
<h3>Synthetic Accessibility Score</h3>

<p>
  The <strong>Synthetic Accessibility (SA) Score</strong> estimates how easy or
  difficult it is to synthesise a given molecule in a laboratory. It is used as a
  practical filter in drug-discovery pipelines to deprioritise molecules that
  are theoretically interesting but prohibitively difficult to synthesise.
</p>

<h4>Score scale</h4>
<p>
  All methods report scores on a <strong>0–100 scale</strong> after conversion:
</p>
<ul>
  <li><strong>100</strong> = very easy to synthesise (highly accessible)</li>
  <li><strong>0</strong> = extremely difficult to synthesise</li>
</ul>

<p>The conversion from the classic 1–10 (RDKit) scale is:</p>

$$
SA_{0-100} = 100 - \\frac{(SA_{1-10} - 1) \\times 100}{9}
$$
`,
  },
  {
    id: 'methods',
    titleKey: 'saScore.doc.tabMethods',
    content: `
<h3>Available methods</h3>

<h4>AMBIT</h4>
<p>
  Uses the <strong>AMBIT</strong> Java library to predict SA scores from
  fragment-based analysis. The score is calculated by evaluating the
  complexity and frequency of structural fragments against a reference database
  of known synthetic compounds.
</p>

<h4>BR-SAScore (BRSAScore)</h4>
<p>
  A <strong>vendorised RDKit implementation</strong> using pre-computed fragment
  contributions. BR-SA extends the original RDKit SA score with additional
  fragment libraries and re-calibrated contributions for improved accuracy
  on drug-like molecules.
</p>

<h4>RDKit SA Score</h4>
<p>
  The classic implementation from <code>rdkit.Contrib.SA_Score.sascorer</code>.
  It decomposes a molecule into fragments and compares their frequency against
  the PubChem database. Rare fragments → high score (difficult synthesis).
  The original score (1–10) is converted to the 0–100 scale.
</p>

<h4>Which method to choose?</h4>
<ul>
  <li><strong>AMBIT</strong> — good for general-purpose screening with a large training set.</li>
  <li><strong>BR-SAScore</strong> — improved accuracy for medicinal-chemistry-oriented molecules.</li>
  <li><strong>RDKit</strong> — fastest, most established baseline; well-documented.</li>
</ul>

<p>Multiple methods can be selected simultaneously for cross-validation.</p>
`,
  },
  {
    id: 'references',
    titleKey: 'saScore.doc.tabReferences',
    content: `
<h3>References</h3>
<ul>
  <li>Ertl, P.; Schuffenhauer, A. <em>J. Cheminform.</em> <strong>2009</strong>, 1, 8. <a href="https://doi.org/10.1186/1758-2946-1-8" target="_blank">DOI: 10.1186/1758-2946-1-8</a></li>
  <li>Fuchs, J. E. et al. <em>J. Chem. Inf. Model.</em> <strong>2011</strong>, 51, 1480. <a href="https://doi.org/10.1021/ci2000672" target="_blank">DOI: 10.1021/ci2000672</a></li>
  <li>Jaworska, J. et al. <em>Altern. Lab. Anim.</em> <strong>2005</strong>, 33, 445. (AMBIT) <a href="https://doi.org/10.1177/026119290503300503" target="_blank">DOI: 10.1177/026119290503300503</a></li>
</ul>
`,
  },
];
