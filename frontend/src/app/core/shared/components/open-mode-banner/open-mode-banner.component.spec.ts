import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import { JobAccessModeService } from '../../../auth/job-access-mode.service';
import { OpenModeBannerComponent } from './open-mode-banner.component';

describe('OpenModeBannerComponent', () => {
  let fixture: ComponentFixture<OpenModeBannerComponent>;
  beforeEach(async () => {
    JobAccessModeService.current = { isOpenMode: signal(true) };
    await TestBed.configureTestingModule({
      imports: [OpenModeBannerComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
      providers: [],
    }).compileComponents();
    fixture = TestBed.createComponent(OpenModeBannerComponent);
  });

  it('shows the banner only in open mode', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.open-mode-banner')).not.toBeNull();
  });

  it('hides the banner for account mode', () => {
    JobAccessModeService.current = { isOpenMode: signal(false) };
    TestBed.resetTestingModule();
    const accountFixture = TestBed.configureTestingModule({
      imports: [OpenModeBannerComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
      providers: [],
    }).createComponent(OpenModeBannerComponent);
    accountFixture.detectChanges();
    expect(accountFixture.nativeElement.querySelector('.open-mode-banner')).toBeNull();
  });
});
