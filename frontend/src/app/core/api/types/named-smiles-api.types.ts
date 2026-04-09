// named-smiles-api.types.ts: Tipo compartido para entradas batch name/smiles en la capa API del frontend.
// Uso: reutilizar en apps que aceptan listas de moléculas nombradas para evitar tipos duplicados.

export interface NamedSmilesJobMolecule {
  name: string;
  smiles: string;
}
