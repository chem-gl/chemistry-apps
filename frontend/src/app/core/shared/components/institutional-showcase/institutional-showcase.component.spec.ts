import { TestBed } from '@angular/core/testing';
import { provideTestingTransloco } from '../../../i18n/testing-transloco.provider';
import { InstitutionalShowcaseComponent } from './institutional-showcase.component';

describe('InstitutionalShowcaseComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InstitutionalShowcaseComponent],
      providers: [provideTestingTransloco()],
    }).compileComponents();
  });

  it('renders the complete team and publication lists', () => {
    const fixture = TestBed.createComponent(InstitutionalShowcaseComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.developer-card')).toHaveLength(5);
    expect(fixture.nativeElement.querySelectorAll('.publication-card')).toHaveLength(4);
  });

  it('supports the hub visual variant', () => {
    const fixture = TestBed.createComponent(InstitutionalShowcaseComponent);
    fixture.componentRef.setInput('variant', 'hub');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.showcase').classList.contains('is-hub')).toBe(true);
  });
});
