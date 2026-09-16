// login.component.ts: Portal de acceso institucional — CADMA-Chem Suite.
// Identidad: Química Teórica y Aplicada. UAM-UNAM.

import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { IdentitySessionService } from '../core/auth/identity-session.service';

interface DeveloperEntry {
  nameKey: string;
  roleKey: string;
  affiliationKey: string | null;
  photoUrl: string | null;
  initials: string;
  avatarColor: string;
  link: string;
}

interface PublicationEntry {
  title: string;
  authors: string;
  journal: string;
  year: number;
  doi: string;
}

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule, RouterModule, TranslocoPipe, NgOptimizedImage],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  readonly sessionService = inject(IdentitySessionService);
  private readonly translocoService = inject(TranslocoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  ngOnInit(): void {
    if (this.sessionService.isAuthenticated()) {
      const redirectTarget = this.route.snapshot.queryParamMap.get('redirectTo') ?? '/dashboard';
      void this.router.navigateByUrl(redirectTarget);
    }
  }

  readonly username = signal<string>('');
  readonly password = signal<string>('');
  readonly localErrorMessage = signal<string | null>(null);

  readonly developers = signal<DeveloperEntry[]>([
    {
      nameKey: 'login.developers.anniaGalano',
      roleKey: 'login.developers.roleDirector',
      affiliationKey: 'login.developers.affUAM',
      photoUrl: 'assets/team/annia-galano.png',
      initials: 'AG',
      avatarColor: '#4A725A',
      link: 'https://agalano.com/',
    },
    {
      nameKey: 'login.developers.miguelReina',
      roleKey: 'login.developers.roleResearcher',
      affiliationKey: 'login.developers.affUNAM',
      photoUrl: 'assets/team/miguel-reina.jpg',
      initials: 'MR',
      avatarColor: '#003C71',
      link: 'https://scholar.google.com.mx/citations?user=6icbJxoAAAAJ&hl=es',
    },
    {
      nameKey: 'login.developers.luisAyala',
      roleKey: 'login.developers.roleResearcher',
      affiliationKey: 'login.developers.affUNAM',
      photoUrl: 'assets/team/luis-ayala.jpeg',
      initials: 'LF',
      avatarColor: '#003C71',
      link: 'https://scholar.google.com.mx/citations?user=TXDPjp4AAAAJ&hl=es',
    },
    {
      nameKey: 'login.developers.cesarGuzman',
      roleKey: 'login.developers.roleDeveloper',
      affiliationKey: null,
      photoUrl: 'assets/team/cesar-guzman.jpeg',
      initials: 'CG',
      avatarColor: '#6E967E',
      link: 'https://github.com/CesarGuzmanLopez',
    },
    {
      nameKey: 'login.developers.eduardoGuzman',
      roleKey: 'login.developers.roleCreator',
      affiliationKey: null,
      photoUrl: 'assets/team/eduardo-guzman.png',
      initials: 'EG',
      avatarColor: '#317154',
      link: 'https://scholar.google.com.mx/citations?user=yPVWngwAAAAJ&hl=es',
    },
  ]);

  readonly publications = signal<PublicationEntry[]>([
    {
      title: 'CADMA-Chem: A Computational Protocol Based on Chemical Properties Aimed to Design Multifunctional Antioxidants',
      authors: 'Guzmán-López, E. G., Reina, M., Pérez-González, A., Francisco-Márquez, M., Hernández-Ayala, L., Castañeda-Arriaga, R., Galano, A.',
      journal: 'Int. J. Mol. Sci.',
      year: 2022,
      doi: 'https://doi.org/10.3390/ijms232113246',
    },
    {
      title: 'A Computational Methodology for Accurate Predictions of Rate Constants in Solution: Application to Primary Antioxidant Activity',
      authors: 'Galano, A., Alvarez-Idaboy, J. R.',
      journal: 'J. Comput. Chem.',
      year: 2013,
      doi: 'https://doi.org/10.1002/jcc.23409',
    },
    {
      title: 'Antioxidants: The Chemical Complexity Behind a Simple Word',
      authors: 'Galano, A.',
      journal: 'Acc. Chem. Res.',
      year: 2025,
      doi: 'https://doi.org/10.1021/acs.accounts.5c00552',
    },
    {
      title: 'Antioxidant Activity at the Molecular Level: Exploring Ways of Action and Computational Tools to Investigate Them',
      authors: 'Galano, A.',
      journal: 'Chem. Sci.',
      year: 2025,
      doi: 'https://doi.org/10.1039/D5SC05463J',
    },
  ]);

  onDeveloperPhotoError(event: Event, dev: DeveloperEntry): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    dev.photoUrl = null;
  }

  submit(): void {
    this.localErrorMessage.set(null);
    this.sessionService.login(this.username(), this.password()).subscribe({
      next: (wasAuthenticated: boolean) => {
        if (!wasAuthenticated) {
          this.localErrorMessage.set(
            this.sessionService.lastAuthenticationError() ??
              this.translocoService.translate('login.errors.unableToAuthenticate'),
          );
          return;
        }

        const redirectTarget = this.route.snapshot.queryParamMap.get('redirectTo') ?? '/dashboard';
        void this.router.navigateByUrl(redirectTarget);
      },
      error: (loginError: { message?: string }) => {
        this.localErrorMessage.set(
          loginError.message ??
            this.translocoService.translate('login.errors.unableToAuthenticate'),
        );
      },
    });
  }
}