/**
 * Arrow Manager - Dynamic arrow positioning with proper routing around blocks
 * Arrows connect at block edges without overlapping content
 */

export interface ArrowDefinition {
    id: string;
    sourceBlockId: string;
    sourceLine: number;
    targetBlockId: string;
    targetLine?: number;
    type: 'function' | 'struct' | 'enum' | 'statevar';
    label?: string;
}

/**
 * Generates the JavaScript code for the arrow manager
 */
export function generateArrowManagerScript(): string {
    return `
    // ============ Arrow Manager ============
    class ArrowManager {
        constructor() {
            this.arrows = [];
            this.svg = null;
            this.defs = null;
            this.animationFrameId = null;

            this.init();
        }

        init() {
            this.svg = document.getElementById('arrows-svg');
            if (!this.svg) return;

            this.createMarkerDefs();

            // Update on scroll within code blocks
            document.addEventListener('scroll', (e) => {
                if (e.target.classList && e.target.classList.contains('code-block')) {
                    this.scheduleUpdate();
                }
            }, true);

            window.addEventListener('resize', () => this.scheduleUpdate());
        }

        createMarkerDefs() {
            this.defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

            // Small, subtle arrow markers
            this.defs.appendChild(this.createMarker('arrow-function', '#f38ba8'));
            this.defs.appendChild(this.createMarker('arrow-struct', '#89dceb'));
            this.defs.appendChild(this.createMarker('arrow-enum', '#a6e3a1'));
            this.defs.appendChild(this.createMarker('arrow-statevar', '#fab387'));

            // Glitter filter for hover effect
            const glitterFilter = this.createGlitterFilter();
            this.defs.appendChild(glitterFilter);

            this.svg.appendChild(this.defs);
        }

        createGlitterFilter() {
            const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            filter.setAttribute('id', 'glitter');
            filter.setAttribute('x', '-50%');
            filter.setAttribute('y', '-50%');
            filter.setAttribute('width', '200%');
            filter.setAttribute('height', '200%');

            // Glow effect
            const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
            feGaussianBlur.setAttribute('in', 'SourceGraphic');
            feGaussianBlur.setAttribute('stdDeviation', '3');
            feGaussianBlur.setAttribute('result', 'blur');

            const feMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
            const feMergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
            feMergeNode1.setAttribute('in', 'blur');
            const feMergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
            feMergeNode2.setAttribute('in', 'blur');
            const feMergeNode3 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
            feMergeNode3.setAttribute('in', 'SourceGraphic');

            feMerge.appendChild(feMergeNode1);
            feMerge.appendChild(feMergeNode2);
            feMerge.appendChild(feMergeNode3);

            filter.appendChild(feGaussianBlur);
            filter.appendChild(feMerge);

            return filter;
        }

        createMarker(id, color) {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', id);
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('refX', '7');
            marker.setAttribute('refY', '3');
            marker.setAttribute('orient', 'auto');

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M0,0 L8,3 L0,6 L2,3 Z');
            path.setAttribute('fill', color);

            marker.appendChild(path);
            return marker;
        }

        setArrows(arrowDefs) {
            this.arrows = arrowDefs;
            this.scheduleUpdate();
        }

        addArrow(arrowDef) {
            // Check if arrow already exists
            const exists = this.arrows.some(a => 
                a.sourceBlockId === arrowDef.sourceBlockId && 
                a.targetBlockId === arrowDef.targetBlockId &&
                a.sourceLine === arrowDef.sourceLine
            );
            
            if (!exists) {
                this.arrows.push(arrowDef);
                this.scheduleUpdate();
            }
        }

        removeArrow(arrowId) {
            const index = this.arrows.findIndex(a => a.id === arrowId);
            if (index !== -1) {
                this.arrows.splice(index, 1);
                this.scheduleUpdate();
            }
        }

        removeArrowsForBlock(blockId) {
            // Remove all arrows connected to this block (as source or target)
            this.arrows = this.arrows.filter(a => 
                a.sourceBlockId !== blockId && a.targetBlockId !== blockId
            );
            this.scheduleUpdate();
        }

        getArrows() {
            return [...this.arrows];
        }

        scheduleUpdate() {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
            }
            this.animationFrameId = requestAnimationFrame(() => this.updateAllArrows());
        }

        updateAllArrows() {
            // Clear existing
            this.svg.querySelectorAll('.arrow-line').forEach(el => el.remove());

            for (const arrow of this.arrows) {
                this.drawArrow(arrow);
            }
        }

        drawArrow(arrow) {
            const sourceBlock = document.getElementById(arrow.sourceBlockId);
            const targetBlock = document.getElementById(arrow.targetBlockId);
            if (!sourceBlock || !targetBlock) return;

            const sourceRect = sourceBlock.getBoundingClientRect();
            const targetRect = targetBlock.getBoundingClientRect();

            // Determine direction
            const isTargetLeft = targetRect.right < sourceRect.left;
            const isTargetRight = targetRect.left > sourceRect.right;

            // Find source Y position from line
            const sourceLineEl = document.getElementById(arrow.sourceBlockId + '-line-' + arrow.sourceLine);
            let sourceY = this.getSourceY(sourceLineEl, sourceBlock);
            
            // Target Y at header center
            const targetHeader = targetBlock.querySelector('.block-header');
            const targetY = targetHeader 
                ? targetHeader.getBoundingClientRect().top + targetHeader.getBoundingClientRect().height / 2
                : targetRect.top + 25;

            // Calculate connection points at block edges
            let startX, startY, endX, endY;

            if (isTargetLeft) {
                // Target is to the left
                startX = sourceRect.left - 2;
                startY = sourceY;
                endX = targetRect.right + 2;
                endY = targetY;
            } else if (isTargetRight) {
                // Target is to the right
                startX = sourceRect.right + 2;
                startY = sourceY;
                endX = targetRect.left - 2;
                endY = targetY;
            } else {
                // Overlapping horizontally - skip or draw differently
                return;
            }

            // Check if source line is visible
            if (!this.isLineVisible(sourceLineEl, sourceBlock)) {
                return; // Don't draw arrow if source line is scrolled out
            }

            // Create the path that goes OUTSIDE the blocks
            const path = this.createPath(startX, startY, endX, endY, isTargetLeft, arrow.type);
            this.svg.appendChild(path);
        }

        getSourceY(lineEl, blockEl) {
            if (!lineEl) {
                const header = blockEl.querySelector('.block-header');
                if (header) {
                    const r = header.getBoundingClientRect();
                    return r.top + r.height / 2;
                }
                return blockEl.getBoundingClientRect().top + 25;
            }

            const lineRect = lineEl.getBoundingClientRect();
            const codeBlock = blockEl.querySelector('.code-block');
            
            if (codeBlock) {
                const cbRect = codeBlock.getBoundingClientRect();
                // Clamp to visible area
                const y = lineRect.top + lineRect.height / 2;
                return Math.max(cbRect.top + 5, Math.min(cbRect.bottom - 5, y));
            }

            return lineRect.top + lineRect.height / 2;
        }

        isLineVisible(lineEl, blockEl) {
            if (!lineEl) return true;
            
            const codeBlock = blockEl.querySelector('.code-block');
            if (!codeBlock) return true;

            const lineRect = lineEl.getBoundingClientRect();
            const cbRect = codeBlock.getBoundingClientRect();

            const lineCenter = lineRect.top + lineRect.height / 2;
            return lineCenter >= cbRect.top && lineCenter <= cbRect.bottom;
        }

        createPath(x1, y1, x2, y2, isLeftward, type) {
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('class', 'arrow-line');

            // Calculate curve control points
            const dx = Math.abs(x2 - x1);
            const offset = Math.min(dx * 0.4, 60);

            let cp1x, cp2x;
            if (isLeftward) {
                cp1x = x1 - offset;
                cp2x = x2 + offset;
            } else {
                cp1x = x1 + offset;
                cp2x = x2 - offset;
            }

            const d = \`M \${x1} \${y1} C \${cp1x} \${y1}, \${cp2x} \${y2}, \${x2} \${y2}\`;

            // Set color based on type
            const colors = {
                'function': '#f38ba8',
                'struct': '#89dceb',
                'enum': '#a6e3a1',
                'statevar': '#fab387'
            };
            const color = colors[type] || '#888';

            // Create invisible hit area for easier hover
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitArea.setAttribute('d', d);
            hitArea.setAttribute('fill', 'none');
            hitArea.setAttribute('stroke', 'transparent');
            hitArea.setAttribute('stroke-width', '12');
            hitArea.setAttribute('class', 'arrow-hit-area');
            hitArea.style.cursor = 'pointer';

            // Create visible path
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('marker-end', \`url(#arrow-\${type})\`);
            path.setAttribute('stroke', color);
            path.setAttribute('opacity', '0.8');
            path.setAttribute('class', 'arrow-path');
            path.style.transition = 'all 0.2s ease';

            // Add hover events for glitter effect
            const applyGlitter = () => {
                path.setAttribute('filter', 'url(#glitter)');
                path.setAttribute('stroke-width', '2.5');
                path.setAttribute('opacity', '1');
                path.style.animation = 'arrowGlitter 0.6s ease-in-out infinite alternate';
            };

            const removeGlitter = () => {
                path.removeAttribute('filter');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('opacity', '0.8');
                path.style.animation = 'none';
            };

            hitArea.addEventListener('mouseenter', applyGlitter);
            hitArea.addEventListener('mouseleave', removeGlitter);
            path.addEventListener('mouseenter', applyGlitter);
            path.addEventListener('mouseleave', removeGlitter);

            group.appendChild(path);
            group.appendChild(hitArea);
            return group;
        }
    }

    // Globals
    let arrowManager = null;

    function updateAllArrows() {
        if (arrowManager) arrowManager.scheduleUpdate();
    }

    function setArrowsFromAnalysis(arrowDefs) {
        if (arrowManager) arrowManager.setArrows(arrowDefs);
    }

    document.addEventListener('DOMContentLoaded', () => {
        arrowManager = new ArrowManager();
    });
    `;
}
