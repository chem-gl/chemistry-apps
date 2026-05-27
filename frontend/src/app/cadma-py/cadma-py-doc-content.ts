import type { DocTab } from '../core/shared/components/scientific-doc-panel/scientific-doc-panel.component';

export const CADMA_DOC_TABS: DocTab[] = [
  {
    id: 'overview',
    titleKey: 'cadmaPy.doc.tabOverview',
    content: `
<h3>Overview</h3>
<p>
  CADMA Py (Candidate Drug Molecule Assessment) is a companion graphical interface
  for the <strong>CADMA-Chem</strong> protocol (Computational protocol Aimed to
  Design Multifunctional Antioxidants based on Chemical properties). It is intended to:
</p>
<ul>
  <li>Compare pharmacokinetic-relevant properties between a <strong>reference set</strong>
    and one or more sets of proposed molecules.</li>
  <li>Combine ADME, toxicity and synthetic accessibility into a single
    <strong>selection score</strong> \\(S_S\\) that can be used as a first filter.</li>
  <li>Build or update disease-specific reference sets that serve as normalization
    anchors for future projects.</li>
</ul>
<p>
  The software does <strong>not</strong> replace detailed pharmacokinetic modelling,
  full QSAR development or expert medicinal chemistry judgement. It provides a
  transparent scoring layer to triage large lists of drug-like molecules consistently.
</p>

<h4>The CADMA-Chem protocol in three stages</h4>

<p><strong>Stage 1 — Reference set.</strong>
  Define the disease or therapeutic problem. Build a curated list of oral drugs
  used for that indication, with experimental or predicted ADMETSA data. Compute
  mean and standard deviation for all properties.</p>

<p><strong>Stage 2 — First-pass screening</strong> (where CADMA Py is focused).
  Design or import candidates (SMILES). Predict ADME descriptors, toxicity and SA.
  Normalise each property with respect to the reference set. Compute multiparametric
  scores and rank candidates.</p>

<p><strong>Stage 3 — Refinement.</strong>
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

<p>The CADMA-Chem protocol and CADMA Py wizard are structured as follows:</p>

<style>
.doc-svg-wrap {
  --c-green-bg:   #EAF4E2; --c-green-bdr:  #4A8C2A; --c-green-txt:  #1E4A08; --c-green-head: #3B7022;
  --c-blue-bg:    #E3F0FB; --c-blue-bdr:   #2E7DC0; --c-blue-txt:   #0C3D6E; --c-blue-head:  #1A5E9A;
  --c-gray-bg:    #F0EFE8; --c-gray-bdr:   #8A8880; --c-gray-txt:   #2C2C28; --c-gray-head:  #4A4A44;
  --c-teal-bg:    #E0F4EE; --c-teal-bdr:   #1A8A62; --c-teal-txt:   #0A3D2A; --c-teal-head:  #147A54;
  --c-amber-bg:   #FEF3E2; --c-amber-bdr:  #C07810; --c-amber-txt:  #5A3800; --c-amber-head: #9A5E08;
  --c-pink-bg:    #FAEAF2; --c-pink-bdr:   #B03878; --c-pink-txt:   #580030; --c-pink-head:  #8C2860;
  --c-neutral-bdr:#C8C6BC; --c-neutral-bg: #F8F7F2;
  margin: 1rem 0;
}
.doc-svg-wrap svg { display: block; width: 100%; height: auto; }
.doc-svg-wrap .mod-green  { fill: var(--c-green-bg);  stroke: var(--c-green-bdr);  stroke-width: 1.4; }
.doc-svg-wrap .mod-blue   { fill: var(--c-blue-bg);   stroke: var(--c-blue-bdr);   stroke-width: 1.4; }
.doc-svg-wrap .mod-gray   { fill: var(--c-gray-bg);   stroke: var(--c-gray-bdr);   stroke-width: 1.4; }
.doc-svg-wrap .mod-teal   { fill: var(--c-teal-bg);   stroke: var(--c-teal-bdr);   stroke-width: 1.4; }
.doc-svg-wrap .mod-amber  { fill: var(--c-amber-bg);  stroke: var(--c-amber-bdr);  stroke-width: 1.4; }
.doc-svg-wrap .mod-pink   { fill: var(--c-pink-bg);   stroke: var(--c-pink-bdr);   stroke-width: 1.4; }
.doc-svg-wrap .step-green { fill: #fff; stroke: var(--c-green-bdr);  stroke-width: 0.8; }
.doc-svg-wrap .step-blue  { fill: #fff; stroke: var(--c-blue-bdr);   stroke-width: 0.8; }
.doc-svg-wrap .step-gray  { fill: #fff; stroke: var(--c-gray-bdr);   stroke-width: 0.8; }
.doc-svg-wrap .step-teal  { fill: #fff; stroke: var(--c-teal-bdr);   stroke-width: 0.8; }
.doc-svg-wrap .step-amber { fill: #fff; stroke: var(--c-amber-bdr);  stroke-width: 0.8; }
.doc-svg-wrap .step-pink  { fill: #fff; stroke: var(--c-pink-bdr);   stroke-width: 0.8; }
.doc-svg-wrap .mtitle-green  { font-size: 13px; font-weight: 700; fill: var(--c-green-head); letter-spacing: 0.04em; }
.doc-svg-wrap .mtitle-blue   { font-size: 13px; font-weight: 700; fill: var(--c-blue-head);  letter-spacing: 0.04em; }
.doc-svg-wrap .mtitle-gray   { font-size: 13px; font-weight: 700; fill: var(--c-gray-head);  letter-spacing: 0.04em; }
.doc-svg-wrap .mtitle-teal   { font-size: 13px; font-weight: 700; fill: var(--c-teal-head);  letter-spacing: 0.04em; }
.doc-svg-wrap .mtitle-amber  { font-size: 13px; font-weight: 700; fill: var(--c-amber-head); letter-spacing: 0.04em; }
.doc-svg-wrap .mtitle-pink   { font-size: 13px; font-weight: 700; fill: var(--c-pink-head);  letter-spacing: 0.04em; }
.doc-svg-wrap .slabel { font-size: 12.5px; font-weight: 600; }
.doc-svg-wrap .ssub   { font-size: 10.5px; font-weight: 400; }
.doc-svg-wrap .slabel-green { fill: var(--c-green-txt); }
.doc-svg-wrap .slabel-blue  { fill: var(--c-blue-txt);  }
.doc-svg-wrap .slabel-gray  { fill: var(--c-gray-txt);  }
.doc-svg-wrap .slabel-teal  { fill: var(--c-teal-txt);  }
.doc-svg-wrap .slabel-amber { fill: var(--c-amber-txt); }
.doc-svg-wrap .slabel-pink  { fill: var(--c-pink-txt);  }
.doc-svg-wrap .ssub-green { fill: #5A7A50; }
.doc-svg-wrap .ssub-blue  { fill: #3A6090; }
.doc-svg-wrap .ssub-gray  { fill: #606058; }
.doc-svg-wrap .ssub-teal  { fill: #2A6A50; }
.doc-svg-wrap .ssub-amber { fill: #806030; }
.doc-svg-wrap .ssub-pink  { fill: #7A3060; }
.doc-svg-wrap .arr-main { fill: none; stroke: #4A6040; stroke-width: 1.6; }
.doc-svg-wrap .arr-feed { fill: none; stroke: #9A9A92; stroke-width: 1.2; stroke-dasharray: 5 3; }
.doc-svg-wrap .arr-opt  { fill: none; stroke: #2E7DC0; stroke-width: 1.4; stroke-dasharray: 3 2; }
.doc-svg-wrap .mdiv { stroke: #D8D6CE; stroke-width: 0.6; }
.doc-svg-wrap .bif-label { font-size: 10px; font-weight: 600; fill: #2E7DC0; }
.doc-svg-wrap .ann { font-size: 10px; fill: #9A9A92; }
</style>

<div class="doc-svg-wrap">
<svg viewBox="0 0 740 1540" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto">
<defs>
  <marker id="mA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M1.5 1.5L8.5 5L1.5 8.5" fill="none" stroke="#4A6040" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </marker>
  <marker id="mF" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M1.5 1.5L8.5 5L1.5 8.5" fill="none" stroke="#9A9A92" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </marker>
  <marker id="mO" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M1.5 1.5L8.5 5L1.5 8.5" fill="none" stroke="#2E7DC0" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </marker>
</defs>

<rect class="mod-green" x="20" y="20" width="700" height="108" rx="12"/>
<text class="mtitle-green" x="370" y="42" text-anchor="middle">STAGE 1 — PLANTEAMIENTO / REFERENCE DEFINITION</text>
<line class="mdiv" x1="36" y1="50" x2="704" y2="50"/>
<rect class="step-green" x="32"  y="58" width="155" height="60" rx="7"/>
<text class="slabel slabel-green" x="109"  y="83"  text-anchor="middle" dominant-baseline="central">Therapeutic problem</text>
<text class="ssub   ssub-green"   x="109"  y="101" text-anchor="middle" dominant-baseline="central">target disease</text>
<rect class="step-green" x="200" y="58" width="155" height="60" rx="7"/>
<text class="slabel slabel-green" x="277" y="83"  text-anchor="middle" dominant-baseline="central">Lead compound</text>
<text class="ssub   ssub-green"   x="277" y="101" text-anchor="middle" dominant-baseline="central">structural scaffold</text>
<rect class="step-green" x="368" y="58" width="172" height="60" rx="7"/>
<text class="slabel slabel-green" x="454" y="83"  text-anchor="middle" dominant-baseline="central">Therapeutic targets</text>
<text class="ssub   ssub-green"   x="454" y="101" text-anchor="middle" dominant-baseline="central">enzymes / receptors</text>
<rect class="step-green" x="553" y="58" width="155" height="60" rx="7"/>
<text class="slabel slabel-green" x="630" y="83"  text-anchor="middle" dominant-baseline="central">Reference set</text>
<text class="ssub   ssub-green"   x="630" y="101" text-anchor="middle" dominant-baseline="central">approved oral drugs</text>
<line x1="370" y1="128" x2="370" y2="152" class="arr-main" marker-end="url(#mA)"/>

<rect class="mod-green" x="20" y="156" width="700" height="196" rx="12"/>
<text class="mtitle-green" x="370" y="178" text-anchor="middle">STAGE 1 — RATIONAL LIBRARY DESIGN</text>
<line class="mdiv" x1="36" y1="186" x2="704" y2="186"/>
<rect class="step-green" x="34"  y="196" width="196" height="58" rx="7"/>
<text class="slabel slabel-green" x="132" y="221" text-anchor="middle" dominant-baseline="central">Pharmacophore model</text>
<text class="ssub   ssub-green"   x="132" y="240" text-anchor="middle" dominant-baseline="central">PDB ligands · ConPhar</text>
<rect class="step-green" x="34"  y="270" width="196" height="70" rx="7"/>
<text class="slabel slabel-green" x="132" y="295" text-anchor="middle" dominant-baseline="central">Functionalisation sites</text>
<text class="ssub   ssub-green"   x="132" y="312" text-anchor="middle" dominant-baseline="central">structurally accessible</text>
<rect class="step-green" x="250" y="196" width="210" height="58" rx="7"/>
<text class="slabel slabel-green" x="355" y="221" text-anchor="middle" dominant-baseline="central">Functional substituents</text>
<text class="ssub   ssub-green"   x="355" y="240" text-anchor="middle" dominant-baseline="central">—OH, —NH₂, —SH, —F, —COOH…</text>
<rect class="step-green" x="250" y="270" width="210" height="70" rx="7"/>
<text class="slabel slabel-green" x="355" y="294" text-anchor="middle" dominant-baseline="central">Automated construction</text>
<text class="ssub   ssub-green"   x="355" y="312" text-anchor="middle" dominant-baseline="central">Smile-it · combinatorial SMILES</text>
<rect class="step-green" x="480" y="196" width="228" height="144" rx="7"/>
<text class="slabel slabel-green" x="594" y="252" text-anchor="middle" dominant-baseline="central">Diversity analysis</text>
<text class="ssub   ssub-green"   x="594" y="270" text-anchor="middle" dominant-baseline="central">chemical space coverage</text>
<text class="ssub   ssub-green"   x="594" y="288" text-anchor="middle" dominant-baseline="central">t-SNE · UMAP</text>
<line x1="132" y1="254" x2="132" y2="268" class="arr-main" marker-end="url(#mA)"/>
<line x1="355" y1="254" x2="355" y2="268" class="arr-main" marker-end="url(#mA)"/>
<line x1="460" y1="305" x2="478" y2="268" class="arr-main" marker-end="url(#mA)"/>
<line x1="370" y1="352" x2="370" y2="376" class="arr-main" marker-end="url(#mA)"/>

<rect class="mod-amber" x="20" y="380" width="700" height="166" rx="12"/>
<text class="mtitle-amber" x="370" y="402" text-anchor="middle">STAGE 2 — 2D FAST SCREENING (CADMA Py)</text>
<line class="mdiv" x1="36" y1="410" x2="704" y2="410"/>
<rect class="step-amber" x="34"  y="420" width="196" height="112" rx="7"/>
<text class="slabel slabel-amber" x="132" y="446" text-anchor="middle" dominant-baseline="central">ADME rule sets</text>
<text class="ssub   ssub-amber"   x="132" y="464" text-anchor="middle" dominant-baseline="central">Lipinski, Ghose, Veber,</text>
<text class="ssub   ssub-amber"   x="132" y="480" text-anchor="middle" dominant-baseline="central">REOS, Egan, Kelder</text>
<text class="ssub   ssub-amber"   x="132" y="498" text-anchor="middle" dominant-baseline="central">MW, logP, TPSA, HBD/HBA…</text>
<rect class="step-amber" x="250" y="420" width="210" height="112" rx="7"/>
<text class="slabel slabel-amber" x="355" y="445" text-anchor="middle" dominant-baseline="central">Toxicity · Synthesis</text>
<text class="ssub   ssub-amber"   x="355" y="463" text-anchor="middle" dominant-baseline="central">LD₅₀, mutagenicity,</text>
<text class="ssub   ssub-amber"   x="355" y="480" text-anchor="middle" dominant-baseline="central">DevTox, SA score</text>
<rect class="step-amber" x="480" y="420" width="228" height="112" rx="7"/>
<text class="slabel slabel-amber" x="594" y="444" text-anchor="middle" dominant-baseline="central">Selection indices</text>
<text class="ssub   ssub-amber"   x="594" y="462" text-anchor="middle" dominant-baseline="central">S_S · S_ADME · S_T · S_SA</text>
<text class="ssub   ssub-amber"   x="594" y="480" text-anchor="middle" dominant-baseline="central">vs. reference set</text>
<line x1="370" y1="546" x2="370" y2="570" class="arr-main" marker-end="url(#mA)"/>

<rect class="mod-gray" x="20" y="574" width="700" height="140" rx="12"/>
<text class="mtitle-gray" x="370" y="596" text-anchor="middle">STAGE 3 — COMPUTATIONAL REFINEMENT BASE</text>
<line class="mdiv" x1="36" y1="604" x2="704" y2="604"/>
<rect class="step-gray" x="34"  y="614" width="196" height="88" rx="7"/>
<text class="slabel slabel-gray" x="132" y="644" text-anchor="middle" dominant-baseline="central">Conformational search</text>
<text class="ssub   ssub-gray"   x="132" y="662" text-anchor="middle" dominant-baseline="central">CREST · GFN2-xTB</text>
<text class="ssub   ssub-gray"   x="132" y="680" text-anchor="middle" dominant-baseline="central">Boltzmann ensemble</text>
<rect class="step-gray" x="250" y="614" width="210" height="88" rx="7"/>
<text class="slabel slabel-gray" x="355" y="640" text-anchor="middle" dominant-baseline="central">Geometry optimisation</text>
<text class="ssub   ssub-gray"   x="355" y="658" text-anchor="middle" dominant-baseline="central">DFT M05-2X</text>
<text class="ssub   ssub-gray"   x="355" y="676" text-anchor="middle" dominant-baseline="central">6-311+G(d,p) · SMD</text>
<rect class="step-gray" x="480" y="614" width="228" height="88" rx="7"/>
<text class="slabel slabel-gray" x="594" y="636" text-anchor="middle" dominant-baseline="central">Speciation · Reactivity</text>
<text class="ssub   ssub-gray"   x="594" y="654" text-anchor="middle" dominant-baseline="central">pKa · fractions at pH 7.4</text>
<text class="ssub   ssub-gray"   x="594" y="672" text-anchor="middle" dominant-baseline="central">IE, EA, BDE, ω (∆SCF)</text>
<line x1="370" y1="714" x2="370" y2="742" class="arr-main" marker-end="url(#mA)"/>

<rect x="286" y="746" width="168" height="34" rx="17" fill="#E3F0FB" stroke="#2E7DC0" stroke-width="1.4"/>
<text class="bif-label" x="370" y="763" text-anchor="middle" dominant-baseline="central">Optional parallel routes</text>
<line x1="286" y1="763" x2="186" y2="763" class="arr-opt"/>
<line x1="186" y1="763" x2="186" y2="800" class="arr-opt" marker-end="url(#mO)"/>
<line x1="454" y1="763" x2="554" y2="763" class="arr-opt"/>
<line x1="554" y1="763" x2="554" y2="800" class="arr-opt" marker-end="url(#mO)"/>
<text class="bif-label" x="224" y="756" text-anchor="middle">Route A</text>
<text class="bif-label" x="516" y="756" text-anchor="middle">Route B</text>

<rect class="mod-teal" x="20" y="804" width="338" height="296" rx="12"/>
<text class="mtitle-teal" x="189" y="826" text-anchor="middle">ANTIOXIDANT EVALUATION</text>
<line class="mdiv" x1="36" y1="834" x2="342" y2="834"/>
<rect class="step-teal" x="34"  y="844" width="310" height="76" rx="7"/>
<text class="slabel slabel-teal" x="189" y="866" text-anchor="middle" dominant-baseline="central">eH-DAMA-FRS</text>
<text class="ssub   ssub-teal"   x="189" y="884" text-anchor="middle" dominant-baseline="central">Free Radical Scavenging</text>
<text class="ssub   ssub-teal"   x="189" y="901" text-anchor="middle" dominant-baseline="central">IE, EA, BDE · radical repair</text>
<rect class="step-teal" x="34"  y="932" width="310" height="76" rx="7"/>
<text class="slabel slabel-teal" x="189" y="954" text-anchor="middle" dominant-baseline="central">eH-DAMA-AR</text>
<text class="ssub   ssub-teal"   x="189" y="972" text-anchor="middle" dominant-baseline="central">Antioxidant Reparation</text>
<text class="ssub   ssub-teal"   x="189" y="989" text-anchor="middle" dominant-baseline="central">chemical repair of biomolecules</text>
<rect class="step-teal" x="34"  y="1020" width="310" height="54" rx="7"/>
<text class="slabel slabel-teal" x="189" y="1041" text-anchor="middle" dominant-baseline="central">eH-DAMA-OS</text>
<text class="ssub   ssub-teal"   x="189" y="1058" text-anchor="middle" dominant-baseline="central">Oxidative Stress overview</text>
<line x1="189" y1="920"  x2="189" y2="930"  class="arr-main" marker-end="url(#mA)"/>
<line x1="189" y1="1008" x2="189" y2="1018" class="arr-main" marker-end="url(#mA)"/>

<rect class="mod-blue" x="382" y="804" width="338" height="296" rx="12"/>
<text class="mtitle-blue" x="551" y="826" text-anchor="middle">MOLECULAR RECOGNITION</text>
<line class="mdiv" x1="398" y1="834" x2="704" y2="834"/>
<rect class="step-blue" x="396" y="844" width="310" height="62" rx="7"/>
<text class="slabel slabel-blue" x="551" y="863" text-anchor="middle" dominant-baseline="central">Protein preparation</text>
<text class="ssub   ssub-blue"   x="551" y="881" text-anchor="middle" dominant-baseline="central">COMT · MAO-B · AChE · PDB</text>
<rect class="step-blue" x="396" y="918" width="310" height="62" rx="7"/>
<text class="slabel slabel-blue" x="551" y="942" text-anchor="middle" dominant-baseline="central">Multi-target docking</text>
<text class="ssub   ssub-blue"   x="551" y="960" text-anchor="middle" dominant-baseline="central">AutoDock Vina · by species at pH 7.4</text>
<rect class="step-blue" x="396" y="992" width="310" height="62" rx="7"/>
<text class="slabel slabel-blue" x="551" y="1013" text-anchor="middle" dominant-baseline="central">Multi-target score</text>
<text class="ssub   ssub-blue"   x="551" y="1030" text-anchor="middle" dominant-baseline="central">S_P weighted by mole fraction</text>
<rect class="step-blue" x="396" y="1066" width="310" height="20" rx="6"/>
<text class="slabel slabel-blue" x="551" y="1076" text-anchor="middle" dominant-baseline="central">MM/GBSA rescoring · selected poses</text>
<line x1="551" y1="906" x2="551" y2="916"  class="arr-main" marker-end="url(#mA)"/>
<line x1="551" y1="980" x2="551" y2="990"  class="arr-main" marker-end="url(#mA)"/>
<line x1="551" y1="1054" x2="551" y2="1064" class="arr-main" marker-end="url(#mA)"/>

<line x1="189" y1="1074" x2="189" y2="1108" class="arr-main"/>
<line x1="189" y1="1108" x2="370"  y2="1108" class="arr-main"/>
<line x1="551" y1="1086" x2="551" y2="1108" class="arr-main"/>
<line x1="551" y1="1108" x2="370"  y2="1108" class="arr-main"/>
<line x1="370" y1="1108" x2="370"  y2="1132" class="arr-main" marker-end="url(#mA)"/>

<rect class="mod-green" x="20" y="1136" width="700" height="124" rx="12"/>
<text class="mtitle-green" x="370" y="1158" text-anchor="middle">FINAL CANDIDATE SELECTION</text>
<line class="mdiv" x1="36" y1="1166" x2="704" y2="1166"/>
<rect class="step-green" x="34"  y="1176" width="196" height="68" rx="7"/>
<text class="slabel slabel-green" x="132" y="1201" text-anchor="middle" dominant-baseline="central">Score convergence</text>
<text class="ssub   ssub-green"   x="132" y="1219" text-anchor="middle" dominant-baseline="central">S_S, S_E, eH-DAMA, S_P</text>
<rect class="step-green" x="250" y="1176" width="210" height="68" rx="7"/>
<text class="slabel slabel-green" x="355" y="1201" text-anchor="middle" dominant-baseline="central">Retrosynthesis</text>
<text class="ssub   ssub-green"   x="355" y="1219" text-anchor="middle" dominant-baseline="central">feasibility and routes</text>
<rect class="step-green" x="480" y="1176" width="228" height="68" rx="7"/>
<text class="slabel slabel-green" x="594" y="1201" text-anchor="middle" dominant-baseline="central">Proposed candidates</text>
<text class="ssub   ssub-green"   x="594" y="1219" text-anchor="middle" dominant-baseline="central">for refinement / synthesis</text>
<line x1="230" y1="1210" x2="248" y2="1210" class="arr-main" marker-end="url(#mA)"/>
<line x1="460" y1="1210" x2="478" y2="1210" class="arr-main" marker-end="url(#mA)"/>
<line x1="370" y1="1260" x2="370" y2="1284" class="arr-main" marker-end="url(#mA)"/>

<rect x="252" y="1288" width="236" height="34" rx="17" fill="#F0EFE8" stroke="#8A8880" stroke-width="1.2"/>
<text class="bif-label" x="370" y="1305" text-anchor="middle" dominant-baseline="central" style="fill:#4A4A44">Decision (resources · objectives)</text>
<line x1="252" y1="1305" x2="156" y2="1305" class="arr-opt"/>
<line x1="156" y1="1305" x2="156" y2="1338" class="arr-opt" marker-end="url(#mO)"/>
<line x1="488" y1="1305" x2="584" y2="1305" class="arr-opt"/>
<line x1="584" y1="1305" x2="584" y2="1338" class="arr-opt" marker-end="url(#mO)"/>

<rect class="mod-blue" x="20" y="1342" width="318" height="144" rx="12"/>
<text class="mtitle-blue" x="179" y="1362" text-anchor="middle">COMPUTATIONAL REFINEMENT</text>
<line class="mdiv" x1="36" y1="1370" x2="332" y2="1370"/>
<rect class="step-blue" x="34"  y="1380" width="290" height="48" rx="7"/>
<text class="slabel slabel-blue" x="179" y="1401" text-anchor="middle" dominant-baseline="central">Detailed antioxidant kinetics</text>
<text class="ssub   ssub-blue"   x="179" y="1419" text-anchor="middle" dominant-baseline="central">QM-ORSA · ∆G°, Ea · IRC</text>
<rect class="step-blue" x="34"  y="1436" width="290" height="38" rx="7"/>
<text class="slabel slabel-blue" x="179" y="1456" text-anchor="middle" dominant-baseline="central">Molecular dynamics · MM/GBSA</text>
<line x1="179" y1="1428" x2="179" y2="1434" class="arr-main" marker-end="url(#mA)"/>

<rect class="mod-pink" x="402" y="1342" width="318" height="144" rx="12"/>
<text class="mtitle-pink" x="561" y="1362" text-anchor="middle">EXPERIMENTAL VALIDATION</text>
<line class="mdiv" x1="418" y1="1370" x2="714" y2="1370"/>
<rect class="step-pink" x="416" y="1380" width="290" height="48" rx="7"/>
<text class="slabel slabel-pink" x="561" y="1401" text-anchor="middle" dominant-baseline="central">Experimental synthesis</text>
<text class="ssub   ssub-pink"   x="561" y="1419" text-anchor="middle" dominant-baseline="central">proposed candidates</text>
<rect class="step-pink" x="416" y="1436" width="290" height="38" rx="7"/>
<text class="slabel slabel-pink" x="561" y="1456" text-anchor="middle" dominant-baseline="central">In vitro / in vivo assays</text>

<line x1="179" y1="1486" x2="179" y2="1510" class="arr-main"/>
<line x1="179" y1="1510" x2="370" y2="1510" class="arr-main"/>
<line x1="561" y1="1486" x2="561" y2="1510" class="arr-main"/>
<line x1="561" y1="1510" x2="370" y2="1510" class="arr-main"/>
<line x1="370" y1="1510" x2="370" y2="1528" class="arr-main" marker-end="url(#mA)"/>
<rect class="mod-green" x="160" y="1532" width="420" height="0" rx="12"/>
</svg>
</div>

<h4>Wizard steps</h4>
<ol>
  <li><strong>Select a reference family</strong> — pick a pre-built disease baseline (Neuro, RETT) or create a custom family.</li>
  <li><strong>Upload candidates</strong> — import molecular data from Smile-it, Toxicity Properties and SA Score jobs, or upload CSVs.</li>
  <li><strong>Configure the formula</strong> — adjust reference values, ADME interval windows and component weights.</li>
  <li><strong>View results</strong> — inspect the ranked table, score chart and per-metric plots, then export CSV.</li>
</ol>
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
  CADMA-Chem adopts the <strong>restrictive overlap</strong> of these ranges to
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
    <tr><td><strong>CADMA-Chem</strong></td><td><strong>200–480</strong></td><td><strong>−0.4–5.0</strong></td><td><strong>0–5</strong></td><td><strong>0–10</strong></td><td><strong>0–70</strong></td><td><strong>0–8</strong></td><td><strong>40–130</strong></td><td><strong>20–50</strong></td></tr>
  </tbody>
</table>

<h4>Additional heuristics</h4>
<ul>
  <li><strong>CNS polarity window:</strong> TPSA ≤ 60–70 Å², MW ≤ 400, logP ~2–4 → favours CNS penetration.</li>
  <li><strong>Pfizer 3/75:</strong> logP &gt; 3 and TPSA &lt; 75 Å² → higher toxicity risk from excessive permeability.</li>
  <li><strong>Pfizer 2/100:</strong> HBD ≤ 2 and TPSA &lt; 100 Å² → good probability of oral absorption.</li>
  <li><strong>GSK 4/400:</strong> logP ≤ 4 and MW ≤ 400 → reduced clinical failure probability from toxicity.</li>
  <li><strong>Teague lead optimisation:</strong> early leads: MW 100–350, logP 1–3 — leaves room for growth during optimisation.</li>
  <li><strong>Brenk structural alerts:</strong> identifies reactive substructures that may compromise safety.</li>
</ul>

<p>
  Each physicochemical metric has a configurable <strong>interval window</strong>
  (min–max). A candidate passes a metric when its value falls inside the band.
</p>

<table>
  <thead>
    <tr><th>Metric</th><th>Description</th><th>Default min</th><th>Default max</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>MW</strong></td><td>Molecular Weight (Da)</td><td>200</td><td>480</td></tr>
    <tr><td><strong>logP</strong></td><td>Octanol-water partition coefficient</td><td>−0.4</td><td>5.0</td></tr>
    <tr><td><strong>MR</strong></td><td>Molar Refractivity (cm³)</td><td>40</td><td>130</td></tr>
    <tr><td><strong>AtX</strong></td><td>Heavy atom count</td><td>20</td><td>50</td></tr>
    <tr><td><strong>HBLA</strong></td><td>HB Acceptors</td><td>0</td><td>10</td></tr>
    <tr><td><strong>HBLD</strong></td><td>HB Donors</td><td>0</td><td>5</td></tr>
    <tr><td><strong>RB</strong></td><td>Rotatable Bonds</td><td>0</td><td>8</td></tr>
    <tr><td><strong>PSA</strong></td><td>Polar Surface Area (Å²)</td><td>0</td><td>70</td></tr>
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
  CADMA Py relies on <strong>RDKit</strong> to compute a panel of physicochemical
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
  For each metric the reference family supplies a <strong>mean and standard
  deviation</strong>. The binary flag for each property is:
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
  A <strong>reference set</strong> is a curated collection of drugs that define
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
    <tr><td><strong>Neuro</strong></td><td>291.31</td><td>2.55</td><td>1131.37</td><td>74.07</td></tr>
    <tr><td><strong>RETT</strong></td><td>289.77</td><td>2.22</td><td>1751.04</td><td>76.98</td></tr>
  </tbody>
</table>

<ul>
  <li><strong>Neuro</strong> — approved drugs for neurological conditions (epilepsy, Parkinson's, Alzheimer's, etc.)</li>
  <li><strong>RETT</strong> — compounds relevant to Rett syndrome and related developmental disorders</li>
</ul>

<h4>Required input files for custom families</h4>
<p>To build a new reference set you need:</p>
<ol>
  <li><strong>SMILES file</strong> — containing <code>name</code> and <code>smile</code> columns.</li>
  <li><strong>Toxicity CSVs</strong> — from EPA TEST: DT, M (Ames), LD50.</li>
  <li><strong>Synthetic accessibility CSV</strong> — SA index from AMBIT (scale 1–100).</li>
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
  <strong>Interpretation:</strong>
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
  <li><strong>From a selection-score CSV:</strong> load a \\(S_S\\) CSV, pick the top-N
    molecules by score, and generate their 3D structures.</li>
  <li><strong>From a manual SMILES list:</strong> paste SMILES strings (one per line).
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
  <li>Generate \\(N\\) conformers using <strong>ETKDGv3</strong></li>
  <li>Optimise with <strong>UFF</strong> force field</li>
  <li>Select the lowest-energy conformer → <strong>SDF</strong> export</li>
</ol>

<p>
  The SDF output contains optimised 3D coordinates, compound name, selection
  score and other properties as SD tags, ready for external tools (Gaussian,
  ORCA, AutoDock, etc.).
</p>

<div class="infobox">
  <strong>Note:</strong> Generated conformers are <strong>starting points</strong>
  — they lack solvent effects and electronic-level optimisation. Re-optimisation
  with DFT or other appropriate methods is essential before final energy
  calculations or docking.
</div>
`,
  },
];
