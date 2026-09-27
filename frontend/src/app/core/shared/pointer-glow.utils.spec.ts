// pointer-glow.utils.spec.ts: el resplandor se ancla en coordenadas del shell.

import { trackGlowPointer } from './pointer-glow.utils';

describe('trackGlowPointer', () => {
  it('escribe --glow-x/--glow-y relativas al shell', () => {
    const shell = document.createElement('section');
    shell.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 100 }) as DOMRect;

    trackGlowPointer({ clientX: 60, clientY: 70 } as PointerEvent, shell);

    expect(shell.style.getPropertyValue('--glow-x')).toBe('50px');
    expect(shell.style.getPropertyValue('--glow-y')).toBe('50px');
  });
});
