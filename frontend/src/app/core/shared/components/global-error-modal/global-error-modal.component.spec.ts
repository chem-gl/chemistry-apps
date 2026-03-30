// global-error-modal.component.spec.ts: Pruebas unitarias del modal global de errores compartido.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GlobalErrorModalService } from '../../../application/errors/global-error-modal.service';
import { GlobalErrorModalComponent } from './global-error-modal.component';

describe('GlobalErrorModalComponent', () => {
  let fixture: ComponentFixture<GlobalErrorModalComponent>;
  let service: GlobalErrorModalService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlobalErrorModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(GlobalErrorModalComponent);
    service = TestBed.inject(GlobalErrorModalService);
  });

  it('renders modal content when an error exists', () => {
    service.showMessage('Backend unavailable', 'Request failed');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Request failed');
    expect(element.textContent).toContain('Backend unavailable');
  });

  it('closes modal when close button is clicked', () => {
    service.showMessage('Temporary issue');
    fixture.detectChanges();

    const closeButton = fixture.nativeElement.querySelector(
      '.error-modal-close-button',
    ) as HTMLButtonElement;
    closeButton.click();
    fixture.detectChanges();

    expect(service.currentError()).toBeNull();
  });
});
