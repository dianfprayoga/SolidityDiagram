/**
 * Notes Manager - Allows adding text annotations to the diagram
 * Supports sticky notes and text labels with arrows pointing to code
 */

export function generateNotesManagerScript(): string {
    return `
    // ============ Notes Manager ============
    class NotesManager {
        constructor() {
            this.notes = [];
            this.noteIdCounter = 0;
            this.activeNote = null;
            this.isDragging = false;
            this.dragOffset = { x: 0, y: 0 };
            this.isDrawingArrow = false;
            this.arrowSource = null;

            this.init();
        }

        init() {
            // Add keyboard shortcut for creating notes
            document.addEventListener('keydown', (e) => {
                // Ctrl/Cmd + N to create note at center of viewport
                if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                    e.preventDefault();
                    this.createNoteAtCenter();
                }
                // Ctrl/Cmd + L to create label at center
                if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                    e.preventDefault();
                    this.createLabelAtCenter();
                }
                // Escape to cancel arrow drawing
                if (e.key === 'Escape' && this.isDrawingArrow) {
                    this.cancelArrowDrawing();
                }
            });

            // Double-click on canvas to create note
            const canvas = document.getElementById('infinite-canvas');
            if (canvas) {
                canvas.addEventListener('dblclick', (e) => {
                    // Only if clicking on canvas background, not on blocks
                    if (e.target === canvas || e.target.id === 'canvas-content') {
                        const pos = this.getCanvasPosition(e.clientX, e.clientY);
                        this.createNote(pos.x, pos.y);
                    }
                });
            }

            // Handle clicks on code lines for arrow targeting
            document.addEventListener('click', (e) => {
                if (this.isDrawingArrow) {
                    const codeLine = e.target.closest('.code-line');
                    if (codeLine) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.completeArrow(codeLine);
                    }
                }
            }, true);

            // Create annotation arrow marker
            this.createArrowMarker();

            // Load saved notes from state
            this.loadNotes();

            // Listen for canvas transform changes to update arrows
            this.setupTransformListener();
        }

        setupTransformListener() {
            // Hook into canvas controller transform changes
            const checkTransform = () => {
                if (typeof canvasController !== 'undefined' && canvasController) {
                    const originalApply = canvasController.applyTransform.bind(canvasController);
                    canvasController.applyTransform = () => {
                        originalApply();
                        // Debounce arrow updates
                        if (this.arrowUpdateTimeout) clearTimeout(this.arrowUpdateTimeout);
                        this.arrowUpdateTimeout = setTimeout(() => {
                            this.updateAllAnnotationArrows();
                        }, 16);
                    };
                } else {
                    // Canvas controller not ready yet, retry
                    setTimeout(checkTransform, 100);
                }
            };
            checkTransform();

            // Also update on window resize
            window.addEventListener('resize', () => {
                this.updateAllAnnotationArrows();
            });
        }

        updateAllAnnotationArrows() {
            this.notes.forEach(note => {
                if (note.targetLine && note.targetBlock) {
                    this.drawAnnotationArrow(note);
                }
            });
        }

        createArrowMarker() {
            const svg = document.getElementById('arrows-svg');
            if (!svg) return;

            let defs = svg.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svg.appendChild(defs);
            }

            // Check if marker already exists
            if (document.getElementById('annotation-arrow-marker')) return;

            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'annotation-arrow-marker');
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '7');
            marker.setAttribute('refX', '9');
            marker.setAttribute('refY', '3.5');
            marker.setAttribute('orient', 'auto');

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M0,0 L10,3.5 L0,7 L2,3.5 Z');
            path.setAttribute('fill', 'currentColor');

            marker.appendChild(path);
            defs.appendChild(marker);
        }

        getCanvasPosition(clientX, clientY) {
            // Convert screen coordinates to canvas coordinates
            if (typeof canvasController !== 'undefined' && canvasController) {
                return canvasController.screenToCanvas(clientX, clientY);
            }
            return { x: clientX, y: clientY };
        }

        createNoteAtCenter() {
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;
            const pos = this.getCanvasPosition(centerX, centerY);
            this.createNote(pos.x, pos.y);
        }

        createLabelAtCenter() {
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;
            const pos = this.getCanvasPosition(centerX, centerY);
            this.createLabel(pos.x, pos.y);
        }

        createNote(x, y, text = '', color = 'yellow') {
            const noteId = 'note-' + (++this.noteIdCounter);
            
            const note = {
                id: noteId,
                type: 'note',
                x: x,
                y: y,
                text: text,
                color: color,
                width: 200,
                height: 120,
                targetLine: null,
                targetBlock: null
            };

            this.notes.push(note);
            this.renderNote(note);
            this.saveNotes();

            // Focus the textarea for immediate editing
            setTimeout(() => {
                const textarea = document.querySelector('#' + noteId + ' textarea');
                if (textarea) textarea.focus();
            }, 50);

            return noteId;
        }

        createLabel(x, y, text = '', color = 'blue') {
            const noteId = 'label-' + (++this.noteIdCounter);
            
            const label = {
                id: noteId,
                type: 'label',
                x: x,
                y: y,
                text: text,
                color: color,
                textColor: 'white',
                fontSize: 12,
                targetLine: null,
                targetBlock: null
            };

            this.notes.push(label);
            this.renderLabel(label);
            this.saveNotes();

            // Focus the input for immediate editing
            setTimeout(() => {
                const input = document.querySelector('#' + noteId + ' .label-text');
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 50);

            return noteId;
        }

        renderLabel(label) {
            const canvasContent = document.getElementById('canvas-content');
            if (!canvasContent) return;

            const labelEl = document.createElement('div');
            labelEl.id = label.id;
            labelEl.className = 'diagram-label label-' + label.color;
            labelEl.style.left = label.x + 'px';
            labelEl.style.top = label.y + 'px';

            const fontSize = label.fontSize || 12;
            const textColor = label.textColor || 'white';

            labelEl.innerHTML = \`
                <div class="label-drag-handle">⋮⋮</div>
                <input type="text" class="label-text" value="\${this.escapeHtml(label.text)}" placeholder="Add label..." 
                       style="font-size: \${fontSize}px; color: \${textColor};" />
                <div class="label-actions">
                    <button class="label-arrow-btn" title="Draw arrow to code">↗</button>
                    <button class="label-size-btn label-size-down" title="Smaller text">A-</button>
                    <button class="label-size-btn label-size-up" title="Larger text">A+</button>
                    <button class="label-textcolor-btn" data-tcolor="white" title="White text" style="color:#fff;">T</button>
                    <button class="label-textcolor-btn" data-tcolor="black" title="Black text" style="color:#000;">T</button>
                    <button class="label-textcolor-btn" data-tcolor="yellow" title="Yellow text" style="color:#fde047;">T</button>
                    <span class="label-divider">|</span>
                    <button class="label-color-btn" data-color="blue" title="Blue bg">🔵</button>
                    <button class="label-color-btn" data-color="red" title="Red bg">🔴</button>
                    <button class="label-color-btn" data-color="green" title="Green bg">🟢</button>
                    <button class="label-color-btn" data-color="orange" title="Orange bg">🟠</button>
                    <button class="label-delete-btn" title="Delete">×</button>
                </div>
            \`;

            canvasContent.appendChild(labelEl);
            this.setupLabelEvents(labelEl, label);

            // Draw arrow if target exists
            if (label.targetLine && label.targetBlock) {
                setTimeout(() => this.drawAnnotationArrow(label), 50);
            }
        }

        setupLabelEvents(labelEl, label) {
            const dragHandle = labelEl.querySelector('.label-drag-handle');
            const input = labelEl.querySelector('.label-text');
            const deleteBtn = labelEl.querySelector('.label-delete-btn');
            const arrowBtn = labelEl.querySelector('.label-arrow-btn');
            const colorBtns = labelEl.querySelectorAll('.label-color-btn');
            const sizeUpBtn = labelEl.querySelector('.label-size-up');
            const sizeDownBtn = labelEl.querySelector('.label-size-down');
            const textColorBtns = labelEl.querySelectorAll('.label-textcolor-btn');

            // Drag functionality
            dragHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startDrag(labelEl, label, e);
            });

            // Also drag from anywhere on label
            labelEl.addEventListener('mousedown', (e) => {
                if (e.target === labelEl) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.startDrag(labelEl, label, e);
                }
            });

            // Save text on input
            input.addEventListener('input', () => {
                label.text = input.value;
                this.saveNotes();
            });

            // Prevent canvas pan
            labelEl.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });

            // Delete button
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteNote(label.id);
            });

            // Arrow button - start drawing arrow
            arrowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startArrowDrawing(label);
            });

            // Background color buttons
            colorBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newColor = btn.dataset.color;
                    this.changeLabelColor(label.id, newColor);
                });
            });

            // Text size buttons
            if (sizeUpBtn) {
                sizeUpBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.changeLabelFontSize(label.id, 2);
                });
            }
            if (sizeDownBtn) {
                sizeDownBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.changeLabelFontSize(label.id, -2);
                });
            }

            // Text color buttons
            textColorBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newColor = btn.dataset.tcolor;
                    this.changeLabelTextColor(label.id, newColor);
                });
            });
        }

        changeLabelFontSize(labelId, delta) {
            const label = this.notes.find(n => n.id === labelId);
            if (!label) return;

            label.fontSize = Math.max(8, Math.min(32, (label.fontSize || 12) + delta));
            
            const input = document.querySelector('#' + labelId + ' .label-text');
            if (input) {
                input.style.fontSize = label.fontSize + 'px';
            }
            this.saveNotes();
        }

        changeLabelTextColor(labelId, color) {
            const label = this.notes.find(n => n.id === labelId);
            if (!label) return;

            const colorMap = {
                'white': '#ffffff',
                'black': '#1f2937',
                'yellow': '#fde047'
            };
            
            label.textColor = colorMap[color] || color;
            
            const input = document.querySelector('#' + labelId + ' .label-text');
            if (input) {
                input.style.color = label.textColor;
            }
            this.saveNotes();
        }

        startArrowDrawing(annotation) {
            this.isDrawingArrow = true;
            this.arrowSource = annotation;
            document.body.style.cursor = 'crosshair';
            
            // Highlight code lines as targets
            document.querySelectorAll('.code-line').forEach(line => {
                line.classList.add('arrow-target-hint');
            });

            // Show hint
            this.showArrowHint('Click on a code line to connect the arrow');
        }

        cancelArrowDrawing() {
            this.isDrawingArrow = false;
            this.arrowSource = null;
            document.body.style.cursor = '';
            
            document.querySelectorAll('.code-line').forEach(line => {
                line.classList.remove('arrow-target-hint');
            });

            this.hideArrowHint();
        }

        completeArrow(codeLine) {
            if (!this.arrowSource) return;

            const lineNum = codeLine.dataset.line;
            const blockId = codeLine.dataset.block;

            this.arrowSource.targetLine = lineNum;
            this.arrowSource.targetBlock = blockId;

            this.drawAnnotationArrow(this.arrowSource);
            this.saveNotes();
            this.cancelArrowDrawing();
        }

        drawAnnotationArrow(annotation) {
            // Remove existing arrow for this annotation
            const existingArrow = document.querySelector('#arrow-' + annotation.id);
            if (existingArrow) existingArrow.remove();

            const annotationEl = document.getElementById(annotation.id);
            const targetLine = document.getElementById(annotation.targetBlock + '-line-' + annotation.targetLine);
            
            if (!annotationEl || !targetLine) return;

            const svg = document.getElementById('arrows-svg');
            if (!svg) return;

            const annotationRect = annotationEl.getBoundingClientRect();
            const targetRect = targetLine.getBoundingClientRect();

            // Calculate start and end points
            const startX = annotationRect.right;
            const startY = annotationRect.top + annotationRect.height / 2;
            const endX = targetRect.left - 4;
            const endY = targetRect.top + targetRect.height / 2;

            // Create arrow group
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.id = 'arrow-' + annotation.id;
            group.setAttribute('class', 'annotation-arrow');

            // Calculate curve
            const dx = Math.abs(endX - startX);
            const cp1x = startX + dx * 0.3;
            const cp2x = endX - dx * 0.3;

            const d = \`M \${startX} \${startY} C \${cp1x} \${startY}, \${cp2x} \${endY}, \${endX} \${endY}\`;

            const color = this.getLabelColor(annotation.color);

            // Arrow path
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-dasharray', '4,2');
            path.style.color = color; // For marker fill

            // Create a colored marker for this arrow
            const markerId = 'marker-' + annotation.id;
            this.createColoredMarker(markerId, color);
            path.setAttribute('marker-end', 'url(#' + markerId + ')');

            group.appendChild(path);
            svg.appendChild(group);
        }

        createColoredMarker(id, color) {
            const svg = document.getElementById('arrows-svg');
            if (!svg) return;

            let defs = svg.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svg.appendChild(defs);
            }

            // Remove existing marker with same id
            const existing = document.getElementById(id);
            if (existing) existing.remove();

            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', id);
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '7');
            marker.setAttribute('refX', '9');
            marker.setAttribute('refY', '3.5');
            marker.setAttribute('orient', 'auto');

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M0,0 L10,3.5 L0,7 L2,3.5 Z');
            path.setAttribute('fill', color);

            marker.appendChild(path);
            defs.appendChild(marker);
        }

        getLabelColor(color) {
            const colors = {
                'blue': '#3b82f6',
                'red': '#ef4444',
                'green': '#22c55e',
                'orange': '#f97316',
                'yellow': '#eab308',
                'pink': '#ec4899'
            };
            return colors[color] || colors.blue;
        }

        updateAnnotationArrows() {
            // Redraw all annotation arrows (called on drag/resize)
            this.notes.forEach(note => {
                if (note.targetLine && note.targetBlock) {
                    this.drawAnnotationArrow(note);
                }
            });
        }

        showArrowHint(message) {
            let hint = document.getElementById('arrow-hint');
            if (!hint) {
                hint = document.createElement('div');
                hint.id = 'arrow-hint';
                hint.className = 'arrow-drawing-hint';
                document.body.appendChild(hint);
            }
            hint.textContent = message;
            hint.style.display = 'block';
        }

        hideArrowHint() {
            const hint = document.getElementById('arrow-hint');
            if (hint) hint.style.display = 'none';
        }

        changeLabelColor(labelId, color) {
            const label = this.notes.find(n => n.id === labelId);
            if (!label) return;

            label.color = color;
            const labelEl = document.getElementById(labelId);
            if (labelEl) {
                labelEl.className = 'diagram-label label-' + color;
            }
            // Redraw arrow with new color
            if (label.targetLine && label.targetBlock) {
                this.drawAnnotationArrow(label);
            }
            this.saveNotes();
        }

        renderNote(note) {
            const canvasContent = document.getElementById('canvas-content');
            if (!canvasContent) return;

            const noteEl = document.createElement('div');
            noteEl.id = note.id;
            noteEl.className = 'diagram-note note-' + note.color;
            noteEl.style.left = note.x + 'px';
            noteEl.style.top = note.y + 'px';
            noteEl.style.width = (note.width || 200) + 'px';
            noteEl.style.minHeight = (note.height || 120) + 'px';

            noteEl.innerHTML = \`
                <div class="note-header">
                    <div class="note-drag-handle">📝 Note</div>
                    <div class="note-actions">
                        <button class="note-arrow-btn" title="Draw arrow to code">↗</button>
                        <button class="note-color-btn" data-color="yellow" title="Yellow">🟡</button>
                        <button class="note-color-btn" data-color="green" title="Green">🟢</button>
                        <button class="note-color-btn" data-color="blue" title="Blue">🔵</button>
                        <button class="note-color-btn" data-color="pink" title="Pink">🟣</button>
                        <button class="note-delete-btn" title="Delete note">×</button>
                    </div>
                </div>
                <textarea class="note-content" placeholder="Add your notes here...">\${this.escapeHtml(note.text)}</textarea>
            \`;

            canvasContent.appendChild(noteEl);

            // Setup event listeners
            this.setupNoteEvents(noteEl, note);

            // Draw arrow if target exists
            if (note.targetLine && note.targetBlock) {
                this.drawAnnotationArrow(note);
            }
        }

        setupNoteEvents(noteEl, note) {
            const dragHandle = noteEl.querySelector('.note-drag-handle');
            const textarea = noteEl.querySelector('textarea');
            const deleteBtn = noteEl.querySelector('.note-delete-btn');
            const arrowBtn = noteEl.querySelector('.note-arrow-btn');
            const colorBtns = noteEl.querySelectorAll('.note-color-btn');

            // Drag functionality
            dragHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startDrag(noteEl, note, e);
            });

            // Save text on input
            textarea.addEventListener('input', () => {
                note.text = textarea.value;
                this.saveNotes();
            });

            // Prevent canvas pan when interacting with note
            noteEl.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });

            // Delete button
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteNote(note.id);
            });

            // Arrow button - start drawing arrow
            if (arrowBtn) {
                arrowBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.startArrowDrawing(note);
                });
            }

            // Color buttons
            colorBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newColor = btn.dataset.color;
                    this.changeNoteColor(note.id, newColor);
                });
            });
        }

        startDrag(noteEl, note, e) {
            this.isDragging = true;
            this.activeNote = { el: noteEl, data: note };
            
            const rect = noteEl.getBoundingClientRect();
            const transform = canvasController ? canvasController.getTransform() : { scale: 1 };
            
            this.dragOffset = {
                x: (e.clientX - rect.left) / transform.scale,
                y: (e.clientY - rect.top) / transform.scale
            };

            noteEl.classList.add('dragging');
            document.body.style.cursor = 'grabbing';

            const onMouseMove = (e) => {
                if (!this.isDragging || !this.activeNote) return;
                
                const pos = this.getCanvasPosition(e.clientX, e.clientY);
                const newX = pos.x - this.dragOffset.x;
                const newY = pos.y - this.dragOffset.y;

                this.activeNote.el.style.left = newX + 'px';
                this.activeNote.el.style.top = newY + 'px';
                this.activeNote.data.x = newX;
                this.activeNote.data.y = newY;
            };

            const onMouseUp = () => {
                if (this.activeNote) {
                    this.activeNote.el.classList.remove('dragging');
                    // Redraw arrow if exists
                    if (this.activeNote.data.targetLine && this.activeNote.data.targetBlock) {
                        this.drawAnnotationArrow(this.activeNote.data);
                    }
                    this.saveNotes();
                }
                this.isDragging = false;
                this.activeNote = null;
                document.body.style.cursor = '';
                
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }

        deleteNote(noteId) {
            const index = this.notes.findIndex(n => n.id === noteId);
            if (index !== -1) {
                this.notes.splice(index, 1);
                const noteEl = document.getElementById(noteId);
                if (noteEl) noteEl.remove();
                // Also remove the arrow
                const arrowEl = document.getElementById('arrow-' + noteId);
                if (arrowEl) arrowEl.remove();
                this.saveNotes();
            }
        }

        changeNoteColor(noteId, color) {
            const note = this.notes.find(n => n.id === noteId);
            if (!note) return;

            note.color = color;
            const noteEl = document.getElementById(noteId);
            if (noteEl) {
                noteEl.className = 'diagram-note note-' + color;
            }
            // Redraw arrow with new color if exists
            if (note.targetLine && note.targetBlock) {
                this.drawAnnotationArrow(note);
            }
            this.saveNotes();
        }

        saveNotes() {
            // Save to VS Code state
            if (typeof vscode !== 'undefined') {
                vscode.postMessage({
                    command: 'saveNotes',
                    notes: this.notes
                });
            }
            // Also save to localStorage as backup
            try {
                localStorage.setItem('diagram-notes', JSON.stringify(this.notes));
            } catch (e) {}
        }

        loadNotes() {
            // Try to load from localStorage
            try {
                const saved = localStorage.getItem('diagram-notes');
                if (saved) {
                    const notes = JSON.parse(saved);
                    notes.forEach(note => {
                        const idNum = parseInt(note.id.split('-')[1]) || 0;
                        this.noteIdCounter = Math.max(this.noteIdCounter, idNum);
                        this.notes.push(note);
                        if (note.type === 'label') {
                            this.renderLabel(note);
                        } else {
                            this.renderNote(note);
                        }
                    });
                }
            } catch (e) {}
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    // Initialize notes manager
    let notesManager = null;
    document.addEventListener('DOMContentLoaded', () => {
        notesManager = new NotesManager();
    });
    `;
}

