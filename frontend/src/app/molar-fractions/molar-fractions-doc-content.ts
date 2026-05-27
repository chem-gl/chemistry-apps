import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const MOLAR_FRACTIONS_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'molarFractions.doc.tabOverview',
    content: `
<h3>Molar fractions: acid-base speciation</h3>

<p>
  This app computes the <strong>speciation diagram</strong> (molar fraction vs. pH)
  for a polyprotic acid or base. Given a set of \\(pK_a\\) values and an initial
  charge for the fully protonated species, it calculates the fraction of every
  protonation state across a range of pH values.
</p>

<p>
  The underlying model is the standard <strong>mass-balance / Henderson–Hasselbalch</strong>
  formalism for coupled acid-base equilibria. At any pH the fractions of all
  species sum to 1.0 (conservation of mass).
</p>

<h4>Key concepts</h4>
<ul>
  <li><strong>Speciation</strong> — the distribution of a compound among its protonation states as a function of pH.</li>
  <li><strong>Polyprotic system</strong> — a molecule with \\(n\\) ionisable groups has \\(n+1\\) species (fully protonated → fully deprotonated).</li>
  <li><strong>\\(pK_a\\)</strong> — the pH at which two adjacent species are at equal concentration.</li>
  <li><strong>Initial charge</strong> — charge of the fully protonated form (e.g. +1 for ammonium, 0 for neutral acid).</li>
</ul>

<h4>Typical use cases</h4>
<ul>
  <li>Predicting the dominant species at physiological pH (7.4) for drug-like molecules.</li>
  <li>Understanding pH-dependent solubility, permeability and reactivity.</li>
  <li>Designing buffers and analysing titration curves.</li>
</ul>
`,
  },
  {
    id: 'algorithm',
    titleKey: 'molarFractions.doc.tabAlgorithm',
    content: `
<h3>Algorithm</h3>

<h4>1. Cumulative beta coefficients</h4>
<p>
  Starting from \\(\\beta_0 = 1\\), each successive formation constant is:
</p>

$$
\\beta_k = 10^{\\sum_{j=1}^{k} K_{n-j+1}}
$$

<p>where \\(K_j\\) are the acid dissociation constants (pKa values) in the user-defined order.</p>

<h4>2. Species fraction at a given pH</h4>
<p>
  The hydrogen ion concentration is \\([H^+] = 10^{-pH}\\). The fraction of species
  \\(i\\) (which has lost \\(i\\) protons relative to the fully protonated form) is:
</p>

$$
f_i = \\frac{\\beta_i \\cdot [H^+]^{i}}{\\sum_{j=0}^{n} \\beta_j \\cdot [H^+]^{j}}
$$

<h4>3. Species labelling</h4>
<p>
  Labels follow the convention: \\(H_n A q\\) for the fully protonated species,
  where \\(n\\) is the number of pKa values and \\(q\\) is the initial charge.
  Each deprotonation removes one \\(H^+\\) and reduces the charge by one.
</p>

<h4>4. Numerical grid</h4>
<ul>
  <li>pH values are generated from \\(pH_{min}\\) to \\(pH_{max}\\) with step \\(\\Delta pH\\).</li>
  <li>Minimum step: 0.05</li>
  <li>Grid size: 8 – 350 points</li>
  <li>pKa values: 1 – 6</li>
</ul>
`,
  },
  {
    id: 'references',
    titleKey: 'molarFractions.doc.tabReferences',
    content: `
<h3>References</h3>
<ul>
  <li>Harris, D. C. <em>Quantitative Chemical Analysis</em>, 9th ed.; Freeman, 2015.</li>
  <li>Albert, A.; Serjeant, E. P. <em>The Determination of Ionization Constants</em>, 3rd ed.; Chapman &amp; Hall, 1984.</li>
  <li><em>IUPAC</em> definitions of acid-base equilibria. <a href="https://doi.org/10.1351/pac197951081721" target="_blank">DOI: 10.1351/pac197951081721</a></li>
</ul>
`,
  },
];
