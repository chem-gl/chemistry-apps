"""BRSAScore.py: Calcula BR-SAScore y descriptores de complejidad molecular.

Este modulo conserva la API historica de ``calculateScore`` y agrega
``calculateScoreWithDescriptors`` para exponer descriptores adicionales
relevantes para analisis de complejidad estructural.
"""

#
# calculation of synthetic accessibility score as described in:
#
# Estimation of Synthetic Accessibility Score of Drug-like Molecules based on
# Molecular Complexity and Fragment Contributions
# Peter Ertl and Ansgar Schuffenhauer
# Journal of Cheminformatics 1:8 (2009)
# http://www.jcheminf.com/content/1/1/8
#
# several small modifications to the original paper are included
# particularly slightly different formula for marocyclic penalty
# and taking into account also molecule symmetry (fingerprint density)
#
# for a set of 10k diverse molecules the agreement between the original method
# as implemented in PipelinePilot and this implementation is r2 = 0.97
#
# peter ertl & greg landrum, september 2013
#

import gzip
import math
import pickle
from pathlib import Path
from typing import TypedDict

import matplotlib.cm as cm
from rdkit import Chem
from rdkit.Chem import rdDepictor, rdMolDescriptors
from rdkit.Chem.Draw import rdMolDraw2D


class DescriptorPayload(TypedDict):
    """Estructura tipada para exponer valor y score opcional del descriptor."""

    value: int | float | None
    score: float | None


DescriptorMap = dict[str, DescriptorPayload]


def numBridgeheadsAndSpiro(mol: Chem.Mol) -> tuple[int, int]:
    nSpiro = rdMolDescriptors.CalcNumSpiroAtoms(mol)
    nBridgehead = rdMolDescriptors.CalcNumBridgeheadAtoms(mol)
    return nBridgehead, nSpiro


def numMacroAndMulticycle(mol: Chem.Mol, nAtoms: int) -> tuple[int, int]:
    ri = mol.GetRingInfo()
    nMacrocycles: int = 0
    multi_ring_atoms: dict[int, int] = {i: 0 for i in range(nAtoms)}
    for ring_atoms in ri.AtomRings():
        if len(ring_atoms) > 6:
            nMacrocycles += 1
        for atom in ring_atoms:
            multi_ring_atoms[atom] += 1
    nMultiRingAtoms = sum([v - 1 for _, v in multi_ring_atoms.items() if v > 1])
    return nMacrocycles, nMultiRingAtoms


