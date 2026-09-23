// app-card-thumbnail.component.spec.ts: Pruebas de la miniatura dual captura/ilustración.

import { TestBed } from '@angular/core/testing';
import { ScientificAppRouteItem } from '../../scientific-apps.config';
import { AppCardThumbnailComponent } from './app-card-thumbnail.component';

const ITEM_WITH_SCREENSHOT: ScientificAppRouteItem = {
  key: 'molar-fractions',
  pluginName: 'molar-fractions',
  title: 'Molar Fractions',
  description: 'Acid-base fractions.',
  routePath: '/molar-fractions',
  available: true,
  visibleInMenus: true,
  freeAccess: true,
  thumbnailScreenshot: 'assets/thumbnails/molar-fractions.jpg',
};

describe('AppCardThumbnailComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppCardThumbnailComponent],
    }).compileComponents();
  });

  it('muestra la captura en modo screenshot cuando existe', () => {
    const fixture = TestBed.createComponent(AppCardThumbnailComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('appItem', ITEM_WITH_SCREENSHOT);
    fixture.componentRef.setInput('mode', 'screenshot');

    expect(component.showScreenshot()).toBe(true);
  });

  it('usa la ilustración en modo illustration o si falla la captura', () => {
    const fixture = TestBed.createComponent(AppCardThumbnailComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('appItem', ITEM_WITH_SCREENSHOT);
    fixture.componentRef.setInput('mode', 'illustration');

    expect(component.showScreenshot()).toBe(false);

    fixture.componentRef.setInput('mode', 'screenshot');
    component.onScreenshotError();

    expect(component.showScreenshot()).toBe(false);
  });

  it('usa la ilustración cuando la app no tiene captura', () => {
    const fixture = TestBed.createComponent(AppCardThumbnailComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('appItem', { ...ITEM_WITH_SCREENSHOT, thumbnailScreenshot: undefined });

    expect(component.showScreenshot()).toBe(false);
  });
});
