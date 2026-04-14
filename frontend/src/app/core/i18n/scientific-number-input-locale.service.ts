// scientific-number-input-locale.service.ts: Fuerza separador decimal con punto en inputs numéricos científicos sin alterar el idioma general de la interfaz.

import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { LanguageService } from './language.service';

const SCIENTIFIC_NUMBER_INPUT_LANGUAGE = 'en-US';
const LOCALIZED_DECIMAL_OPT_OUT_DATASET_KEY = 'decimalLocale';
const LOCALIZED_DECIMAL_OPT_OUT_VALUE = 'auto';

@Injectable({ providedIn: 'root' })
export class ScientificNumberInputLocaleService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly languageService = inject(LanguageService);
  private observer: MutationObserver | null = null;
  private isInitialized = false;

  constructor() {
    effect(() => {
      this.syncDocumentLanguage(this.languageService.activeLanguageCode());
    });

    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      this.observer = null;
    });
  }

  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
    this.applyScientificLocaleToNumberInputs(this.document);
    this.observeFutureNumberInputs();
  }

  private syncDocumentLanguage(languageCode: string): void {
    this.document.documentElement.lang = languageCode;
  }

  private observeFutureNumberInputs(): void {
    const bodyElement = this.document.body;
    if (!bodyElement || typeof MutationObserver === 'undefined') {
      return;
    }

    this.observer = new MutationObserver((mutationRecords) => {
      mutationRecords.forEach((mutationRecord) => {
        if (
          mutationRecord.type === 'attributes' &&
          mutationRecord.target instanceof HTMLInputElement
        ) {
          this.applyScientificLocaleToInput(mutationRecord.target);
          return;
        }

        mutationRecord.addedNodes.forEach((addedNode) => {
          this.applyScientificLocaleToNode(addedNode);
        });
      });
    });

    this.observer.observe(bodyElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type'],
    });
  }

  private applyScientificLocaleToNode(node: Node): void {
    if (!(node instanceof Element)) {
      return;
    }

    this.applyScientificLocaleToNumberInputs(node);
  }

  private applyScientificLocaleToNumberInputs(rootNode: ParentNode): void {
    if (rootNode instanceof HTMLInputElement) {
      this.applyScientificLocaleToInput(rootNode);
      return;
    }

    if (!('querySelectorAll' in rootNode)) {
      return;
    }

    rootNode.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach((numberInput) => {
      this.applyScientificLocaleToInput(numberInput);
    });
  }

  private applyScientificLocaleToInput(numberInput: HTMLInputElement): void {
    if (
      numberInput.type !== 'number' ||
      numberInput.dataset[LOCALIZED_DECIMAL_OPT_OUT_DATASET_KEY] === LOCALIZED_DECIMAL_OPT_OUT_VALUE
    ) {
      return;
    }

    numberInput.lang = SCIENTIFIC_NUMBER_INPUT_LANGUAGE;
    numberInput.setAttribute('inputmode', 'decimal');
  }
}
