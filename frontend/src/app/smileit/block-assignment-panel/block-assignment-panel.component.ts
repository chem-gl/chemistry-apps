// block-assignment-panel.component.ts: Panel de asignación de bloques y mapeo por sitios del scaffold.

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SafeHtml } from '@angular/platform-browser';
import {
  SmileitCatalogEntryView,
  SmileitStructureInspectionView,
} from '../../core/api/jobs-api.service';
import {
  SmileitAssignmentBlockDraft,
  SmileitBlockCollapsedSummary,
  SmileitWorkflowService,
} from '../../core/application/smileit-workflow.service';

export type BlockPanelLibraryDetailRequest = {
  catalogEntry: SmileitCatalogEntryView;
  openContext: 'browser' | 'reference';
};

@Component({
  selector: 'app-block-assignment-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './block-assignment-panel.component.html',
  styleUrl: './block-assignment-panel.component.scss',
})
export class BlockAssignmentPanelComponent {
  readonly workflow = inject(SmileitWorkflowService);

  readonly libraryEntryInspections =
    input.required<Record<string, SmileitStructureInspectionView | null>>();
  readonly libraryEntryInspectionErrors = input.required<Record<string, string | null>>();
  readonly catalogEntryPreviewSvgResolver =
    input.required<(catalogEntry: SmileitCatalogEntryView) => SafeHtml | null>();
  readonly catalogEntryPreviewErrorResolver =
    input.required<(catalogEntry: SmileitCatalogEntryView) => string | null>();

  readonly libraryEntryDetailRequested = output<BlockPanelLibraryDetailRequest>();

  readonly isLibraryPanelCollapsed = signal<boolean>(false);
  readonly collapsedBlockMap = signal<Record<string, boolean>>({});
  readonly selectedBlockLibraryGroupKeys = signal<Record<string, string>>({});

  readonly selectedSitesLabel = computed<string>(
    () => this.workflow.selectedAtomIndices().join(', ') || 'None yet',
  );

  addAssignmentBlock(): void {
    this.workflow.blocks.addAssignmentBlock();
  }

  toggleLibraryPanelCollapse(): void {
    this.isLibraryPanelCollapsed.update((currentValue: boolean) => !currentValue);
  }

  toggleBlockCollapse(blockId: string): void {
    this.collapsedBlockMap.update((currentState: Record<string, boolean>) => ({
      ...currentState,
      [blockId]: !(currentState[blockId] ?? false),
    }));
  }

  collapseAllBlocks(): void {
    const nextState: Record<string, boolean> = {};
    this.workflow.assignmentBlocks().forEach((block: SmileitAssignmentBlockDraft) => {
      nextState[block.id] = true;
    });
    this.collapsedBlockMap.set(nextState);
  }

  expandAllBlocks(): void {
    const nextState: Record<string, boolean> = {};
    this.workflow.assignmentBlocks().forEach((block: SmileitAssignmentBlockDraft) => {
      nextState[block.id] = false;
    });
    this.collapsedBlockMap.set(nextState);
  }

  isBlockCollapsed(blockId: string): boolean {
    return this.collapsedBlockMap()[blockId] ?? false;
  }

  onBlockLibraryGroupChange(blockId: string, nextGroupKey: string): void {
    this.selectedBlockLibraryGroupKeys.update((currentState: Record<string, string>) => ({
      ...currentState,
      [blockId]: nextGroupKey,
    }));
  }

  selectedBlockLibraryGroupKey(blockId: string): string {
    return this.selectedBlockLibraryGroupKeys()[blockId] ?? 'all';
  }

  filteredCatalogGroupsForBlock(block: SmileitAssignmentBlockDraft) {
    const selectedGroupKey: string = this.selectedBlockLibraryGroupKey(block.id);
    const availableGroups = this.workflow.catalogGroups();
    if (selectedGroupKey === 'all') {
      return availableGroups;
    }

    const matchingGroups = availableGroups.filter((group) => group.key === selectedGroupKey);
    return matchingGroups.length > 0 ? matchingGroups : availableGroups;
  }

  filteredCatalogEntriesForBlock(block: SmileitAssignmentBlockDraft): SmileitCatalogEntryView[] {
    return this.filteredCatalogGroupsForBlock(block).flatMap((group) => group.entries);
  }

  onBlockCatalogEntryCardActivate(
    block: SmileitAssignmentBlockDraft,
    catalogEntry: SmileitCatalogEntryView,
  ): void {
    if (this.workflow.catalog.isCatalogEntryReferenced(block, catalogEntry)) {
      return;
    }
    this.onBlockCatalogBrowserEntryActivate(block, catalogEntry);
  }

  onBlockCatalogBrowserEntryActivate(
    block: SmileitAssignmentBlockDraft,
    catalogEntry: SmileitCatalogEntryView,
  ): void {
    if (this.workflow.isProcessing()) {
      return;
    }

    this.workflow.blocks.addCatalogReferenceToBlock(block.id, catalogEntry);
    this.workflow.blocks.applyCatalogEntryToManualDraft(block.id, catalogEntry);
  }

  selectCatalogEntryForManualDraft(blockId: string, catalogEntry: SmileitCatalogEntryView): void {
    this.workflow.blocks.applyCatalogEntryToManualDraft(blockId, catalogEntry);
  }

  isCatalogEntryLoadedInManualDraft(
    block: SmileitAssignmentBlockDraft,
    catalogEntry: SmileitCatalogEntryView,
  ): boolean {
    return (
      block.draftManualSmiles.trim() === catalogEntry.smiles.trim() &&
      block.draftManualName.trim() === catalogEntry.name.trim()
    );
  }

  isBlockSiteSelected(block: SmileitAssignmentBlockDraft, atomIndex: number): boolean {
    return block.siteAtomIndices.includes(atomIndex);
  }

  blockSummary(block: SmileitAssignmentBlockDraft): SmileitBlockCollapsedSummary {
    return this.workflow.blocks.getBlockCollapsedSummary(block);
  }

  openLibraryEntryDetail(
    catalogEntry: SmileitCatalogEntryView,
    openContext: 'browser' | 'reference' = 'browser',
  ): void {
    this.libraryEntryDetailRequested.emit({ catalogEntry, openContext });
  }

  catalogEntryPreviewSvg(catalogEntry: SmileitCatalogEntryView): SafeHtml | null {
    return this.catalogEntryPreviewSvgResolver()(catalogEntry);
  }

  catalogEntryPreviewError(catalogEntry: SmileitCatalogEntryView): string | null {
    return this.catalogEntryPreviewErrorResolver()(catalogEntry);
  }
}