class SAScorer:
    """Calculadora de BR-SAScore con soporte de descriptores auxiliares."""

    def __init__(
        self,
        reaction_from: str = "uspto",
        buildingblock_from: str = "emolecules",
        frag_penalty: float = -6.0,
        complexity_buffer: float = 1.0,
    ) -> None:
        pickle_filename: str = "BRScores_%s_%s.pkl.gz" % (
            reaction_from,
            buildingblock_from,
        )
        pickle_path = Path(__file__).resolve().parent / "pickle" / pickle_filename
        self._fscores = pickle.load(gzip.open(pickle_path))
        self.frag_penalty = frag_penalty
        self.max_score = 0
        self.min_score = frag_penalty - complexity_buffer

    def _build_molecule(self, smiles: str) -> Chem.Mol:
        """Construye una molecula RDKit y valida que el SMILES sea parseable."""
        molecule: Chem.Mol | None = Chem.MolFromSmiles(smiles)
        if molecule is None:
            raise ValueError("Invalid SMILES string")
        return molecule

    def _scale_score(self, score: float) -> float:
        """Normaliza score crudo a la escala historica de 1 a 10."""
        normalized_score: float = (score - self.min_score) / (
            self.max_score - self.min_score
        )
        if normalized_score > 1:
            normalized_score = 1
        elif normalized_score < 0.0:
            normalized_score = 0
        return 10 - normalized_score * 9

    def _calculate_score_details(
        self, molecule: Chem.Mol
    ) -> tuple[float, dict[int, float], DescriptorMap]:
        """Calcula score BR-SAScore y los descriptores solicitados."""
        sascore: float = 0
        contribution: dict[int, float] = {}

        # fragment score
        bit_info: dict[int, list[tuple[int, int]]] = {}
        fingerprint = rdMolDescriptors.GetMorganFingerprint(
            molecule,
            2,
            useChirality=True,
            bitInfo=bit_info,
        )

        nonzero_fingerprint_elements: dict[int, int] = fingerprint.GetNonzeroElements()
        fragment_score: float = 0.0
        negative_fragment_count: int = 0
        for bitId, vs in bit_info.items():
            if vs[0][1] != 2:
                continue
            fscore = self._fscores.get(bitId, self.frag_penalty)
            if fscore < 0:
                negative_fragment_count += 1
                fragment_score += fscore
                for v in vs:
                    contribution[v[0]] = fscore

        molecular_complexity_value: float | None = None
        if negative_fragment_count != 0:
            fragment_score /= negative_fragment_count
            molecular_complexity_value = fragment_score
        sascore += fragment_score

        # features score
        atom_count: int = molecule.GetNumAtoms()
        chiral_center_count: int = len(
            Chem.FindMolChiralCenters(molecule, includeUnassigned=True)
        )
        bridgehead_count, spiro_count = numBridgeheadsAndSpiro(molecule)
        macrocycle_count, multicycle_atom_count = numMacroAndMulticycle(
            molecule,
            atom_count,
        )

        sizePenalty = atom_count**1.005 - atom_count
        stereoPenalty = math.log10(chiral_center_count + 1)
        spiroPenalty = math.log10(spiro_count + 1)
        bridgePenalty = math.log10(bridgehead_count + 1)
        macrocyclePenalty = math.log10(2) if macrocycle_count > 0 else 0
        multicyclePenalty = math.log10(multicycle_atom_count + 1)

        score2 = (
            0.0
            - sizePenalty
            - stereoPenalty
            - spiroPenalty
            - bridgePenalty
            - macrocyclePenalty
            - multicyclePenalty
        )
        sascore += score2

        # correction for the fingerprint density
        # not in the original publication, added in version 1.1
        # to make highly symmetrical molecules easier to synthetise
        score3: float = 0.0
        fingerprint_count: int = len(nonzero_fingerprint_elements)
        if fingerprint_count > 0 and atom_count > fingerprint_count:
            score3 = math.log(float(atom_count) / fingerprint_count) * 0.5
        sascore += score3

        ring_complexity_value: int = rdMolDescriptors.CalcNumRings(molecule)
        connected_components: int = len(Chem.GetMolFrags(molecule))
        cyclomatic_number_value: int = (
            molecule.GetNumBonds() - atom_count + connected_components
        )

        descriptor_map: DescriptorMap = {
            "molecular_complexity": {
                "value": molecular_complexity_value,
                "score": fragment_score
                if molecular_complexity_value is not None
                else None,
            },
            "stereochemical_complexity": {
                "value": chiral_center_count,
                "score": stereoPenalty,
            },
            "cyclomatic_number": {
                "value": cyclomatic_number_value,
                "score": None,
            },
            "ring_complexity": {
                "value": ring_complexity_value,
                "score": None,
            },
        }

        scaled_score: float = self._scale_score(sascore)
        return scaled_score, contribution, descriptor_map

    def calculateScore(self, smi: str) -> tuple[float, dict[int, float]]:
        """Retorna score y contribuciones atomicas (API historica)."""
        molecule: Chem.Mol = self._build_molecule(smi)
        score, contribution, _ = self._calculate_score_details(molecule)
        return score, contribution

    def calculateScoreWithDescriptors(
        self,
        smi: str,
    ) -> tuple[float, dict[int, float], DescriptorMap]:
        """Retorna score, contribuciones y descriptores de complejidad."""
        molecule: Chem.Mol = self._build_molecule(smi)
        return self._calculate_score_details(molecule)

    def contribution_to_svg(self, smiles: str, contribution: dict[int, float]) -> str:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            raise ValueError("Invalid SMILES string")
        norm = cm.colors.Normalize(vmin=0, vmax=1)
        cmap = cm.get_cmap("OrRd")
        plt_colors = cm.ScalarMappable(norm=norm, cmap=cmap)
        n_atoms = len(mol.GetAtoms())
        weights = [(-contribution.get(i, 0) / 6) for i in range(n_atoms)]
        atom_colors = {i: plt_colors.to_rgba(w) for i, w in enumerate(weights)}
        rdDepictor.Compute2DCoords(mol)
        dr = rdMolDraw2D.MolDraw2DSVG(400, 370)
        do = rdMolDraw2D.MolDrawOptions()
        do.bondLineWidth = 4
        do.fixedBondLength = 30
        do.highlightRadius = 4
        mol = rdMolDraw2D.PrepareMolForDrawing(mol)
        dr.DrawMolecule(
            mol,
            highlightAtoms=range(n_atoms),
            highlightBonds=[],
            highlightAtomColors=atom_colors,
        )
        dr.FinishDrawing()
        svg = dr.GetDrawingText()
        svg = svg.replace("svg:", "")
        return svg


#
#  Copyright (c) 2013, Novartis Institutes for BioMedical Research Inc.
#  All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are
# met:
#
#     * Redistributions of source code must retain the above copyright
#       notice, this list of conditions and the following disclaimer.
#     * Redistributions in binary form must reproduce the above
#       copyright notice, this list of conditions and the following
#       disclaimer in the documentation and/or other materials provided
#       with the distribution.
#     * Neither the name of Novartis Institutes for BioMedical Research Inc.
#       nor the names of its contributors may be used to endorse or promote
#       products derived from this software without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
# "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
# LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
# A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
# OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
# SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
# LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
# DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
# THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
# (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
# OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
#
