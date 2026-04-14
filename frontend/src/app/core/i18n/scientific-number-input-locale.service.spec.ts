// scientific-number-input-locale.service.spec.ts: Valida que los inputs numéricos usen punto decimal de forma global y que el idioma documental siga el idioma activo.

import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { vi } from 'vitest';
import { LanguageService } from './language.service';
import { ScientificNumberInputLocaleService } from './scientific-number-input-locale.service';

describe('ScientificNumberInputLocaleService', () => {
  const translocoServiceMock = {
    setActiveLang: vi.fn(),
  };

  let languageService: LanguageService;
  let service: ScientificNumberInputLocaleService;

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.lang = 'en-US';
    document.body.innerHTML = '';

    TestBed.configureTestingModule({
      providers: [
        LanguageService,
        ScientificNumberInputLocaleService,
        { provide: TranslocoService, useValue: translocoServiceMock },
      ],
    });

    languageService = TestBed.inject(LanguageService);
    service = TestBed.inject(ScientificNumberInputLocaleService);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sincroniza el idioma del documento con el idioma activo de la aplicación', () => {
    // Verifica que el atributo lang del documento siga el idioma elegido para accesibilidad y traducciones.
    languageService.setLanguage('es');
    TestBed.flushEffects();

    expect(document.documentElement.lang).toBe('es');
    expect(translocoServiceMock.setActiveLang).toHaveBeenCalledWith('es');
  });

  it('fuerza locale con punto decimal en inputs numéricos ya presentes', () => {
    // Verifica que los campos científicos existentes se normalicen al inicializar el servicio.
    document.body.innerHTML = '<input type="number"><input type="text">';

    service.initialize();

    const numberInput = document.querySelector('input[type="number"]');
    const textInput = document.querySelector('input[type="text"]');

    expect(numberInput?.getAttribute('lang')).toBe('en-US');
    expect(numberInput?.getAttribute('inputmode')).toBe('decimal');
    expect(textInput?.getAttribute('lang')).toBeNull();
  });

  it('normaliza inputs numéricos agregados dinámicamente sin tocar los que optan por locale local', async () => {
    // Verifica el caso común de formularios renderizados después del arranque de la app.
    service.initialize();

    const dynamicNumberInput = document.createElement('input');
    dynamicNumberInput.type = 'number';

    const optOutNumberInput = document.createElement('input');
    optOutNumberInput.type = 'number';
    optOutNumberInput.dataset['decimalLocale'] = 'auto';

    document.body.append(dynamicNumberInput, optOutNumberInput);
    await Promise.resolve();

    expect(dynamicNumberInput.getAttribute('lang')).toBe('en-US');
    expect(optOutNumberInput.getAttribute('lang')).toBeNull();
  });
});
