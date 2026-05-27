import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const EASY_RATE_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'easyRate.doc.tabOverview',
    content: `
<h3>Easy-rate: TST + Eckart rate constants</h3>

<p>
  This app computes <strong>kinetic rate constants</strong> for chemical reactions
  using <strong>Transition State Theory (TST)</strong> with optional Eckart
  tunnelling and diffusion corrections. It reads thermochemical data directly
  from Gaussian log files.
</p>

<h4>Required inputs</h4>
<p>Five Gaussian log files must be provided:</p>
<ul>
  <li><strong>Reactant 1</strong> and <strong>Reactant 2</strong> — optimised geometries with thermochemical analysis (freq).</li>
  <li><strong>Transition state</strong> — one imaginary frequency.</li>
  <li><strong>Product 1</strong> and <strong>Product 2</strong> (at least one) — optimised product geometries.</li>
</ul>

<h4>Processing pipeline</h4>
<ol>
  <li>Parse Gaussian logs: extract SCF energy, thermal enthalpy, Gibbs free energy, ZPE, temperature, imaginary frequency.</li>
  <li>Compute thermodynamic deltas: \\(\\Delta H\\), \\(\\Delta G\\), \\(\\Delta ZPE\\) for both reaction and activation.</li>
  <li>Apply cage-effect correction (optional) to the activation Gibbs energy.</li>
  <li>Compute Eckart tunnelling correction \\(\\kappa_{TST}\\) from the TS imaginary frequency and barrier/reaction energies.</li>
  <li>Compute the TST rate constant with path degeneracy.</li>
  <li>Apply diffusion correction (optional) using Stokes–Einstein theory.</li>
</ol>
`,
  },
  {
    id: 'formulas',
    titleKey: 'easyRate.doc.tabFormulas',
    content: `
<h3>Key formulas</h3>

<h4>TST rate constant</h4>

$$
k_{TST} = \\sigma \\cdot \\kappa_{TST} \\cdot \\frac{k_B T}{h} \\cdot
\\exp\\left(\\frac{-\\Delta G^{\\ddagger}}{RT}\\right)
$$

<p>where \\(\\sigma\\) is the reaction path degeneracy, \\(\\kappa_{TST}\\) the
Eckart tunnelling factor, \\(k_B T/h\\) the fundamental frequency factor
(\\(\\approx 2.08 \\times 10^{10} \\, T\\) s⁻¹), and \\(\\Delta G^{\\ddagger}\\) the
Gibbs free energy of activation.</p>

<h4>Eckart tunnelling correction</h4>

$$
u = \\frac{h c \\tilde{\\nu}}{k_B T}, \\quad
\\alpha_1 = \\frac{2 \\pi \\Delta V_f^{\\ddagger}}{h c \\tilde{\\nu}}, \\quad
\\alpha_2 = \\frac{2 \\pi (\\Delta V_f^{\\ddagger} - \\Delta_r E)}{h c \\tilde{\\nu}}
$$

$$
\\kappa_{TST} = \\frac{G^*}{\\exp(-u)}
$$

<h4>Diffusion correction</h4>
<p>If enabled, the observed rate constant is:</p>

$$
k_{obs} = \\frac{k_{diff} \\cdot k_{TST}}{k_{diff} + k_{TST}}
$$

<p>where \\(k_{diff} = 4 \\pi N_A D_{AB} R\\) is the Stokes–Einstein
diffusion-controlled rate, \\(D_{AB} = D_A + D_B\\) the mutual diffusion
coefficient, and \\(R\\) the encounter distance.</p>

<h4>Cage effect</h4>
<p>When cage effects are enabled, the activation Gibbs energy is reduced by:</p>

$$
\\Delta G^{\\ddagger}_{cage} = \\Delta G^{\\ddagger} - RT \\ln(N_r \\cdot 10^{2N_r - 2}) + (N_r - 1)
$$

<p>where \\(N_r\\) is the number of reactant molecules.</p>
`,
  },
  {
    id: 'references',
    titleKey: 'easyRate.doc.tabReferences',
    content: `
<h3>References</h3>
<ul>
  <li>Eyring, H. <em>J. Chem. Phys.</em> <strong>1935</strong>, 3, 107. <a href="https://doi.org/10.1063/1.1749604" target="_blank">DOI: 10.1063/1.1749604</a></li>
  <li>Eckart, C. <em>Phys. Rev.</em> <strong>1930</strong>, 35, 1303.</li>
  <li>Einstein, A. <em>Ann. Phys.</em> <strong>1905</strong>, 322, 549.</li>
  <li>Stokes, G. G. <em>Trans. Cambridge Philos. Soc.</em> <strong>1851</strong>, 9, 8.</li>
  <li>Frisch, M. J. et al. Gaussian 16, Revision C.01, Gaussian, Inc., Wallingford CT, 2019.</li>
</ul>
`,
  },
];
