// ketcher-frame.service.spec.ts: Pruebas unitarias del servicio reutilizable para resolver API de Ketcher en iframes.

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { KetcherFrameService } from './ketcher-frame.service';

describe('KetcherFrameService', () => {
  let service: KetcherFrameService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(KetcherFrameService);
  });

  it('should return null when iframe is undefined', () => {
    const resolvedApi = service.resolveApi(undefined);

    expect(resolvedApi).toBeNull();
  });

  it('should resolve ketcher api from iframe contentWindow', () => {
    const iframeElement = document.createElement('iframe');
    const ketcherApi = {
      getSmiles: async () => 'CCO',
      setMolecule: async (_molecule: string) => {},
    };

    Object.defineProperty(iframeElement, 'contentWindow', {
      value: { ketcher: ketcherApi },
      configurable: true,
    });

    const resolvedApi = service.resolveApi(iframeElement);

    expect(resolvedApi).not.toBeNull();
  });

  it('should wait and resolve api when iframe is ready', async () => {
    const iframeElement = document.createElement('iframe');
    const ketcherApi = {
      getSmiles: async () => 'NCCO',
      setMolecule: async (_molecule: string) => {},
    };

    Object.defineProperty(iframeElement, 'contentWindow', {
      value: { ketcher: ketcherApi },
      configurable: true,
    });

    const resolvedApi = await service.waitForApi(iframeElement, 1, 0);

    expect(resolvedApi).not.toBeNull();
    const smilesValue = await resolvedApi?.getSmiles();
    expect(smilesValue).toBe('NCCO');
  });

  it('should return null when max attempts are exhausted', async () => {
    const iframeElement = document.createElement('iframe');

    Object.defineProperty(iframeElement, 'contentWindow', {
      value: {},
      configurable: true,
    });

    const resolvedApi = await service.waitForApi(iframeElement, 2, 0);

    expect(resolvedApi).toBeNull();
  });

  it('should fail fast when maxAttempts is invalid', async () => {
    await expect(service.waitForApi(undefined, 0, 0)).rejects.toThrow(
      'maxAttempts must be greater than 0.',
    );
  });
});
