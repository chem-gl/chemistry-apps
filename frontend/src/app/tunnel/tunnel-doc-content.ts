import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const TUNNEL_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'tunnel.doc.tabOverview',
    content: `
<h3>Eckart tunneling correction</h3>

<p>
  This app computes the <strong>quantum tunneling correction factor</strong>
  \\(\\kappa_{TST}\\) for chemical reaction rate constants using an asymmetric
  Eckart potential barrier.
</p>

<p>
  In Transition State Theory (TST) the classical rate constant is multiplied by
  \\(\\kappa_{TST}\\) to account for quantum-mechanical tunnelling through the
  reaction barrier. The Eckart model provides an analytical potential that
  approximates the true barrier shape using the forward barrier height, the
  reaction energy and the imaginary frequency at the transition state.
</p>

<h4>Asymmetric Eckart barrier</h4>
<p>
  The asymmetric Eckart potential \\(V(x)\\) is defined by three parameters:
  \\(\\alpha_1\\), \\(\\alpha_2\\) and \\(u\\). The tunnelling probability
  \\(G(E)\\) is integrated numerically over the barrier using a 40-point
  Gauss–Legendre quadrature to yield \\(G^*\\), the integrated transmission
  coefficient.
</p>

<h4>Physical meaning</h4>
<ul>
  <li><strong>\\(\\kappa_{TST} > 1\\)</strong> — the reaction is faster than classical TST predicts, indicating significant tunnelling.</li>
  <li>Larger \\(\\kappa_{TST}\\) values are typical for <strong>H-atom transfer</strong> reactions and low-temperature kinetics.</li>
  <li><strong>Imaginary frequency</strong> — the curvature at the transition state (higher → sharper barrier → more tunnelling).</li>
</ul>
`,
  },
  {
    id: 'formulas',
    titleKey: 'tunnel.doc.tabFormulas',
    content: `
<h3>Key formulas</h3>

<h4>Reduced barrier frequency</h4>

$$
u = \\frac{h \\cdot c \\cdot \\tilde{\\nu}}{k_B \\cdot T}
$$

<p>where \\(h\\) is Planck's constant, \\(c\\) the speed of light,
\\(\\tilde{\\nu}\\) the imaginary frequency (cm⁻¹), \\(k_B\\) Boltzmann's constant
and \\(T\\) the temperature.</p>

<h4>Barrier shape parameters</h4>

$$
\\alpha_1 = \\frac{2 \\pi \\cdot \\Delta V_f^{\\ddagger}}{h \\cdot c \\cdot \\tilde{\\nu}}
$$

$$
\\alpha_2 = \\frac{2 \\pi \\cdot (\\Delta V_f^{\\ddagger} - \\Delta_r E)}{h \\cdot c \\cdot \\tilde{\\nu}}
$$

<p>where \\(\\Delta V_f^{\\ddagger}\\) is the forward barrier (ZPE-corrected) and
\\(\\Delta_r E\\) is the reaction energy (ZPE-corrected).</p>

<h4>Integrated transmission coefficient</h4>
<p>The tunnelling probability \\(G(E)\\) is integrated over the barrier energy range:</p>

$$
G^* = \\int_{E_{min}}^{E_{max}} G(E) \\, dE
$$

<h4>Tunnelling correction factor</h4>

$$
\\kappa_{TST} = \\frac{G^*}{\\exp(-u)}
$$

<p>The denominator \\(\\exp(-u)\\) is the classical Boltzmann transmission factor.
\\(\\kappa_{TST}\\) is the ratio of the quantum to the classical transmission.</p>
`,
  },
  {
    id: 'references',
    titleKey: 'tunnel.doc.tabReferences',
    content: `
<h3>References</h3>
<ul>
  <li>Eckart, C. <em>Phys. Rev.</em> <strong>1930</strong>, 35, 1303. <a href="https://doi.org/10.1103/PhysRev.35.1303" target="_blank">DOI: 10.1103/PhysRev.35.1303</a></li>
  <li>Cramer, C. J. <em>Essentials of Computational Chemistry</em>, 2nd ed.; Wiley, 2004.</li>
  <li>Fernández-Ramos, A.; Ellingson, B. A.; Meana-Pañeda, R.; et al. <em>J. Chem. Theory Comput.</em> <strong>2007</strong>, 3, 1797. <a href="https://doi.org/10.1021/ct700092m" target="_blank">DOI: 10.1021/ct700092m</a></li>
</ul>
`,
  },
];
