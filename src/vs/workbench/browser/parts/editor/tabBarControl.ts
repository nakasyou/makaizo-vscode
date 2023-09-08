/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/TabBarControl';
import { isMacintosh, isWindows } from 'vs/base/common/platform';
import { shorten } from 'vs/base/common/labels';
import { EditorResourceAccessor, Verbosity, SideBySideEditor, EditorInputCapabilities, preventEditorClose, EditorCloseMethod, IUntypedEditorInput, GroupIdentifier, DEFAULT_EDITOR_ASSOCIATION } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { computeEditorAriaLabel } from 'vs/workbench/browser/editor';
import { EventType as TouchEventType, GestureEvent, Gesture } from 'vs/base/browser/touch';
import { ResourceLabels, IResourceLabel, DEFAULT_LABELS_CONTAINER } from 'vs/workbench/browser/labels';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { EditorCommandsContextActionRunner, ITitleControlDimensions } from 'vs/workbench/browser/parts/editor/titleControl';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IDisposable, dispose, DisposableStore, combinedDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { getOrSet } from 'vs/base/common/map';
import { IThemeService, Themable } from 'vs/platform/theme/common/themeService';
import { TAB_INACTIVE_BACKGROUND, TAB_ACTIVE_BACKGROUND, TAB_ACTIVE_FOREGROUND, TAB_INACTIVE_FOREGROUND, TAB_BORDER, TAB_UNFOCUSED_ACTIVE_FOREGROUND, TAB_UNFOCUSED_INACTIVE_FOREGROUND, TAB_UNFOCUSED_ACTIVE_BACKGROUND, TAB_UNFOCUSED_ACTIVE_BORDER, TAB_ACTIVE_BORDER, TAB_ACTIVE_BORDER_TOP, TAB_UNFOCUSED_ACTIVE_BORDER_TOP, TAB_ACTIVE_MODIFIED_BORDER, TAB_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_BACKGROUND, EDITOR_GROUP_HEADER_TABS_BORDER, TAB_LAST_PINNED_BORDER, EDITOR_DRAG_AND_DROP_BACKGROUND } from 'vs/workbench/common/theme';
import { activeContrastBorder, contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { DraggedEditorIdentifier, DraggedEditorGroupIdentifier, extractTreeDropData, ResourcesDropHandler } from 'vs/workbench/browser/dnd';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { GroupsArrangement, IEditorGroupsService, IMergeGroupOptions, MergeGroupMode } from 'vs/workbench/services/editor/common/editorGroupsService';
import { addDisposableListener, EventType, findParentWithClass, clearNode, EventHelper, scheduleAtNextAnimationFrame, DragAndDropObserver } from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { IEditorGroupsAccessor, IEditorGroupView, EditorServiceImpl } from 'vs/workbench/browser/parts/editor/editor';
import { CloseOneEditorAction, UnpinEditorAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { assertAllDefined, assertIsDefined } from 'vs/base/common/types';
import { basenameOrAuthority } from 'vs/base/common/resources';
import { IPath, win32, posix } from 'vs/base/common/path';
import { coalesce, insert } from 'vs/base/common/arrays';
import { isHighContrast } from 'vs/platform/theme/common/theme';
import { DraggedTreeItemsIdentifier } from 'vs/editor/common/services/treeViewsDnd';
import { IEditorResolverService } from 'vs/workbench/services/editor/common/editorResolverService';
import { ResolvedKeybinding } from 'vs/base/common/keybindings';
import { IAction } from 'vs/base/common/actions';
import { LocalSelectionTransfer } from 'vs/platform/dnd/browser/dnd';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { EditorActivation } from 'vs/platform/editor/common/editor';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ITreeViewsDnDService } from 'vs/editor/common/services/treeViewsDndService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';

interface IEditorInputLabel {
	editor: EditorInput;

	name?: string;
	description?: string;
	forceDescription?: boolean;
	title?: string;
	ariaLabel?: string;
}

export function equalsEditorInputLabel(labelA: IEditorInputLabel | undefined, labelB: IEditorInputLabel | undefined): boolean {
	if (labelA === labelB) {
		return true;
	}

	if (!labelA || !labelB) {
		return false;
	}

	return labelA.name === labelB.name &&
		labelA.description === labelB.description &&
		labelA.forceDescription === labelB.forceDescription &&
		labelA.title === labelB.title &&
		labelA.ariaLabel === labelB.ariaLabel;
}


export interface ITabsTitleControlLayoutOptions {

	/**
	 * Whether to force revealing the active tab, even when
	 * the dimensions have not changed. This can be the case
	 * when a tab was made active and needs to be revealed.
	 */
	forceRevealActiveTab?: true;
}

export class TabBarControl extends Themable {

	protected readonly editorTransfer = LocalSelectionTransfer.getInstance<DraggedEditorIdentifier>();
	protected readonly groupTransfer = LocalSelectionTransfer.getInstance<DraggedEditorGroupIdentifier>();
	protected readonly treeItemsTransfer = LocalSelectionTransfer.getInstance<DraggedTreeItemsIdentifier>();

	private static readonly DRAG_OVER_OPEN_TAB_THRESHOLD = 1500;

	private static readonly MOUSE_WHEEL_EVENT_THRESHOLD = 150;
	private static readonly MOUSE_WHEEL_DISTANCE_THRESHOLD = 1.5;

	private static readonly SCROLLBAR_SIZES = {
		default: 3,
		large: 10
	};

	private static readonly TAB_WIDTH = {
		compact: 38,
		shrink: 80,
		fit: 120
	};

	public tabsAndActionsContainer: HTMLElement;
	public tabsContainer: HTMLElement;
	public tabsScrollbar: ScrollableElement;
	private tabSizingFixedDisposables: DisposableStore;

	public readonly closeEditorAction = this._register(this.instantiationService.createInstance(CloseOneEditorAction, CloseOneEditorAction.ID, CloseOneEditorAction.LABEL));
	private readonly unpinEditorAction = this._register(this.instantiationService.createInstance(UnpinEditorAction, UnpinEditorAction.ID, UnpinEditorAction.LABEL));

	public readonly tabResourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
	public tabLabels: IEditorInputLabel[] = [];
	public activeTabLabel: IEditorInputLabel | undefined;

	private tabActionBars: ActionBar[] = [];
	private tabDisposables: IDisposable[] = [];

	private path: IPath = isWindows ? win32 : posix;

	public lastMouseWheelEventTime = 0;
	public isMouseOverTabs = false;

	private blockRevealActiveTab: boolean | undefined;

	constructor(
		private accessor: IEditorGroupsAccessor,
		private group: IEditorGroupView,
		private editorToolbarContainer: HTMLElement,
		private enableGroupDragging: (tabsContainer: HTMLElement) => void,
		private onContextMenu: (editor: EditorInput, e: Event, node: HTMLElement) => void,
		private doFillResourceDataTransfers: (editors: readonly EditorInput[], e: DragEvent) => boolean,
		private getTitleHeight: () => number,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IKeybindingService private keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IMenuService menuService: IMenuService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IFileService fileService: IFileService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IPathService private readonly pathService: IPathService,
		@IEditorService private readonly editorService: EditorServiceImpl,
		@ITreeViewsDnDService private readonly treeViewsDragAndDropService: ITreeViewsDnDService,
	) {
		super(themeService);

		// Resolve the correct path library for the OS we are on
		// If we are connected to remote, this accounts for the
		// remote OS.
		(async () => this.path = await this.pathService.path)();

		// Tabs and Actions Container (are on a single row with flex side-by-side)
		this.tabsAndActionsContainer = document.createElement('div');
		this.tabsAndActionsContainer.classList.add('tabs-and-actions-container');

		// Tabs Container
		this.tabsContainer = document.createElement('div');
		this.tabsContainer.setAttribute('role', 'tablist');
		this.tabsContainer.draggable = true;
		this.tabsContainer.classList.add('tabs-container');
		this._register(Gesture.addTarget(this.tabsContainer));

		this.tabSizingFixedDisposables = this._register(new DisposableStore());
		this.updateTabSizing(false);

		// Tabs Scrollbar
		this.tabsScrollbar = this.createTabsScrollbar(this.tabsContainer);
		this.tabsAndActionsContainer.appendChild(this.tabsScrollbar.getDomNode());

		// Tabs Container listeners
		this.registerTabsContainerListeners(this.tabsContainer, this.tabsScrollbar);

		this.tabsAndActionsContainer.appendChild(this.editorToolbarContainer);
	}

	private createTabsScrollbar(scrollable: HTMLElement): ScrollableElement {
		const tabsScrollbar = this._register(new ScrollableElement(scrollable, {
			horizontal: ScrollbarVisibility.Auto,
			horizontalScrollbarSize: this.getTabsScrollbarSizing(),
			vertical: ScrollbarVisibility.Hidden,
			scrollYToX: true,
			useShadows: false
		}));

		this._register(tabsScrollbar.onScroll(e => {
			if (e.scrollLeftChanged) {
				scrollable.scrollLeft = e.scrollLeft;
			}
		}));

		return tabsScrollbar;
	}

	public updateTabsScrollbarSizing(): void {
		this.tabsScrollbar?.updateOptions({
			horizontalScrollbarSize: this.getTabsScrollbarSizing()
		});
	}

	public updateTabSizing(fromEvent: boolean): void {
		const [tabsContainer, tabSizingFixedDisposables] = assertAllDefined(this.tabsContainer, this.tabSizingFixedDisposables);

		tabSizingFixedDisposables.clear();

		const options = this.accessor.partOptions;
		if (options.tabSizing === 'fixed') {
			tabsContainer.style.setProperty('--tab-sizing-fixed-min-width', `${options.tabSizingFixedMinWidth}px`);
			tabsContainer.style.setProperty('--tab-sizing-fixed-max-width', `${options.tabSizingFixedMaxWidth}px`);

			// For https://github.com/microsoft/vscode/issues/40290 we want to
			// preserve the current tab widths as long as the mouse is over the
			// tabs so that you can quickly close them via mouse click. For that
			// we track mouse movements over the tabs container.

			tabSizingFixedDisposables.add(addDisposableListener(tabsContainer, EventType.MOUSE_ENTER, () => {
				this.isMouseOverTabs = true;
			}));
			tabSizingFixedDisposables.add(addDisposableListener(tabsContainer, EventType.MOUSE_LEAVE, () => {
				this.isMouseOverTabs = false;
				this.updateTabsFixedWidth(false);
			}));
		} else if (fromEvent) {
			tabsContainer.style.removeProperty('--tab-sizing-fixed-min-width');
			tabsContainer.style.removeProperty('--tab-sizing-fixed-max-width');
			this.updateTabsFixedWidth(false);
		}
	}

	public updateTabsFixedWidth(fixed: boolean): void {
		this.forEachTab((editor, index, tabContainer) => {
			if (fixed) {
				const { width } = tabContainer.getBoundingClientRect();
				tabContainer.style.setProperty('--tab-sizing-current-width', `${width}px`);
			} else {
				tabContainer.style.removeProperty('--tab-sizing-current-width');
			}
		});
	}

	private getTabsScrollbarSizing(): number {
		if (this.accessor.partOptions.titleScrollbarSizing !== 'large') {
			return TabBarControl.SCROLLBAR_SIZES.default;
		}

		return TabBarControl.SCROLLBAR_SIZES.large;
	}

	private registerTabsContainerListeners(tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): void {

		// Group dragging
		this.enableGroupDragging(tabsContainer);

		// Forward scrolling inside the container to our custom scrollbar
		this._register(addDisposableListener(tabsContainer, EventType.SCROLL, () => {
			if (tabsContainer.classList.contains('scroll')) {
				tabsScrollbar.setScrollPosition({
					scrollLeft: tabsContainer.scrollLeft // during DND the container gets scrolled so we need to update the custom scrollbar
				});
			}
		}));

		// New file when double-clicking on tabs container (but not tabs)
		for (const eventType of [TouchEventType.Tap, EventType.DBLCLICK]) {
			this._register(addDisposableListener(tabsContainer, eventType, (e: MouseEvent | GestureEvent) => {
				if (eventType === EventType.DBLCLICK) {
					if (e.target !== tabsContainer) {
						return; // ignore if target is not tabs container
					}
				} else {
					if ((<GestureEvent>e).tapCount !== 2) {
						return; // ignore single taps
					}

					if ((<GestureEvent>e).initialTarget !== tabsContainer) {
						return; // ignore if target is not tabs container
					}
				}

				EventHelper.stop(e);

				this.editorService.openEditor({
					resource: undefined,
					options: {
						pinned: true,
						index: this.group.count, // always at the end
						override: DEFAULT_EDITOR_ASSOCIATION.id
					}
				}, this.group.id);
			}));
		}

		// Prevent auto-scrolling (https://github.com/microsoft/vscode/issues/16690)
		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_DOWN, e => {
			if (e.button === 1) {
				e.preventDefault();
			}
		}));

		// Drop support
		this._register(new DragAndDropObserver(tabsContainer, {
			onDragEnter: e => {

				// Always enable support to scroll while dragging
				tabsContainer.classList.add('scroll');

				// Return if the target is not on the tabs container
				if (e.target !== tabsContainer) {
					this.updateDropFeedback(tabsContainer, false); // fixes https://github.com/microsoft/vscode/issues/52093
					return;
				}

				// Return if transfer is unsupported
				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				// Return if dragged editor is last tab because then this is a no-op
				let isLocalDragAndDrop = false;
				if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					isLocalDragAndDrop = true;

					const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
					if (Array.isArray(data)) {
						const localDraggedEditor = data[0].identifier;
						if (this.group.id === localDraggedEditor.groupId && this.group.getIndexOfEditor(localDraggedEditor.editor) === this.group.count - 1) {
							if (e.dataTransfer) {
								e.dataTransfer.dropEffect = 'none';
							}

							return;
						}
					}
				}

				// Update the dropEffect to "copy" if there is no local data to be dragged because
				// in that case we can only copy the data into and not move it from its source
				if (!isLocalDragAndDrop) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tabsContainer, true);
			},

			onDragLeave: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');
			},

			onDragEnd: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');
			},

			onDrop: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');

				if (e.target === tabsContainer) {
					this.onDrop(e, this.group.count, tabsContainer);
				}
			}
		}));

		// Mouse-wheel support to switch to tabs optionally
		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_WHEEL, (e: WheelEvent) => {
			const activeEditor = this.group.activeEditor;
			if (!activeEditor || this.group.count < 2) {
				return;  // need at least 2 open editors
			}

			// Shift-key enables or disables this behaviour depending on the setting
			if (this.accessor.partOptions.scrollToSwitchTabs === true) {
				if (e.shiftKey) {
					return; // 'on': only enable this when Shift-key is not pressed
				}
			} else {
				if (!e.shiftKey) {
					return; // 'off': only enable this when Shift-key is pressed
				}
			}

			// Ignore event if the last one happened too recently (https://github.com/microsoft/vscode/issues/96409)
			// The restriction is relaxed according to the absolute value of `deltaX` and `deltaY`
			// to support discrete (mouse wheel) and contiguous scrolling (touchpad) equally well
			const now = Date.now();
			if (now - this.lastMouseWheelEventTime < TabBarControl.MOUSE_WHEEL_EVENT_THRESHOLD - 2 * (Math.abs(e.deltaX) + Math.abs(e.deltaY))) {
				return;
			}

			this.lastMouseWheelEventTime = now;

			// Figure out scrolling direction but ignore it if too subtle
			let tabSwitchDirection: number;
			if (e.deltaX + e.deltaY < - TabBarControl.MOUSE_WHEEL_DISTANCE_THRESHOLD) {
				tabSwitchDirection = -1;
			} else if (e.deltaX + e.deltaY > TabBarControl.MOUSE_WHEEL_DISTANCE_THRESHOLD) {
				tabSwitchDirection = 1;
			} else {
				return;
			}

			const nextEditor = this.group.getEditorByIndex(this.group.getIndexOfEditor(activeEditor) + tabSwitchDirection);
			if (!nextEditor) {
				return;
			}

			// Open it
			this.group.openEditor(nextEditor);

			// Disable normal scrolling, opening the editor will already reveal it properly
			EventHelper.stop(e, true);
		}));

		// Context menu
		const showContextMenu = (e: Event) => {
			EventHelper.stop(e);

			// Find target anchor
			let anchor: HTMLElement | StandardMouseEvent = tabsContainer;
			if (e instanceof MouseEvent) {
				anchor = new StandardMouseEvent(e);
			}

			// Show it
			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				menuId: MenuId.EditorTabsBarContext,
				contextKeyService: this.contextKeyService,
				menuActionOptions: { shouldForwardArgs: true },
				getActionsContext: () => ({ groupId: this.group.id }),
				getKeyBinding: action => this.getKeybinding(action),
				onHide: () => this.group.focus()
			});
		};

		this._register(addDisposableListener(tabsContainer, TouchEventType.Contextmenu, e => showContextMenu(e)));
		this._register(addDisposableListener(tabsContainer, EventType.CONTEXT_MENU, e => showContextMenu(e)));
	}

	public removeClosedTabs() {
		const tabsContainer = assertIsDefined(this.tabsContainer);
		const tabsToClose = tabsContainer.children.length - this.group.count;
		for (let i = 0; i < tabsToClose; i++) {

			// Remove one tab from container (must be the last to keep indexes in order!)
			tabsContainer.lastChild?.remove();

			// Remove associated tab label and widget
			dispose(this.tabDisposables.pop());
		}
	}

	public removeAllTabs(): void {
		if (this.tabsContainer) {
			clearNode(this.tabsContainer);
		}

		this.tabDisposables = dispose(this.tabDisposables);
		this.tabResourceLabels.clear();
		this.tabLabels = [];
		this.activeTabLabel = undefined;
		this.tabActionBars = [];
	}

	public didActiveEditorChange(): boolean {
		if (
			!this.activeTabLabel?.editor && this.group.activeEditor || 							// active editor changed from null => editor
			this.activeTabLabel?.editor && !this.group.activeEditor || 							// active editor changed from editor => null
			(!this.activeTabLabel?.editor || !this.group.isActive(this.activeTabLabel.editor))	// active editor changed from editorA => editorB
		) {
			return true;
		}

		return false;
	}

	public beforeCloseEditor(editor: EditorInput): void {
		// Fix tabs width if the mouse is over tabs and before closing
		// a tab (except the last tab) when tab sizing is 'fixed'.
		// This helps keeping the close button stable under
		// the mouse and allows for rapid closing of tabs.
		if (this.isMouseOverTabs && this.accessor.partOptions.tabSizing === 'fixed') {
			const closingLastTab = this.group.isLast(editor);
			this.updateTabsFixedWidth(!closingLastTab);
		}
	}

	moveEditor(editor: EditorInput, fromIndex: number, targetIndex: number): void {
		// Move the editor label
		const editorLabel = this.tabLabels[fromIndex];
		this.tabLabels.splice(fromIndex, 1);
		this.tabLabels.splice(targetIndex, 0, editorLabel);

		// Redraw tabs in the range of the move
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.doRedrawTab(editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar);
		},
			Math.min(fromIndex, targetIndex), 	// from: smallest of fromIndex/targetIndex
			Math.max(fromIndex, targetIndex)	//   to: largest of fromIndex/targetIndex
		);
	}

	redrawTabLabel(editor: EditorInput): void {
		this.withTab(editor, (editor, index, tabContainer, tabLabelWidget, tabLabel) => this.doredrawTabLabel(editor, index, tabContainer, tabLabelWidget, tabLabel));
	}

	redrawTab(editor: EditorInput): void {
		this.withTab(
			editor,
			(editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => this.doRedrawTab(editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar)
		);

	}

	redrawAllTabs(): void {
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel) => {
			this.doredrawTabLabel(editor, index, tabContainer, tabLabelWidget, tabLabel);
		});
	}

	redrawAllTabBorders(): void {
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawTabBorders(index, tabContainer);
		});
	}

	setActive(isGroupActive: boolean): void {
		// Activity has an impact on each tab's active indication
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTabActiveAndDirty(isGroupActive, editor, tabContainer, tabActionBar);
		});
	}

	updateEditorDirty(editor: EditorInput): void {
		this.withTab(editor, (editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => this.redrawTabActiveAndDirty(this.accessor.activeGroup === this.group, editor, tabContainer, tabActionBar));
	}

	private forEachTab(fn: (editor: EditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void, fromIndex?: number, toIndex?: number): void {
		this.group.editors.forEach((editor, index) => {
			if (typeof fromIndex === 'number' && fromIndex > index) {
				return; // do nothing if we are not yet at `fromIndex`
			}

			if (typeof toIndex === 'number' && toIndex < index) {
				return; // do nothing if we are beyond `toIndex`
			}

			this.doWithTab(index, editor, fn);
		});
	}

	private withTab(editor: EditorInput, fn: (editor: EditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		this.doWithTab(this.group.getIndexOfEditor(editor), editor, fn);
	}

	private doWithTab(index: number, editor: EditorInput, fn: (editor: EditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		const tabsContainer = assertIsDefined(this.tabsContainer);
		const tabContainer = tabsContainer.children[index] as HTMLElement;
		const tabResourceLabel = this.tabResourceLabels.get(index);
		const tabLabel = this.tabLabels[index];
		const tabActionBar = this.tabActionBars[index];
		if (tabContainer && tabResourceLabel && tabLabel) {
			fn(editor, index, tabContainer, tabResourceLabel, tabLabel, tabActionBar);
		}
	}

	public createTab(index: number): void {
		const tabContainer = document.createElement('div');
		tabContainer.draggable = true;
		tabContainer.setAttribute('role', 'tab');
		tabContainer.classList.add('tab');

		this.tabsContainer.appendChild(tabContainer);

		// Gesture Support
		this._register(Gesture.addTarget(tabContainer));

		// Tab Border Top
		const tabBorderTopContainer = document.createElement('div');
		tabBorderTopContainer.classList.add('tab-border-top-container');
		tabContainer.appendChild(tabBorderTopContainer);

		// Tab Editor Label
		const editorLabel = this.tabResourceLabels.create(tabContainer);

		// Tab Actions
		const tabActionsContainer = document.createElement('div');
		tabActionsContainer.classList.add('tab-actions');
		tabContainer.appendChild(tabActionsContainer);

		const tabActionRunner = new EditorCommandsContextActionRunner({ groupId: this.group.id, editorIndex: index });

		const tabActionBar = new ActionBar(tabActionsContainer, { ariaLabel: localize('ariaLabelTabActions', "Tab actions"), actionRunner: tabActionRunner });
		tabActionBar.onWillRun(e => {
			if (e.action.id === this.closeEditorAction.id) {
				this.blockRevealActiveTabOnce();
			}
		});

		const tabActionBarDisposable = combinedDisposable(tabActionBar, toDisposable(insert(this.tabActionBars, tabActionBar)));

		// Tab Border Bottom
		const tabBorderBottomContainer = document.createElement('div');
		tabBorderBottomContainer.classList.add('tab-border-bottom-container');
		tabContainer.appendChild(tabBorderBottomContainer);

		const tabEventsDisposable = this.registerTabListeners(tabContainer, index, this.tabsContainer, this.tabsScrollbar);

		this.tabDisposables.push(combinedDisposable(tabEventsDisposable, tabActionBarDisposable, tabActionRunner, editorLabel));
	}

	private registerTabListeners(tab: HTMLElement, index: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): IDisposable {
		const disposables = new DisposableStore();

		const handleClickOrTouch = (e: MouseEvent | GestureEvent, preserveFocus: boolean): void => {
			tab.blur(); // prevent flicker of focus outline on tab until editor got focus

			if (e instanceof MouseEvent && (e.button !== 0 /* middle/right mouse button */ || (isMacintosh && e.ctrlKey /* macOS context menu */))) {
				if (e.button === 1) {
					e.preventDefault(); // required to prevent auto-scrolling (https://github.com/microsoft/vscode/issues/16690)
				}

				return undefined;
			}

			if (this.originatesFromTabActionBar(e)) {
				return; // not when clicking on actions
			}

			// Open tabs editor
			const editor = this.group.getEditorByIndex(index);
			if (editor) {
				// Even if focus is preserved make sure to activate the group.
				this.group.openEditor(editor, { preserveFocus, activation: EditorActivation.ACTIVATE });
			}

			return undefined;
		};

		const showContextMenu = (e: Event) => {
			EventHelper.stop(e);

			const editor = this.group.getEditorByIndex(index);
			if (editor) {
				this.onContextMenu(editor, e, tab);
			}
		};

		// Open on Click / Touch
		disposables.add(addDisposableListener(tab, EventType.MOUSE_DOWN, e => handleClickOrTouch(e, false)));
		disposables.add(addDisposableListener(tab, TouchEventType.Tap, (e: GestureEvent) => handleClickOrTouch(e, true))); // Preserve focus on touch #125470

		// Touch Scroll Support
		disposables.add(addDisposableListener(tab, TouchEventType.Change, (e: GestureEvent) => {
			tabsScrollbar.setScrollPosition({ scrollLeft: tabsScrollbar.getScrollPosition().scrollLeft - e.translationX });
		}));

		// Prevent flicker of focus outline on tab until editor got focus
		disposables.add(addDisposableListener(tab, EventType.MOUSE_UP, e => {
			EventHelper.stop(e);

			tab.blur();
		}));

		// Close on mouse middle click
		disposables.add(addDisposableListener(tab, EventType.AUXCLICK, e => {
			if (e.button === 1 /* Middle Button*/) {
				EventHelper.stop(e, true /* for https://github.com/microsoft/vscode/issues/56715 */);

				const editor = this.group.getEditorByIndex(index);
				if (editor && preventEditorClose(this.group, editor, EditorCloseMethod.MOUSE, this.accessor.partOptions)) {
					return;
				}
				this.blockRevealActiveTabOnce();
				this.closeEditorAction.run({ groupId: this.group.id, editorIndex: index });
			}
		}));

		// Context menu on Shift+F10
		disposables.add(addDisposableListener(tab, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.shiftKey && event.keyCode === KeyCode.F10) {
				showContextMenu(e);
			}
		}));

		// Context menu on touch context menu gesture
		disposables.add(addDisposableListener(tab, TouchEventType.Contextmenu, (e: GestureEvent) => {
			showContextMenu(e);
		}));

		// Keyboard accessibility
		disposables.add(addDisposableListener(tab, EventType.KEY_UP, e => {
			const event = new StandardKeyboardEvent(e);
			let handled = false;

			// Run action on Enter/Space
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				handled = true;
				const editor = this.group.getEditorByIndex(index);
				if (editor) {
					this.group.openEditor(editor);
				}
			}

			// Navigate in editors
			else if ([KeyCode.LeftArrow, KeyCode.RightArrow, KeyCode.UpArrow, KeyCode.DownArrow, KeyCode.Home, KeyCode.End].some(kb => event.equals(kb))) {
				let targetIndex: number;
				if (event.equals(KeyCode.LeftArrow) || event.equals(KeyCode.UpArrow)) {
					targetIndex = index - 1;
				} else if (event.equals(KeyCode.RightArrow) || event.equals(KeyCode.DownArrow)) {
					targetIndex = index + 1;
				} else if (event.equals(KeyCode.Home)) {
					targetIndex = 0;
				} else {
					targetIndex = this.group.count - 1;
				}

				const target = this.group.getEditorByIndex(targetIndex);
				if (target) {
					handled = true;
					this.group.openEditor(target, { preserveFocus: true });
					(<HTMLElement>tabsContainer.childNodes[targetIndex]).focus();
				}
			}

			if (handled) {
				EventHelper.stop(e, true);
			}

			// moving in the tabs container can have an impact on scrolling position, so we need to update the custom scrollbar
			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainer.scrollLeft
			});
		}));

		// Double click: either pin or toggle maximized
		for (const eventType of [TouchEventType.Tap, EventType.DBLCLICK]) {
			disposables.add(addDisposableListener(tab, eventType, (e: MouseEvent | GestureEvent) => {
				if (eventType === EventType.DBLCLICK) {
					EventHelper.stop(e);
				} else if ((<GestureEvent>e).tapCount !== 2) {
					return; // ignore single taps
				}

				const editor = this.group.getEditorByIndex(index);
				if (editor && this.group.isPinned(editor)) {
					if (this.accessor.partOptions.doubleClickTabToToggleEditorGroupSizes) {
						this.accessor.arrangeGroups(GroupsArrangement.TOGGLE, this.group);
					}
				} else {
					this.group.pinEditor(editor);
				}
			}));
		}

		// Context menu
		disposables.add(addDisposableListener(tab, EventType.CONTEXT_MENU, e => {
			EventHelper.stop(e, true);

			const editor = this.group.getEditorByIndex(index);
			if (editor) {
				this.onContextMenu(editor, e, tab);
			}
		}, true /* use capture to fix https://github.com/microsoft/vscode/issues/19145 */));

		// Drag support
		disposables.add(addDisposableListener(tab, EventType.DRAG_START, e => {
			const editor = this.group.getEditorByIndex(index);
			if (!editor) {
				return;
			}

			this.editorTransfer.setData([new DraggedEditorIdentifier({ editor, groupId: this.group.id })], DraggedEditorIdentifier.prototype);

			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'copyMove';
			}

			// Apply some datatransfer types to allow for dragging the element outside of the application
			this.doFillResourceDataTransfers([editor], e);

			// Fixes https://github.com/microsoft/vscode/issues/18733
			tab.classList.add('dragged');
			scheduleAtNextAnimationFrame(() => tab.classList.remove('dragged'));
		}));

		// Drop support
		disposables.add(new DragAndDropObserver(tab, {
			onDragEnter: e => {

				// Update class to signal drag operation
				tab.classList.add('dragged-over');

				// Return if transfer is unsupported
				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				// Return if dragged editor is the current tab dragged over
				let isLocalDragAndDrop = false;
				if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					isLocalDragAndDrop = true;

					const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
					if (Array.isArray(data)) {
						const localDraggedEditor = data[0].identifier;
						if (localDraggedEditor.editor === this.group.getEditorByIndex(index) && localDraggedEditor.groupId === this.group.id) {
							if (e.dataTransfer) {
								e.dataTransfer.dropEffect = 'none';
							}

							return;
						}
					}
				}

				// Update the dropEffect to "copy" if there is no local data to be dragged because
				// in that case we can only copy the data into and not move it from its source
				if (!isLocalDragAndDrop) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tab, true, index);
			},

			onDragOver: (_, dragDuration) => {
				if (dragDuration >= TabBarControl.DRAG_OVER_OPEN_TAB_THRESHOLD) {
					const draggedOverTab = this.group.getEditorByIndex(index);
					if (draggedOverTab && this.group.activeEditor !== draggedOverTab) {
						this.group.openEditor(draggedOverTab, { preserveFocus: true });
					}
				}
			},

			onDragLeave: () => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, index);
			},

			onDragEnd: () => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, index);

				this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
			},

			onDrop: e => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, index);

				this.onDrop(e, index, tabsContainer);
			}
		}));

		return disposables;
	}

	private updateDropFeedback(element: HTMLElement, isDND: boolean, index?: number): void {
		const isTab = (typeof index === 'number');
		const editor = typeof index === 'number' ? this.group.getEditorByIndex(index) : undefined;
		const isActiveTab = isTab && !!editor && this.group.isActive(editor);

		// Background
		const noDNDBackgroundColor = isTab ? this.getColor(isActiveTab ? TAB_ACTIVE_BACKGROUND : TAB_INACTIVE_BACKGROUND) : '';
		element.style.backgroundColor = (isDND ? this.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND) : noDNDBackgroundColor) || '';

		// Outline
		const activeContrastBorderColor = this.getColor(activeContrastBorder);
		if (activeContrastBorderColor && isDND) {
			element.style.outlineWidth = '2px';
			element.style.outlineStyle = 'dashed';
			element.style.outlineColor = activeContrastBorderColor;
			element.style.outlineOffset = isTab ? '-5px' : '-3px';
		} else {
			element.style.outlineWidth = '';
			element.style.outlineStyle = '';
			element.style.outlineColor = activeContrastBorderColor || '';
			element.style.outlineOffset = '';
		}
	}

	private originatesFromTabActionBar(e: MouseEvent | GestureEvent): boolean {
		let element: HTMLElement;
		if (e instanceof MouseEvent) {
			element = (e.target || e.srcElement) as HTMLElement;
		} else {
			element = (e as GestureEvent).initialTarget as HTMLElement;
		}

		return !!findParentWithClass(element, 'action-item', 'tab');
	}

	private isSupportedDropTransfer(e: DragEvent): boolean {
		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (Array.isArray(data)) {
				const group = data[0];
				if (group.identifier === this.group.id) {
					return false; // groups cannot be dropped on title area it originates from
				}
			}

			return true;
		}

		if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			return true; // (local) editors can always be dropped
		}

		if (e.dataTransfer && e.dataTransfer.types.length > 0) {
			return true; // optimistically allow external data (// see https://github.com/microsoft/vscode/issues/25789)
		}

		return false;
	}

	private async onDrop(e: DragEvent, targetIndex: number, tabsContainer: HTMLElement): Promise<void> {
		EventHelper.stop(e, true);

		this.updateDropFeedback(tabsContainer, false);
		tabsContainer.classList.remove('scroll');

		// Check for group transfer
		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (Array.isArray(data)) {
				const sourceGroup = this.accessor.getGroup(data[0].identifier);
				if (sourceGroup) {
					const mergeGroupOptions: IMergeGroupOptions = { index: targetIndex };
					if (!this.isMoveOperation(e, sourceGroup.id)) {
						mergeGroupOptions.mode = MergeGroupMode.COPY_EDITORS;
					}

					this.accessor.mergeGroup(sourceGroup, this.group, mergeGroupOptions);
				}

				this.group.focus();
				this.groupTransfer.clearData(DraggedEditorGroupIdentifier.prototype);
			}
		}

		// Check for editor transfer
		else if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
			if (Array.isArray(data)) {
				const draggedEditor = data[0].identifier;
				const sourceGroup = this.accessor.getGroup(draggedEditor.groupId);
				if (sourceGroup) {

					// Move editor to target position and index
					if (this.isMoveOperation(e, draggedEditor.groupId, draggedEditor.editor)) {
						sourceGroup.moveEditor(draggedEditor.editor, this.group, { index: targetIndex });
					}

					// Copy editor to target position and index
					else {
						sourceGroup.copyEditor(draggedEditor.editor, this.group, { index: targetIndex });
					}
				}

				this.group.focus();
				this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
			}
		}

		// Check for tree items
		else if (this.treeItemsTransfer.hasData(DraggedTreeItemsIdentifier.prototype)) {
			const data = this.treeItemsTransfer.getData(DraggedTreeItemsIdentifier.prototype);
			if (Array.isArray(data)) {
				const editors: IUntypedEditorInput[] = [];
				for (const id of data) {
					const dataTransferItem = await this.treeViewsDragAndDropService.removeDragOperationTransfer(id.identifier);
					if (dataTransferItem) {
						const treeDropData = await extractTreeDropData(dataTransferItem);
						editors.push(...treeDropData.map(editor => ({ ...editor, options: { ...editor.options, pinned: true, index: targetIndex } })));
					}
				}

				this.editorService.openEditors(editors, this.group, { validateTrust: true });
			}

			this.treeItemsTransfer.clearData(DraggedTreeItemsIdentifier.prototype);
		}

		// Check for URI transfer
		else {
			const dropHandler = this.instantiationService.createInstance(ResourcesDropHandler, { allowWorkspaceOpen: false });
			dropHandler.handleDrop(e, () => this.group, () => this.group.focus(), targetIndex);
		}
	}

	private isMoveOperation(e: DragEvent, sourceGroup: GroupIdentifier, sourceEditor?: EditorInput) {
		if (sourceEditor?.hasCapability(EditorInputCapabilities.Singleton)) {
			return true; // Singleton editors cannot be split
		}

		const isCopy = (e.ctrlKey && !isMacintosh) || (e.altKey && isMacintosh);

		return !isCopy || sourceGroup === this.group.id;
	}

	public computeTabLabels(): void {
		const { labelFormat } = this.accessor.partOptions;
		const { verbosity, shortenDuplicates } = this.getLabelConfigFlags(labelFormat);

		// Build labels and descriptions for each editor
		const labels: IEditorInputLabel[] = [];
		let activeEditorIndex = -1;
		for (let i = 0; i < this.group.editors.length; i++) {
			const editor = this.group.editors[i];
			labels.push({
				editor,
				name: editor.getName(),
				description: editor.getDescription(verbosity),
				forceDescription: editor.hasCapability(EditorInputCapabilities.ForceDescription),
				title: editor.getTitle(Verbosity.LONG),
				ariaLabel: computeEditorAriaLabel(editor, i, this.group, this.editorGroupService.count)
			});

			if (editor === this.group.activeEditor) {
				activeEditorIndex = i;
			}
		}

		// Shorten labels as needed
		if (shortenDuplicates) {
			this.shortenTabLabels(labels);
		}

		// Remember for fast lookup
		this.tabLabels = labels;
		this.activeTabLabel = labels[activeEditorIndex];
	}

	private shortenTabLabels(labels: IEditorInputLabel[]): void {

		// Gather duplicate titles, while filtering out invalid descriptions
		const mapNameToDuplicates = new Map<string, IEditorInputLabel[]>();
		for (const label of labels) {
			if (typeof label.description === 'string') {
				getOrSet(mapNameToDuplicates, label.name, []).push(label);
			} else {
				label.description = '';
			}
		}

		// Identify duplicate names and shorten descriptions
		for (const [, duplicateLabels] of mapNameToDuplicates) {

			// Remove description if the title isn't duplicated
			// and we have no indication to enforce description
			if (duplicateLabels.length === 1 && !duplicateLabels[0].forceDescription) {
				duplicateLabels[0].description = '';

				continue;
			}

			// Identify duplicate descriptions
			const mapDescriptionToDuplicates = new Map<string, IEditorInputLabel[]>();
			for (const duplicateLabel of duplicateLabels) {
				getOrSet(mapDescriptionToDuplicates, duplicateLabel.description, []).push(duplicateLabel);
			}

			// For editors with duplicate descriptions, check whether any long descriptions differ
			let useLongDescriptions = false;
			for (const [, duplicateLabels] of mapDescriptionToDuplicates) {
				if (!useLongDescriptions && duplicateLabels.length > 1) {
					const [first, ...rest] = duplicateLabels.map(({ editor }) => editor.getDescription(Verbosity.LONG));
					useLongDescriptions = rest.some(description => description !== first);
				}
			}

			// If so, replace all descriptions with long descriptions
			if (useLongDescriptions) {
				mapDescriptionToDuplicates.clear();
				for (const duplicateLabel of duplicateLabels) {
					duplicateLabel.description = duplicateLabel.editor.getDescription(Verbosity.LONG);
					getOrSet(mapDescriptionToDuplicates, duplicateLabel.description, []).push(duplicateLabel);
				}
			}

			// Obtain final set of descriptions
			const descriptions: string[] = [];
			for (const [description] of mapDescriptionToDuplicates) {
				descriptions.push(description);
			}

			// Remove description if all descriptions are identical unless forced
			if (descriptions.length === 1) {
				for (const label of mapDescriptionToDuplicates.get(descriptions[0]) || []) {
					if (!label.forceDescription) {
						label.description = '';
					}
				}

				continue;
			}

			// Shorten descriptions
			const shortenedDescriptions = shorten(descriptions, this.path.sep);
			descriptions.forEach((description, index) => {
				for (const label of mapDescriptionToDuplicates.get(description) || []) {
					label.description = shortenedDescriptions[index];
				}
			});
		}
	}

	private getLabelConfigFlags(value: string | undefined) {
		switch (value) {
			case 'short':
				return { verbosity: Verbosity.SHORT, shortenDuplicates: false };
			case 'medium':
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: false };
			case 'long':
				return { verbosity: Verbosity.LONG, shortenDuplicates: false };
			default:
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: true };
		}
	}

	public redraw(): void {
		// Border below tabs if any with explicit high contrast support
		if (this.tabsAndActionsContainer) {
			let tabsContainerBorderColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BORDER);
			if (!tabsContainerBorderColor && isHighContrast(this.theme.type)) {
				tabsContainerBorderColor = this.getColor(TAB_BORDER) || this.getColor(contrastBorder);
			}

			if (tabsContainerBorderColor) {
				this.tabsAndActionsContainer.classList.add('tabs-border-bottom');
				this.tabsAndActionsContainer.style.setProperty('--tabs-border-bottom-color', tabsContainerBorderColor.toString());
			} else {
				this.tabsAndActionsContainer.classList.remove('tabs-border-bottom');
				this.tabsAndActionsContainer.style.removeProperty('--tabs-border-bottom-color');
			}
		}

		// For each tab
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.doRedrawTab(editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar);
		});
	}

	private doRedrawTab(editor: EditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar): void {
		const isTabSticky = this.group.isSticky(index);
		const options = this.accessor.partOptions;

		// Label
		this.doredrawTabLabel(editor, index, tabContainer, tabLabelWidget, tabLabel);

		// Action
		const tabAction = isTabSticky ? this.unpinEditorAction : this.closeEditorAction;
		if (!tabActionBar.hasAction(tabAction)) {
			if (!tabActionBar.isEmpty()) {
				tabActionBar.clear();
			}

			tabActionBar.push(tabAction, { icon: true, label: false, keybinding: this.getKeybindingLabel(tabAction) });
		}

		// Settings
		const tabActionsVisibility = isTabSticky && options.pinnedTabSizing === 'compact' ? 'off' /* treat sticky compact tabs as tabCloseButton: 'off' */ : options.tabCloseButton;
		for (const option of ['off', 'left', 'right']) {
			tabContainer.classList.toggle(`tab-actions-${option}`, tabActionsVisibility === option);
		}

		const tabSizing = isTabSticky && options.pinnedTabSizing === 'shrink' ? 'shrink' /* treat sticky shrink tabs as tabSizing: 'shrink' */ : options.tabSizing;
		for (const option of ['fit', 'shrink', 'fixed']) {
			tabContainer.classList.toggle(`sizing-${option}`, tabSizing === option);
		}

		tabContainer.classList.toggle('has-icon', options.showIcons && options.hasIcons);

		tabContainer.classList.toggle('sticky', isTabSticky);
		for (const option of ['normal', 'compact', 'shrink']) {
			tabContainer.classList.toggle(`sticky-${option}`, isTabSticky && options.pinnedTabSizing === option);
		}

		// If not wrapping tabs, sticky compact/shrink tabs need a position to remain at their location
		// when scrolling to stay in view (requirement for position: sticky)
		if (!options.wrapTabs && isTabSticky && options.pinnedTabSizing !== 'normal') {
			let stickyTabWidth = 0;
			switch (options.pinnedTabSizing) {
				case 'compact':
					stickyTabWidth = TabBarControl.TAB_WIDTH.compact;
					break;
				case 'shrink':
					stickyTabWidth = TabBarControl.TAB_WIDTH.shrink;
					break;
			}

			tabContainer.style.left = `${index * stickyTabWidth}px`;
		} else {
			tabContainer.style.left = 'auto';
		}

		// Borders / outline
		this.redrawTabBorders(index, tabContainer);

		// Active / dirty state
		this.redrawTabActiveAndDirty(this.accessor.activeGroup === this.group, editor, tabContainer, tabActionBar);
	}

	private doredrawTabLabel(editor: EditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel): void {
		const options = this.accessor.partOptions;

		// Unless tabs are sticky compact, show the full label and description
		// Sticky compact tabs will only show an icon if icons are enabled
		// or their first character of the name otherwise
		let name: string | undefined;
		let forceLabel = false;
		let fileDecorationBadges = Boolean(options.decorations?.badges);
		let description: string;
		if (options.pinnedTabSizing === 'compact' && this.group.isSticky(index)) {
			const isShowingIcons = options.showIcons && options.hasIcons;
			name = isShowingIcons ? '' : tabLabel.name?.charAt(0).toUpperCase();
			description = '';
			forceLabel = true;
			fileDecorationBadges = false; // not enough space when sticky tabs are compact
		} else {
			name = tabLabel.name;
			description = tabLabel.description || '';
		}

		if (tabLabel.ariaLabel) {
			tabContainer.setAttribute('aria-label', tabLabel.ariaLabel);
			// Set aria-description to empty string so that screen readers would not read the title as well
			// More details https://github.com/microsoft/vscode/issues/95378
			tabContainer.setAttribute('aria-description', '');
		}

		const title = tabLabel.title || '';
		tabContainer.title = title;

		// Label
		tabLabelWidget.setResource(
			{ name, description, resource: EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH }) },
			{
				title,
				extraClasses: coalesce(['tab-label', fileDecorationBadges ? 'tab-label-has-badge' : undefined].concat(editor.getLabelExtraClasses())),
				italic: !this.group.isPinned(editor),
				forceLabel,
				fileDecorations: {
					colors: Boolean(options.decorations?.colors),
					badges: fileDecorationBadges
				}
			}
		);

		// Tests helper
		const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (resource) {
			tabContainer.setAttribute('data-resource-name', basenameOrAuthority(resource));
		} else {
			tabContainer.removeAttribute('data-resource-name');
		}
	}

	private redrawTabActiveAndDirty(isGroupActive: boolean, editor: EditorInput, tabContainer: HTMLElement, tabActionBar: ActionBar): void {
		const isTabActive = this.group.isActive(editor);
		const hasModifiedBorderTop = this.doRedrawTabDirty(isGroupActive, isTabActive, editor, tabContainer);

		this.doRedrawTabActive(isGroupActive, !hasModifiedBorderTop, editor, tabContainer, tabActionBar);
	}

	private doRedrawTabActive(isGroupActive: boolean, allowBorderTop: boolean, editor: EditorInput, tabContainer: HTMLElement, tabActionBar: ActionBar): void {

		// Tab is active
		if (this.group.isActive(editor)) {

			// Container
			tabContainer.classList.add('active');
			tabContainer.setAttribute('aria-selected', 'true');
			tabContainer.tabIndex = 0; // Only active tab can be focused into
			tabContainer.style.backgroundColor = this.getColor(isGroupActive ? TAB_ACTIVE_BACKGROUND : TAB_UNFOCUSED_ACTIVE_BACKGROUND) || '';

			const activeTabBorderColorBottom = this.getColor(isGroupActive ? TAB_ACTIVE_BORDER : TAB_UNFOCUSED_ACTIVE_BORDER);
			if (activeTabBorderColorBottom) {
				tabContainer.classList.add('tab-border-bottom');
				tabContainer.style.setProperty('--tab-border-bottom-color', activeTabBorderColorBottom.toString());
			} else {
				tabContainer.classList.remove('tab-border-bottom');
				tabContainer.style.removeProperty('--tab-border-bottom-color');
			}

			const activeTabBorderColorTop = allowBorderTop ? this.getColor(isGroupActive ? TAB_ACTIVE_BORDER_TOP : TAB_UNFOCUSED_ACTIVE_BORDER_TOP) : undefined;
			if (activeTabBorderColorTop) {
				tabContainer.classList.add('tab-border-top');
				tabContainer.style.setProperty('--tab-border-top-color', activeTabBorderColorTop.toString());
			} else {
				tabContainer.classList.remove('tab-border-top');
				tabContainer.style.removeProperty('--tab-border-top-color');
			}

			// Label
			tabContainer.style.color = this.getColor(isGroupActive ? TAB_ACTIVE_FOREGROUND : TAB_UNFOCUSED_ACTIVE_FOREGROUND) || '';

			// Actions
			tabActionBar.setFocusable(true);
		}

		// Tab is inactive
		else {

			// Container
			tabContainer.classList.remove('active');
			tabContainer.setAttribute('aria-selected', 'false');
			tabContainer.tabIndex = -1; // Only active tab can be focused into
			tabContainer.style.backgroundColor = this.getColor(isGroupActive ? TAB_INACTIVE_BACKGROUND : TAB_UNFOCUSED_INACTIVE_BACKGROUND) || '';
			tabContainer.style.boxShadow = '';

			// Label
			tabContainer.style.color = this.getColor(isGroupActive ? TAB_INACTIVE_FOREGROUND : TAB_UNFOCUSED_INACTIVE_FOREGROUND) || '';

			// Actions
			tabActionBar.setFocusable(false);
		}
	}

	private doRedrawTabDirty(isGroupActive: boolean, isTabActive: boolean, editor: EditorInput, tabContainer: HTMLElement): boolean {
		let hasModifiedBorderColor = false;

		// Tab: dirty (unless saving)
		if (editor.isDirty() && !editor.isSaving()) {
			tabContainer.classList.add('dirty');

			// Highlight modified tabs with a border if configured
			if (this.accessor.partOptions.highlightModifiedTabs) {
				let modifiedBorderColor: string | null;
				if (isGroupActive && isTabActive) {
					modifiedBorderColor = this.getColor(TAB_ACTIVE_MODIFIED_BORDER);
				} else if (isGroupActive && !isTabActive) {
					modifiedBorderColor = this.getColor(TAB_INACTIVE_MODIFIED_BORDER);
				} else if (!isGroupActive && isTabActive) {
					modifiedBorderColor = this.getColor(TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER);
				} else {
					modifiedBorderColor = this.getColor(TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER);
				}

				if (modifiedBorderColor) {
					hasModifiedBorderColor = true;

					tabContainer.classList.add('dirty-border-top');
					tabContainer.style.setProperty('--tab-dirty-border-top-color', modifiedBorderColor);
				}
			} else {
				tabContainer.classList.remove('dirty-border-top');
				tabContainer.style.removeProperty('--tab-dirty-border-top-color');
			}
		}

		// Tab: not dirty
		else {
			tabContainer.classList.remove('dirty', 'dirty-border-top');
			tabContainer.style.removeProperty('--tab-dirty-border-top-color');
		}

		return hasModifiedBorderColor;
	}

	private redrawTabBorders(index: number, tabContainer: HTMLElement): void {
		const isTabSticky = this.group.isSticky(index);
		const isTabLastSticky = isTabSticky && this.group.stickyCount === index + 1;

		// Borders / Outline
		const borderRightColor = ((isTabLastSticky ? this.getColor(TAB_LAST_PINNED_BORDER) : undefined) || this.getColor(TAB_BORDER) || this.getColor(contrastBorder));
		tabContainer.style.borderRight = borderRightColor ? `1px solid ${borderRightColor}` : '';
		tabContainer.style.outlineColor = this.getColor(activeContrastBorder) || '';
	}

	private getTabAtIndex(editorIndex: number): HTMLElement | undefined {
		if (editorIndex >= 0) {
			const tabsContainer = assertIsDefined(this.tabsContainer);

			return tabsContainer.children[editorIndex] as HTMLElement | undefined;
		}

		return undefined;
	}

	private getLastTab(): HTMLElement | undefined {
		return this.getTabAtIndex(this.group.count - 1);
	}

	public getTabAndIndex(editor: EditorInput): [HTMLElement, number /* index */] | undefined {
		const editorIndex = this.group.getIndexOfEditor(editor);
		const tab = this.getTabAtIndex(editorIndex);
		if (tab) {
			return [tab, editorIndex];
		}

		return undefined;
	}

	protected getKeybinding(action: IAction): ResolvedKeybinding | undefined {
		return this.keybindingService.lookupKeybinding(action.id, this.getEditorPaneAwareContextKeyService());
	}

	protected getKeybindingLabel(action: IAction): string | undefined {
		const keybinding = this.getKeybinding(action);

		return keybinding ? keybinding.getLabel() ?? undefined : undefined;
	}

	private getEditorPaneAwareContextKeyService(): IContextKeyService {
		return this.group.activeEditorPane?.scopedContextKeyService ?? this.contextKeyService;
	}

	public blockRevealActiveTabOnce(): void {

		// When closing tabs through the tab close button or gesture, the user
		// might want to rapidly close tabs in sequence and as such revealing
		// the active tab after each close would be annoying. As such we block
		// the automated revealing of the active tab once after the close is
		// triggered.
		this.blockRevealActiveTab = true;
	}

	public computeHeight(): number {
		// Wrap: we need to ask `offsetHeight` to get
		// the real height of the title area with wrapping.
		if (this.accessor.partOptions.wrapTabs && this.tabsAndActionsContainer?.classList.contains('wrapping')) {
			return this.tabsAndActionsContainer.offsetHeight;
		}
		return this.getTitleHeight();
	}

	public doLayoutTabs(activeTab: HTMLElement, activeIndex: number, dimensions: ITitleControlDimensions, options?: ITabsTitleControlLayoutOptions): void {

		// Always first layout tabs with wrapping support even if wrapping
		// is disabled. The result indicates if tabs wrap and if not, we
		// need to proceed with the layout without wrapping because even
		// if wrapping is enabled in settings, there are cases where
		// wrapping is disabled (e.g. due to space constraints)
		const tabsWrapMultiLine = this.doLayoutTabsWrapping(dimensions);
		if (!tabsWrapMultiLine) {
			this.doLayoutTabsNonWrapping(activeTab, activeIndex, options);
		}
	}

	private doLayoutTabsWrapping(dimensions: ITitleControlDimensions): boolean {
		const [tabsAndActionsContainer, tabsContainer, editorToolbarContainer, tabsScrollbar] = assertAllDefined(this.tabsAndActionsContainer, this.tabsContainer, this.editorToolbarContainer, this.tabsScrollbar);

		// Handle wrapping tabs according to setting:
		// - enabled: only add class if tabs wrap and don't exceed available dimensions
		// - disabled: remove class and margin-right variable

		const didTabsWrapMultiLine = tabsAndActionsContainer.classList.contains('wrapping');
		let tabsWrapMultiLine = didTabsWrapMultiLine;

		function updateTabsWrapping(enabled: boolean): void {
			tabsWrapMultiLine = enabled;

			// Toggle the `wrapped` class to enable wrapping
			tabsAndActionsContainer.classList.toggle('wrapping', tabsWrapMultiLine);

			// Update `last-tab-margin-right` CSS variable to account for the absolute
			// positioned editor actions container when tabs wrap. The margin needs to
			// be the width of the editor actions container to avoid screen cheese.
			tabsContainer.style.setProperty('--last-tab-margin-right', tabsWrapMultiLine ? `${editorToolbarContainer.offsetWidth}px` : '0');
		}

		// Setting enabled: selectively enable wrapping if possible
		if (this.accessor.partOptions.wrapTabs) {
			const visibleTabsWidth = tabsContainer.offsetWidth;
			const allTabsWidth = tabsContainer.scrollWidth;
			const lastTabFitsWrapped = () => {
				const lastTab = this.getLastTab();
				if (!lastTab) {
					return true; // no tab always fits
				}

				const lastTabOverlapWithToolbarWidth = lastTab.offsetWidth + editorToolbarContainer.offsetWidth - dimensions.available.width;
				if (lastTabOverlapWithToolbarWidth > 1) {
					// Allow for slight rounding errors related to zooming here
					// https://github.com/microsoft/vscode/issues/116385
					return false;
				}

				return true;
			};

			// If tabs wrap or should start to wrap (when width exceeds visible width)
			// we must trigger `updateWrapping` to set the `last-tab-margin-right`
			// accordingly based on the number of actions. The margin is important to
			// properly position the last tab apart from the actions
			//
			// We already check here if the last tab would fit when wrapped given the
			// editor toolbar will also show right next to it. This ensures we are not
			// enabling wrapping only to disable it again in the code below (this fixes
			// flickering issue https://github.com/microsoft/vscode/issues/115050)
			if (tabsWrapMultiLine || (allTabsWidth > visibleTabsWidth && lastTabFitsWrapped())) {
				updateTabsWrapping(true);
			}

			// Tabs wrap multiline: remove wrapping under certain size constraint conditions
			if (tabsWrapMultiLine) {
				if (
					(tabsContainer.offsetHeight > dimensions.available.height) ||											// if height exceeds available height
					(allTabsWidth === visibleTabsWidth && tabsContainer.offsetHeight === this.getTitleHeight()) || // if wrapping is not needed anymore
					(!lastTabFitsWrapped())																					// if last tab does not fit anymore
				) {
					updateTabsWrapping(false);
				}
			}
		}

		// Setting disabled: remove CSS traces only if tabs did wrap
		else if (didTabsWrapMultiLine) {
			updateTabsWrapping(false);
		}

		// If we transitioned from non-wrapping to wrapping, we need
		// to update the scrollbar to have an equal `width` and
		// `scrollWidth`. Otherwise a scrollbar would appear which is
		// never desired when wrapping.
		if (tabsWrapMultiLine && !didTabsWrapMultiLine) {
			const visibleTabsWidth = tabsContainer.offsetWidth;
			tabsScrollbar.setScrollDimensions({
				width: visibleTabsWidth,
				scrollWidth: visibleTabsWidth
			});
		}

		// Update the `last-in-row` class on tabs when wrapping
		// is enabled (it doesn't do any harm otherwise). This
		// class controls additional properties of tab when it is
		// the last tab in a row
		if (tabsWrapMultiLine) {

			// Using a map here to change classes after the for loop is
			// crucial for performance because changing the class on a
			// tab can result in layouts of the rendering engine.
			const tabs = new Map<HTMLElement, boolean /* last in row */>();

			let currentTabsPosY: number | undefined = undefined;
			let lastTab: HTMLElement | undefined = undefined;
			for (const child of tabsContainer.children) {
				const tab = child as HTMLElement;
				const tabPosY = tab.offsetTop;

				// Marks a new or the first row of tabs
				if (tabPosY !== currentTabsPosY) {
					currentTabsPosY = tabPosY;
					if (lastTab) {
						tabs.set(lastTab, true); // previous tab must be last in row then
					}
				}

				// Always remember last tab and ensure the
				// last-in-row class is not present until
				// we know the tab is last
				lastTab = tab;
				tabs.set(tab, false);
			}

			// Last tab overally is always last-in-row
			if (lastTab) {
				tabs.set(lastTab, true);
			}

			for (const [tab, lastInRow] of tabs) {
				tab.classList.toggle('last-in-row', lastInRow);
			}
		}

		return tabsWrapMultiLine;
	}

	private doLayoutTabsNonWrapping(activeTab: HTMLElement, activeIndex: number, options?: ITabsTitleControlLayoutOptions): void {
		const [tabsContainer, tabsScrollbar] = assertAllDefined(this.tabsContainer, this.tabsScrollbar);

		//
		// Synopsis
		// - allTabsWidth:   			sum of all tab widths
		// - stickyTabsWidth:			sum of all sticky tab widths (unless `pinnedTabSizing: normal`)
		// - visibleContainerWidth: 	size of tab container
		// - availableContainerWidth: 	size of tab container minus size of sticky tabs
		//
		// [------------------------------ All tabs width ---------------------------------------]
		// [------------------- Visible container width -------------------]
		//                         [------ Available container width ------]
		// [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                 Active Tab Width [-------]
		// [------- Active Tab Pos X -------]
		// [-- Sticky Tabs Width --]
		//

		const visibleTabsWidth = tabsContainer.offsetWidth;
		const allTabsWidth = tabsContainer.scrollWidth;

		// Compute width of sticky tabs depending on pinned tab sizing
		// - compact: sticky-tabs * TAB_SIZES.compact
		// -  shrink: sticky-tabs * TAB_SIZES.shrink
		// -  normal: 0 (sticky tabs inherit look and feel from non-sticky tabs)
		let stickyTabsWidth = 0;
		if (this.group.stickyCount > 0) {
			let stickyTabWidth = 0;
			switch (this.accessor.partOptions.pinnedTabSizing) {
				case 'compact':
					stickyTabWidth = TabBarControl.TAB_WIDTH.compact;
					break;
				case 'shrink':
					stickyTabWidth = TabBarControl.TAB_WIDTH.shrink;
					break;
			}

			stickyTabsWidth = this.group.stickyCount * stickyTabWidth;
		}

		// Figure out if active tab is positioned static which has an
		// impact on whether to reveal the tab or not later
		let activeTabPositionStatic = this.accessor.partOptions.pinnedTabSizing !== 'normal' && this.group.isSticky(activeIndex);

		// Special case: we have sticky tabs but the available space for showing tabs
		// is little enough that we need to disable sticky tabs sticky positioning
		// so that tabs can be scrolled at naturally.
		let availableTabsContainerWidth = visibleTabsWidth - stickyTabsWidth;
		if (this.group.stickyCount > 0 && availableTabsContainerWidth < TabBarControl.TAB_WIDTH.fit) {
			tabsContainer.classList.add('disable-sticky-tabs');

			availableTabsContainerWidth = visibleTabsWidth;
			stickyTabsWidth = 0;
			activeTabPositionStatic = false;
		} else {
			tabsContainer.classList.remove('disable-sticky-tabs');
		}

		let activeTabPosX: number | undefined;
		let activeTabWidth: number | undefined;

		if (!this.blockRevealActiveTab) {
			activeTabPosX = activeTab.offsetLeft;
			activeTabWidth = activeTab.offsetWidth;
		}

		// Update scrollbar
		const { width: oldVisibleTabsWidth, scrollWidth: oldAllTabsWidth } = tabsScrollbar.getScrollDimensions();
		tabsScrollbar.setScrollDimensions({
			width: visibleTabsWidth,
			scrollWidth: allTabsWidth
		});
		const dimensionsChanged = oldVisibleTabsWidth !== visibleTabsWidth || oldAllTabsWidth !== allTabsWidth;

		// Revealing the active tab is skipped under some conditions:
		if (
			this.blockRevealActiveTab ||							// explicitly disabled
			typeof activeTabPosX !== 'number' ||					// invalid dimension
			typeof activeTabWidth !== 'number' ||					// invalid dimension
			activeTabPositionStatic ||								// static tab (sticky)
			(!dimensionsChanged && !options?.forceRevealActiveTab) 	// dimensions did not change and we have low layout priority (https://github.com/microsoft/vscode/issues/133631)
		) {
			this.blockRevealActiveTab = false;
			return;
		}

		// Reveal the active one
		const tabsContainerScrollPosX = tabsScrollbar.getScrollPosition().scrollLeft;
		const activeTabFits = activeTabWidth <= availableTabsContainerWidth;
		const adjustedActiveTabPosX = activeTabPosX - stickyTabsWidth;

		//
		// Synopsis
		// - adjustedActiveTabPosX: the adjusted tabPosX takes the width of sticky tabs into account
		//   conceptually the scrolling only begins after sticky tabs so in order to reveal a tab fully
		//   the actual position needs to be adjusted for sticky tabs.
		//
		// Tab is overflowing to the right: Scroll minimally until the element is fully visible to the right
		// Note: only try to do this if we actually have enough width to give to show the tab fully!
		//
		// Example: Tab G should be made active and needs to be fully revealed as such.
		//
		// [-------------------------------- All tabs width -----------------------------------------]
		// [-------------------- Visible container width --------------------]
		//                           [----- Available container width -------]
		//     [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                     Active Tab Width [-------]
		//     [------- Active Tab Pos X -------]
		//                             [-------- Adjusted Tab Pos X -------]
		//     [-- Sticky Tabs Width --]
		//
		//
		if (activeTabFits && tabsContainerScrollPosX + availableTabsContainerWidth < adjustedActiveTabPosX + activeTabWidth) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainerScrollPosX + ((adjustedActiveTabPosX + activeTabWidth) /* right corner of tab */ - (tabsContainerScrollPosX + availableTabsContainerWidth) /* right corner of view port */)
			});
		}

		//
		// Tab is overlflowing to the left or does not fit: Scroll it into view to the left
		//
		// Example: Tab C should be made active and needs to be fully revealed as such.
		//
		// [----------------------------- All tabs width ----------------------------------------]
		//     [------------------ Visible container width ------------------]
		//                           [----- Available container width -------]
		// [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                 Active Tab Width [-------]
		// [------- Active Tab Pos X -------]
		//      Adjusted Tab Pos X []
		// [-- Sticky Tabs Width --]
		//
		//
		else if (tabsContainerScrollPosX > adjustedActiveTabPosX || !activeTabFits) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: adjustedActiveTabPosX
			});
		}
	}

	public override dispose(): void {
		super.dispose();

		this.tabDisposables = dispose(this.tabDisposables);
	}
}