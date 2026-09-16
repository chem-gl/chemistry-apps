import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CadmaPyDeleteModalComponent } from './cadma-py-delete-modal.component';

describe('CadmaPyDeleteModalComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [CadmaPyDeleteModalComponent] }));

  it('renders dynamic titles and emits cascade confirmation', () => {
    const fixture = TestBed.createComponent(CadmaPyDeleteModalComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('libraryName', 'Family');
    fixture.componentRef.setInput('linkedJobs', [{ id: 'j1', status: 'completed', created_at: '', project_label: '' }]);
    fixture.detectChanges();
    const confirmed = vi.fn();
    component.confirmed.subscribe(confirmed);
    expect((component as unknown as { headerTitle: () => string }).headerTitle()).toBe('Delete family and 1 job');
    component.confirm();
    expect(confirmed).toHaveBeenCalledWith({ confirmed: true, cascade: true });
    fixture.componentRef.setInput('linkedJobs', []);
    fixture.detectChanges();
    expect((component as unknown as { headerTitle: () => string }).headerTitle()).toBe('Delete family');
  });

  it('handles loading, dismiss, backdrop and escape paths', () => {
    const fixture = TestBed.createComponent(CadmaPyDeleteModalComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    expect((component as unknown as { headerTitle: () => string }).headerTitle()).toBe('Checking linked data...');
    const dismissed = vi.fn();
    component.dismissed.subscribe(dismissed);
    const close = vi.fn();
    (component as unknown as { dialogRef: { nativeElement: HTMLDialogElement } }).dialogRef = { nativeElement: { close, open: true } as unknown as HTMLDialogElement };
    component.dismiss();
    component.onBackdropClick({ target: (component as unknown as { dialogRef: { nativeElement: HTMLDialogElement } }).dialogRef.nativeElement } as unknown as MouseEvent);
    component.onEscape();
    expect(close).toHaveBeenCalled();
    expect(dismissed).toHaveBeenCalled();
  });
});
