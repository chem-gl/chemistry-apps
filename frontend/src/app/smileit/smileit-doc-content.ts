import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const SMILEIT_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'smileit.doc.tabOverview',
    content: `
<h3>Smile-it: combinatorial SMILES generation</h3>

<p>
  Smile-it is a <strong>combinatorial SMILES generator</strong> that takes a
  core molecular scaffold (represented as a SMILES string) and systematically
  attaches chemical substituents at user-defined positions.
</p>

<h4>Core concept</h4>
<p>
  The approach follows the classical medicinal-chemistry strategy of
  <strong>scaffold decoration</strong>: a central core is functionalised with
  diverse substituents to create a focused library of analogues. Smile-it
  automates this process combinatorially, ensuring chemically valid structures
  through RDKit-based valence and bond-order checks.
</p>

<h4>Applications</h4>
<ul>
  <li>Generating virtual libraries for virtual screening.</li>
  <li>Exploring substituent space around a hit compound.</li>
  <li>Preparing inputs for ADME, toxicity and synthetic accessibility predictions (CADMA Py pipeline).</li>
  <li>R-group decomposition and SAR (structure–activity relationship) exploration.</li>
</ul>
`,
  },
  {
    id: 'workflow',
    titleKey: 'smileit.doc.tabWorkflow',
    content: `
<h3>Workflow</h3>

<h4>1. Input the scaffold</h4>
<p>Draw or paste the core molecule in SMILES notation. Smile-it canonicalises
the SMILES and inspects the structure to show atoms, properties and
structural pattern annotations.</p>

<h4>2. Select substitution sites</h4>
<p>Click on atoms in the molecular viewer to mark them as substitution sites.
Up to 20 sites can be selected.</p>

<h4>3. Define assignment blocks</h4>
<p>Each block maps a set of substituents to a set of sites:
<ul>
  <li>Choose substituents from the <strong>catalog</strong> (persistent entries) or add <strong>manual</strong> SMILES.</li>
  <li>Assign substituent <strong>categories</strong> (aromatic, H-bond donor, hydrophobic, etc.) as filters.</li>
  <li>Blocks can overlap on the same site; overlapping is resolved by priority (last-block-wins).</li>
</ul>

<h4>4. Configure generation</h4>
<ul>
  <li><strong>R-substitutes</strong>: number of iterative substitution rounds (1–10).</li>
  <li><strong>Max structures</strong>: soft limit to prevent combinatorial explosion (0 = unlimited).</li>
  <li><strong>Export name</strong>: base name for derivative numbering.</li>
</ul>

<h4>5. Generate and export</h4>
<p>The engine performs iterative rounds of RDKit-based fusion, checking chemical
validity at each step. Results include SMILES, SVG previews, traceability
(which substituent went where), and exportable CSV/ZIP bundles.</p>
`,
  },
  {
    id: 'algorithm',
    titleKey: 'smileit.doc.tabAlgorithm',
    content: `
<h3>Generation algorithm</h3>

<h4>Iterative substitution</h4>
<p>
  In <strong>Round 1</strong>, the engine finds all valid embeddings of the
  principal scaffold, then attempts to fuse each substituent at each selected
  site. Valid derivatives become <em>frontier nodes</em> for Round 2.
</p>

<p>
  In <strong>Round 2+</strong>, each existing derivative serves as a new starting
  point. Substituents are applied only to <em>remaining unused sites</em>
  (sites that were not substituted in that derivative's traceability chain).
</p>

<h4>RDKit fusion</h4>
<p>
  Each fusion attempt chemically joins the substituent to the scaffold site
  using RDKit's <code>MolFromSmiles</code> and custom valence-aware bond
  formation. Invalid combinations (e.g. exceeding valence limits) are rejected.
</p>

<h4>Deduplication and caching</h4>
<ul>
  <li>Duplicate SMILES are discarded at each round.</li>
  <li>A fusion-attempt cache prevents re-computing the same (scaffold, substituent, site) combination across different branches.</li>
  <li>If \\(max\\_structures\\) is set, generation stops once the limit is reached (<em>truncated</em> flag raised).</li>
</ul>

<h4>Traceability</h4>
<p>Each generated structure retains a full audit trail of which substituent
(from which block) was attached to which site in which round, enabling
full reproducibility.</p>
`,
  },
  {
    id: 'references',
    titleKey: 'smileit.doc.tabReferences',
    content: `
<h3>References</h3>
<ul>
  <li>RDKit: Open-Source Cheminformatics Software. <a href="https://www.rdkit.org/" target="_blank">https://www.rdkit.org/</a></li>
  <li>Weininger, D. <em>J. Chem. Inf. Comput. Sci.</em> <strong>1988</strong>, 28, 31. <a href="https://doi.org/10.1021/ci00057a005" target="_blank">DOI: 10.1021/ci00057a005</a></li>
  <li>O'Boyle, N. M. et al. <em>J. Cheminform.</em> <strong>2011</strong>, 3, 33. <a href="https://doi.org/10.1186/1758-2946-3-33" target="_blank">DOI: 10.1186/1758-2946-3-33</a></li>
</ul>
`,
  },
];