/**
 * Generate CSS styles for notes
 */
export function generateNotesStyles(): string {
    return `
    /* ============ Notes Styles ============ */
    
    .diagram-note {
        position: absolute;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 15;
        display: flex;
        flex-direction: column;
        min-width: 150px;
        max-width: 400px;
    }

    .diagram-note.dragging {
        opacity: 0.9;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        z-index: 100;
    }

    /* Note colors */
    .note-yellow {
        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
        border: 1px solid #f59e0b;
    }

    .note-green {
        background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
        border: 1px solid #10b981;
    }

    .note-blue {
        background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
        border: 1px solid #3b82f6;
    }

    .note-pink {
        background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%);
        border: 1px solid #ec4899;
    }

    .note-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        background: rgba(0, 0, 0, 0.05);
        border-radius: 4px 4px 0 0;
    }

    .note-drag-handle {
        font-size: 11px;
        font-weight: 600;
        color: #374151;
        cursor: grab;
        user-select: none;
    }

    .note-drag-handle:active {
        cursor: grabbing;
    }

    .note-actions {
        display: flex;
        gap: 2px;
        align-items: center;
    }

    .note-color-btn {
        background: none;
        border: none;
        font-size: 10px;
        cursor: pointer;
        padding: 2px;
        opacity: 0.7;
        transition: opacity 0.15s, transform 0.15s;
    }

    .note-color-btn:hover {
        opacity: 1;
        transform: scale(1.2);
    }

    .note-delete-btn {
        background: none;
        border: none;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        padding: 0 4px;
        color: #6b7280;
        margin-left: 4px;
        transition: color 0.15s;
    }

    .note-delete-btn:hover {
        color: #ef4444;
    }

    .note-content {
        flex: 1;
        padding: 8px;
        border: none;
        background: transparent;
        resize: both;
        min-height: 80px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 12px;
        line-height: 1.5;
        color: #1f2937;
        outline: none;
    }

    .note-content::placeholder {
        color: #9ca3af;
    }

    .note-arrow-btn {
        background: none;
        border: none;
        font-size: 12px;
        cursor: pointer;
        padding: 2px 4px;
        opacity: 0.7;
        transition: opacity 0.15s, transform 0.15s;
    }

    .note-arrow-btn:hover {
        opacity: 1;
        transform: scale(1.2);
    }

    /* ============ Text Labels ============ */

    .diagram-label {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        z-index: 15;
        white-space: nowrap;
    }

    .diagram-label.dragging {
        opacity: 0.9;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        z-index: 100;
    }

    /* Label colors */
    .label-blue {
        background: #3b82f6;
        border: 1px solid #2563eb;
        color: white;
    }

    .label-red {
        background: #ef4444;
        border: 1px solid #dc2626;
        color: white;
    }

    .label-green {
        background: #22c55e;
        border: 1px solid #16a34a;
        color: white;
    }

    .label-orange {
        background: #f97316;
        border: 1px solid #ea580c;
        color: white;
    }

    .label-drag-handle {
        cursor: grab;
        user-select: none;
        font-size: 10px;
        opacity: 0.7;
        padding: 0 2px;
    }

    .label-drag-handle:active {
        cursor: grabbing;
    }

    .label-text {
        background: transparent;
        border: none;
        color: inherit;
        font-size: 12px;
        font-weight: 500;
        outline: none;
        min-width: 60px;
        max-width: 200px;
    }

    .label-text::placeholder {
        color: rgba(255, 255, 255, 0.6);
    }

    .label-actions {
        display: flex;
        gap: 2px;
        align-items: center;
        opacity: 0;
        transition: opacity 0.15s;
    }

    .diagram-label:hover .label-actions {
        opacity: 1;
    }

    .label-arrow-btn,
    .label-color-btn,
    .label-delete-btn {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        font-size: 10px;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 2px;
        transition: background 0.15s;
    }

    .label-arrow-btn:hover,
    .label-color-btn:hover,
    .label-delete-btn:hover {
        background: rgba(255, 255, 255, 0.4);
    }

    .label-delete-btn {
        font-size: 14px;
        font-weight: bold;
        margin-left: 4px;
    }

    .label-size-btn {
        font-size: 9px !important;
        font-weight: bold;
        min-width: 20px;
    }

    .label-textcolor-btn {
        font-size: 10px !important;
        font-weight: bold;
        min-width: 18px;
        text-shadow: 0 0 2px rgba(0,0,0,0.5);
    }

    .label-divider {
        color: rgba(255,255,255,0.3);
        font-size: 12px;
        margin: 0 2px;
    }

    /* Arrow drawing hint */
    .arrow-drawing-hint {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(59, 130, 246, 0.95);
        color: white;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 12px;
        z-index: 2000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    /* Code line target hint during arrow drawing */
    .code-line.arrow-target-hint {
        cursor: crosshair !important;
    }

    .code-line.arrow-target-hint:hover {
        background: rgba(59, 130, 246, 0.3) !important;
        outline: 1px dashed #3b82f6;
    }

    /* Annotation arrows */
    .annotation-arrow path {
        pointer-events: none;
    }
    `;
}
