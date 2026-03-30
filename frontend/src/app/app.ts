// app.ts: Layout principal con navegacion entre monitor y apps cientificas.

import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { GlobalErrorModalComponent } from './core/shared/components/global-error-modal/global-error-modal.component';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, GlobalErrorModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly primaryNavigationItems: ReadonlyArray<{ label: string; path: string; hint: string }> = [
    { label: 'Jobs Monitor', path: '/jobs', hint: 'Track active and completed jobs' },
    {
      label: 'Molar Fractions',
      path: '/molar-fractions',
      hint: 'Compute molar fractions by pH',
    },
    {
      label: 'Tunnel Effect',
      path: '/tunnel',
      hint: 'Calculate tunneling correction and trace input edits',
    },
    {
      label: 'Easy-rate',
      path: '/easy-rate',
      hint: 'TST + Eckart tunnel rate constants from Gaussian logs',
    },
    {
      label: 'Marcus',
      path: '/marcus',
      hint: 'Marcus theory energies and rate constants',
    },
    {
      label: 'Smileit',
      path: '/smileit',
      hint: 'Combinatorial SMILES generation and substitution workflow',
    },
    {
      label: 'SA Score',
      path: '/sa-score',
      hint: 'Synthetic accessibility scoring for SMILES batches',
    },
    {
      label: 'Toxicity Properties',
      path: '/toxicity-properties',
      hint: 'ADMET-AI toxicity predictions from SMILES batches',
    },
    { label: 'Apps', path: '/apps', hint: 'Library and future scientific apps' },
  ];
}
