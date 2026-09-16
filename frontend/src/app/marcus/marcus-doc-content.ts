import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const MARCUS_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'marcus.doc.tabOverview',
    content: `
<h3>Marcus electron transfer theory</h3>

<p>
  This app computes <strong>electron transfer rate constants</strong> according to
  the Marcus theory (Marcus, 1956–1965). It reads thermochemical data from
  Gaussian log files to calculate the adiabatic and vertical energies, the
  <strong>reorganisation energy</strong> (\\(\\lambda\\)), and the resulting
  Marcus barrier and rate constant.
</p>

<h4>Required files (6 Gaussian logs)</h4>
<ul>
  <li><strong>Reactant 1</strong> and <strong>Reactant 2</strong> — optimised ground-state geometries.</li>
  <li><strong>Product 1 (adiabatic)</strong> and <strong>Product 2 (adiabatic)</strong> — relaxed product geometries (full optimisation).</li>
  <li><strong>Product 1 (vertical)</strong> and <strong>Product 2 (vertical)</strong> — single-point energies at the reactant geometry (or vice-versa) to compute the vertical reorganisation.</li>
</ul>

<h4>Physical picture</h4>
<p>
  Marcus theory describes electron transfer as a thermally activated process
  where the nuclear coordinates must reorganise before the electron can tunnel
  from donor to acceptor. The reorganisation energy \\(\\lambda\\) is the energy
  required to distort the nuclear framework from the equilibrium geometry of the
  reactants to that of the products <em>without</em> transferring the electron.
</p>
`,
  },
  {
    id: 'formulas',
    titleKey: 'marcus.doc.tabFormulas',
    content: `
<h3>Key formulas</h3>

<h4>Adiabatic energy</h4>

$$
\\Delta E_{adj} = E_{SCF}^{P1_{adj}} + E_{SCF}^{P2_{adj}} - E_{SCF}^{R1} - E_{SCF}^{R2}
$$

<h4>Thermally corrected adiabatic energy</h4>

$$
\\Delta G_{adj} = G^{P1_{adj}} + G^{P2_{adj}} - G^{R1} - G^{R2}
$$

<h4>Vertical energy</h4>

$$
\\Delta E_{vert} = E_{SCF}^{P1_{vert}} + E_{SCF}^{P2_{vert}} - E_{SCF}^{R1} - E_{SCF}^{R2}
$$

<h4>Reorganisation energy</h4>

$$
\\lambda = \\Delta E_{vert} - \\Delta G_{adj}
$$

<h4>Marcus activation barrier</h4>

$$
\\Delta G^{\\ddagger} = \\frac{\\lambda}{4} \\left(1 + \\frac{\\Delta G_{adj}}{\\lambda}\\right)^2
$$

<h4>Rate constant</h4>

$$
k_{ET} = \\frac{k_B T}{h} \\cdot
\\exp\\left(\\frac{-\\Delta G^{\\ddagger}}{RT}\\right)
$$

<h4>Diffusion correction (optional)</h4>

$$
k_{obs} = \\frac{k_{diff} \\cdot k_{ET}}{k_{diff} + k_{ET}}
$$
`,
  },
  {
    id: 'references',
    titleKey: 'marcus.doc.tabReferences',
    content: `
<h3>References</h3>
<ul>
  <li>Marcus, R. A. <em>J. Chem. Phys.</em> <strong>1956</strong>, 24, 966. <a href="https://doi.org/10.1063/1.1742723" target="_blank">DOI: 10.1063/1.1742723</a></li>
  <li>Marcus, R. A. <em>Annu. Rev. Phys. Chem.</em> <strong>1964</strong>, 15, 155. <a href="https://doi.org/10.1146/annurev.pc.15.100164.001103" target="_blank">DOI: 10.1146/annurev.pc.15.100164.001103</a></li>
  <li>Marcus, R. A. <em>Rev. Mod. Phys.</em> <strong>1993</strong>, 65, 599. <a href="https://doi.org/10.1103/RevModPhys.65.599" target="_blank">DOI: 10.1103/RevModPhys.65.599</a></li>
  <li>Nelsen, S. F.; Blackstock, S. C.; Kim, Y. <em>J. Am. Chem. Soc.</em> <strong>1987</strong>, 109, 677. <a href="https://doi.org/10.1021/ja00236a020" target="_blank">DOI: 10.1021/ja00236a020</a></li>
</ul>
`,
  },
];
