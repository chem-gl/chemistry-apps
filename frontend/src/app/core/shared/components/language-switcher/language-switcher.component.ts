// language-switcher.component.ts: Selector global de idioma con menú desplegable e iconos de banderas.

import { CommonModule } from '@angular/common';
import { Component, HostListener, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../../i18n/language.service';
import { SupportedLanguageCode, SupportedLanguageOption } from '../../../i18n/supported-languages';

@Component({
  selector: 'app-language-switcher',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './language-switcher.component.html',
  styleUrl: './language-switcher.component.scss',
})
export class LanguageSwitcherComponent {
  readonly languageService = inject(LanguageService);
  readonly isMenuOpen = signal<boolean>(false);

  readonly selectedLanguageOption = (): SupportedLanguageOption => {
    const activeCode = this.languageService.activeLanguageCode();
    return (
      this.languageService.languageOptions.find((option) => option.code === activeCode) ??
      this.languageService.languageOptions[0]
    );
  };

  toggleMenu(): void {
    this.isMenuOpen.update((currentState) => !currentState);
  }

  selectLanguage(languageCode: SupportedLanguageCode): void {
    this.languageService.setLanguage(languageCode);
    this.isMenuOpen.set(false);
  }

  @HostListener('document:click')
  closeMenu(): void {
    this.isMenuOpen.set(false);
  }

  keepMenuOpen(clickEvent: Event): void {
    clickEvent.stopPropagation();
  }
}
