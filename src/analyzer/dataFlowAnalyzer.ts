import {
    FunctionInfo,
    DataFlowGraph,
    DataFlowNode,
    DataFlowEdge,
    SinkInfo,
    ParameterInfo
} from '../types';

/**
 * Analyzes data flow within a Solidity function.
 * Tracks variable definitions, uses, and how data flows to sinks
 * (external calls, state writes, returns).
 */
export class DataFlowAnalyzer {
    // DeFi-specific patterns for detecting token amounts
    private readonly AMOUNT_PATTERNS = /^(amount|value|qty|quantity|balance|shares|tokens?|assets?|debt|collateral|principal|interest|fee|reward|price|rate|liquidity|reserve|supply|borrow|lend|stake|deposit|withdraw|repay|claim|earned|accrued|owed|due|delta|diff|change|input|output|in|out)_?[0-9]*$/i;
    
    // Patterns for address variables that might be call targets
    private readonly ADDRESS_PATTERNS = /^(to|from|recipient|sender|target|dest|destination|owner|spender|operator|pool|vault|token|contract|router|factory|pair|oracle|controller|manager|registry|adapter|strategy|gauge|staker|delegatee|borrower|lender|liquidator|receiver)_?[0-9]*$/i;
    
    // Patterns for identifying price/oracle related values (potential manipulation)
    private readonly PRICE_ORACLE_PATTERNS = /^(price|rate|oracle|twap|spot|quote|exchange|conversion|ratio|multiplier|mantissa|scale|factor)_?[0-9]*$/i;
    
    // Patterns for slippage/deadline protection
    private readonly SLIPPAGE_PATTERNS = /^(min|max|deadline|expiry|timeout|slippage|tolerance|threshold|limit|floor|ceiling|cap)_?[0-9]*$/i;
    
    // State-modifying patterns
    private readonly STATE_WRITE_PATTERNS = [
        /(\w+)\s*\[\s*[^\]]+\s*\]\s*[+\-*\/]?=/,  // mapping[key] = value
        /(\w+)\s*[+\-*\/]?=/,                       // stateVar = value
        /(\w+)\s*\+\+/,                             // stateVar++
        /(\w+)\s*--/,                               // stateVar--
    ];

    // External call patterns (expanded for DeFi)
    private readonly EXTERNAL_CALL_PATTERNS = [
        /\.transfer\s*\(/,
        /\.send\s*\(/,
        /\.call\s*[{(]/,
        /\.delegatecall\s*\(/,
        /\.staticcall\s*\(/,
        /\.safeTransfer\s*\(/,
        /\.safeTransferFrom\s*\(/,
        /\.safeApprove\s*\(/,
        /\.approve\s*\(/,
        /\.transferFrom\s*\(/,
        /\.mint\s*\(/,
        /\.burn\s*\(/,
        /\.deposit\s*\(/,
        /\.withdraw\s*\(/,
        /\.borrow\s*\(/,
        /\.repay\s*\(/,
        /\.swap\s*\(/,
        /\.flash\w*\s*\(/,
        /\.liquidate\s*\(/,
        /\.stake\s*\(/,
        /\.unstake\s*\(/,
        /\.claim\s*\(/,
        /\.harvest\s*\(/,
        /\.compound\s*\(/,
        /\.redeem\s*\(/,
        /\.supply\s*\(/,
        /\.getReward\s*\(/,
        /\.execute\s*\(/,
        /\.multicall\s*\(/,
        /\.exactInput\s*\(/,
        /\.exactOutput\s*\(/,
        /\.addLiquidity\s*\(/,
        /\.removeLiquidity\s*\(/,
    ];

    // Reentrancy-prone patterns (external calls before state updates)
    private readonly REENTRANCY_CALL_PATTERNS = [
        /\.call\s*[{(]/,
        /\.transfer\s*\(/,
        /\.send\s*\(/,
        /\.safeTransfer\s*\(/,
        /\.safeTransferFrom\s*\(/,
    ];

    // Balance check patterns (for flash loan detection)
    private readonly BALANCE_CHECK_PATTERNS = [
        /balanceOf\s*\(/,
        /\.balance\b/,
        /getBalance\s*\(/,
        /totalSupply\s*\(/,
        /getReserves\s*\(/,
    ];

    /**
     * Analyze data flow in a function
     */
    analyze(functionInfo: FunctionInfo, stateVariables: Set<string> = new Set()): DataFlowGraph {
        const nodes: DataFlowNode[] = [];
        const edges: DataFlowEdge[] = [];
        const sinks: SinkInfo[] = [];
        const definitions = new Map<string, DataFlowNode[]>();
        const uses = new Map<string, DataFlowNode[]>();

        const lines = functionInfo.fullSource.split('\n');
        const startLine = functionInfo.location.start.line;

        // 1. Extract parameter definitions
        this.extractParameterDefinitions(functionInfo.parameters, startLine, nodes, definitions);

        // 2. Parse each line for variable declarations, assignments, and uses
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = startLine + i;

            // Extract local variable declarations
            this.extractLocalDeclarations(line, lineNum, nodes, definitions, stateVariables);

            // Extract assignments (data flow edges)
            this.extractAssignments(line, lineNum, nodes, edges, definitions, uses, stateVariables);

            // Extract variable uses
            this.extractUses(line, lineNum, nodes, uses, definitions, stateVariables);

            // Extract sinks (external calls, state writes, returns)
            this.extractSinks(line, lineNum, sinks, stateVariables);
        }

        // 3. Build edges from definitions to uses
        this.buildFlowEdges(edges, definitions, uses);

        return {
            nodes,
            edges,
            sinks,
            definitions,
            uses
        };
    }

    /**
     * Extract parameter definitions as the initial data flow sources
     */
    private extractParameterDefinitions(
        parameters: ParameterInfo[],
        startLine: number,
        nodes: DataFlowNode[],
        definitions: Map<string, DataFlowNode[]>
    ): void {
        for (const param of parameters) {
            if (!param.name) continue;

            const node: DataFlowNode = {
                varName: param.name,
                kind: 'parameter',
                line: startLine,
                column: 0,
                isDefinition: true,
                typeName: param.typeName,
                defiTag: this.inferDefiTag(param.name, param.typeName)
            };

            nodes.push(node);
            
            if (!definitions.has(param.name)) {
                definitions.set(param.name, []);
            }
            definitions.get(param.name)!.push(node);
        }
    }

    /**
     * Extract local variable declarations
     */
    private extractLocalDeclarations(
        line: string,
        lineNum: number,
        nodes: DataFlowNode[],
        definitions: Map<string, DataFlowNode[]>,
        stateVariables: Set<string>
    ): void {
        // Pattern: TypeName (memory|storage|calldata)? varName
        // Also handle: (TypeName varName, TypeName varName2) = ...
        
        // Simple declaration pattern
        const declPattern = /\b(uint\d*|int\d*|address|bool|bytes\d*|string|mapping\([^)]+\)|[A-Z][a-zA-Z0-9_]*)\s+(?:memory\s+|storage\s+|calldata\s+)?([a-z_][a-zA-Z0-9_]*)\s*[=;,)]/g;
        
        let match;
        while ((match = declPattern.exec(line)) !== null) {
            const typeName = match[1];
            const varName = match[2];
            const column = match.index;

            // Skip if it's a state variable (those are read, not declared locally)
            if (stateVariables.has(varName)) continue;

            const node: DataFlowNode = {
                varName,
                kind: 'local',
                line: lineNum,
                column,
                isDefinition: true,
                typeName,
                defiTag: this.inferDefiTag(varName, typeName)
            };

            nodes.push(node);

            if (!definitions.has(varName)) {
                definitions.set(varName, []);
            }
            definitions.get(varName)!.push(node);
        }

        // Handle tuple unpacking: (varA, varB) = someCall()
        const tuplePattern = /\(\s*([^)]+)\s*\)\s*=/;
        const tupleMatch = line.match(tuplePattern);
        if (tupleMatch) {
            const tupleVars = tupleMatch[1].split(',').map(v => v.trim());
            for (const varDecl of tupleVars) {
                // Could be "Type varName" or just "varName" or empty
                const parts = varDecl.split(/\s+/);
                const varName = parts[parts.length - 1];
                if (varName && /^[a-z_][a-zA-Z0-9_]*$/.test(varName) && !stateVariables.has(varName)) {
                    const node: DataFlowNode = {
                        varName,
                        kind: 'local',
                        line: lineNum,
                        column: line.indexOf(varName),
                        isDefinition: true,
                        defiTag: this.inferDefiTag(varName, parts.length > 1 ? parts[0] : undefined)
                    };
                    nodes.push(node);

                    if (!definitions.has(varName)) {
                        definitions.set(varName, []);
                    }
                    definitions.get(varName)!.push(node);
                }
            }
        }
    }

    /**
     * Extract assignments and create data flow edges
     */
    private extractAssignments(
        line: string,
        lineNum: number,
        nodes: DataFlowNode[],
        edges: DataFlowEdge[],
        definitions: Map<string, DataFlowNode[]>,
        uses: Map<string, DataFlowNode[]>,
        stateVariables: Set<string>
    ): void {
        // Pattern: varName = expression
        const assignPattern = /\b([a-z_][a-zA-Z0-9_]*)\s*([+\-*\/])?=\s*([^;]+)/g;
        
        let match;
        while ((match = assignPattern.exec(line)) !== null) {
            const targetVar = match[1];
            const operator = match[2] || '';
            const expression = match[3];
            const column = match.index;

            // Determine if this is a state write
            const isStateWrite = stateVariables.has(targetVar);

            // Create a definition node for the target
            const targetNode: DataFlowNode = {
                varName: targetVar,
                kind: isStateWrite ? 'state' : 'local',
                line: lineNum,
                column,
                isDefinition: true,
                defiTag: this.inferDefiTag(targetVar)
            };

            // Only add to nodes if it's a new definition in the function
            if (!isStateWrite) {
                // Check if we already have this as a definition, if so this is a reassignment
                const existingDefs = definitions.get(targetVar);
                if (!existingDefs || existingDefs.length === 0) {
                    nodes.push(targetNode);
                    if (!definitions.has(targetVar)) {
                        definitions.set(targetVar, []);
                    }
                    definitions.get(targetVar)!.push(targetNode);
                }
            }

            // Extract variables from the RHS expression
            const rhsVars = this.extractVariablesFromExpression(expression);
            for (const sourceVar of rhsVars) {
                // Skip if the source is a function call (handle separately)
                if (expression.includes(`${sourceVar}(`)) continue;

                const sourceDefs = definitions.get(sourceVar);
                if (sourceDefs && sourceDefs.length > 0) {
                    // Create edge from last definition to this use
                    const sourceNode = sourceDefs[sourceDefs.length - 1];
                    const edgeType = isStateWrite ? 'state-write' : 'assign';
                    
                    edges.push({
                        from: sourceNode,
                        to: targetNode,
                        edgeType,
                        transformation: operator ? `${operator}=` : undefined
                    });
                }
            }
        }

        // Handle mapping/array writes: mapping[key] = value
        const mappingWritePattern = /\b([a-z_][a-zA-Z0-9_]*)\s*\[[^\]]+\]\s*[+\-*\/]?=/g;
        while ((match = mappingWritePattern.exec(line)) !== null) {
            const stateVar = match[1];
            if (stateVariables.has(stateVar)) {
                // This is a state write
                const targetNode: DataFlowNode = {
                    varName: stateVar,
                    kind: 'state',
                    line: lineNum,
                    column: match.index,
                    isDefinition: true
                };
                nodes.push(targetNode);
            }
        }
    }

    /**
     * Extract variable uses (reads)
     */
    private extractUses(
        line: string,
        lineNum: number,
        nodes: DataFlowNode[],
        uses: Map<string, DataFlowNode[]>,
        definitions: Map<string, DataFlowNode[]>,
        stateVariables: Set<string>
    ): void {
        // Extract all identifiers that look like variable uses
        const identifierPattern = /\b([a-z_][a-zA-Z0-9_]*)\b/g;
        
        // Skip these keywords/built-ins
        const skipWords = new Set([
            'if', 'else', 'for', 'while', 'do', 'return', 'require', 'assert', 'revert',
            'emit', 'new', 'delete', 'true', 'false', 'this', 'super',
            'memory', 'storage', 'calldata', 'public', 'private', 'internal', 'external',
            'pure', 'view', 'payable', 'virtual', 'override', 'indexed',
            'abi', 'block', 'tx', 'gasleft', 'blockhash', 'type'
        ]);

        let match;
        const seenOnLine = new Set<string>();
        
        while ((match = identifierPattern.exec(line)) !== null) {
            const varName = match[1];
            const column = match.index;

            // Skip keywords and duplicates on the same line
            if (skipWords.has(varName) || seenOnLine.has(varName)) continue;
            seenOnLine.add(varName);

            // Check if this is a known variable (defined or state)
            const isDefined = definitions.has(varName);
            const isState = stateVariables.has(varName);

            if (isDefined || isState) {
                // Check if this is a use (not a definition position)
                // Simple heuristic: if it's not immediately followed by '=' (assignment)
                const restOfLine = line.substring(column + varName.length);
                const isDefinitionContext = /^\s*[+\-*\/]?=(?!=)/.test(restOfLine);
                
                if (!isDefinitionContext) {
                    const node: DataFlowNode = {
                        varName,
                        kind: isState ? 'state' : (definitions.get(varName)?.[0]?.kind || 'local'),
                        line: lineNum,
                        column,
                        isDefinition: false,
                        defiTag: this.inferDefiTag(varName)
                    };

                    nodes.push(node);

                    if (!uses.has(varName)) {
                        uses.set(varName, []);
                    }
                    uses.get(varName)!.push(node);
                }
            }
        }

        // Handle msg.value, msg.sender, block.timestamp, etc.
        this.extractSpecialGlobals(line, lineNum, nodes, uses);
    }

    /**
     * Extract special global variables (msg.value, msg.sender, etc.)
     */
    private extractSpecialGlobals(
        line: string,
        lineNum: number,
        nodes: DataFlowNode[],
        uses: Map<string, DataFlowNode[]>
    ): void {
        const globals = [
            { pattern: /msg\.value/g, name: 'msg.value', kind: 'msg' as const, defiTag: 'msg-value' as const },
            { pattern: /msg\.sender/g, name: 'msg.sender', kind: 'msg' as const, defiTag: 'msg-sender' as const },
            { pattern: /msg\.data/g, name: 'msg.data', kind: 'msg' as const },
            { pattern: /block\.timestamp/g, name: 'block.timestamp', kind: 'block' as const },
            { pattern: /block\.number/g, name: 'block.number', kind: 'block' as const },
            { pattern: /tx\.origin/g, name: 'tx.origin', kind: 'tx' as const },
            { pattern: /tx\.gasprice/g, name: 'tx.gasprice', kind: 'tx' as const },
        ];

        for (const { pattern, name, kind, defiTag } of globals) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
                const node: DataFlowNode = {
                    varName: name,
                    kind,
                    line: lineNum,
                    column: match.index,
                    isDefinition: false,
                    defiTag
                };
                nodes.push(node);

                if (!uses.has(name)) {
                    uses.set(name, []);
                }
                uses.get(name)!.push(node);
            }
        }
    }

    /**
     * Extract sinks (external calls, state writes, returns, events)
     */
    private extractSinks(
        line: string,
        lineNum: number,
        sinks: SinkInfo[],
        stateVariables: Set<string>
    ): void {
        // Check for external calls
        for (const pattern of this.EXTERNAL_CALL_PATTERNS) {
            if (pattern.test(line)) {
                const inputVars = this.extractVariablesFromExpression(line);
                const callTargetMatch = line.match(/\b([a-z_][a-zA-Z0-9_]*)\.(?:transfer|send|call|safeTransfer|approve)/);
                
                sinks.push({
                    kind: 'external-call',
                    line: lineNum,
                    column: 0,
                    description: line.trim(),
                    inputVars,
                    callTarget: callTargetMatch?.[1]
                });
                break; // Only add one sink per line for external calls
            }
        }

        // Check for return statements
        const returnMatch = line.match(/\breturn\s+([^;]+)/);
        if (returnMatch) {
            const inputVars = this.extractVariablesFromExpression(returnMatch[1]);
            sinks.push({
                kind: 'return',
                line: lineNum,
                column: line.indexOf('return'),
                description: `return ${returnMatch[1].trim()}`,
                inputVars
            });
        }

        // Check for emit statements (events)
        const emitMatch = line.match(/\bemit\s+([A-Z][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
        if (emitMatch) {
            const inputVars = this.extractVariablesFromExpression(emitMatch[2]);
            sinks.push({
                kind: 'event-emit',
                line: lineNum,
                column: line.indexOf('emit'),
                description: `emit ${emitMatch[1]}(...)`,
                inputVars
            });
        }

        // Check for state writes
        for (const stateVar of stateVariables) {
            // Check for direct assignment
            const directAssign = new RegExp(`\\b${stateVar}\\s*[+\\-*\\/]?=`);
            if (directAssign.test(line)) {
                const inputVars = this.extractVariablesFromExpression(line);
                sinks.push({
                    kind: 'state-write',
                    line: lineNum,
                    column: line.indexOf(stateVar),
                    description: `${stateVar} = ...`,
                    inputVars: inputVars.filter(v => v !== stateVar)
                });
            }

            // Check for mapping/array write
            const mappingWrite = new RegExp(`\\b${stateVar}\\s*\\[[^\\]]+\\]\\s*[+\\-*\\/]?=`);
            if (mappingWrite.test(line)) {
                const inputVars = this.extractVariablesFromExpression(line);
                sinks.push({
                    kind: 'state-write',
                    line: lineNum,
                    column: line.indexOf(stateVar),
                    description: `${stateVar}[...] = ...`,
                    inputVars: inputVars.filter(v => v !== stateVar)
                });
            }
        }
    }

    /**
     * Build flow edges from definitions to uses
     */
    private buildFlowEdges(
        edges: DataFlowEdge[],
        definitions: Map<string, DataFlowNode[]>,
        uses: Map<string, DataFlowNode[]>
    ): void {
        for (const [varName, useNodes] of uses) {
            const defNodes = definitions.get(varName);
            if (!defNodes || defNodes.length === 0) continue;

            for (const useNode of useNodes) {
                // Find the most recent definition before this use
                let mostRecentDef: DataFlowNode | null = null;
                for (const defNode of defNodes) {
                    if (defNode.line <= useNode.line) {
                        if (!mostRecentDef || defNode.line > mostRecentDef.line) {
                            mostRecentDef = defNode;
                        }
                    }
                }

                if (mostRecentDef) {
                    edges.push({
                        from: mostRecentDef,
                        to: useNode,
                        edgeType: 'use'
                    });
                }
            }
        }
    }

    /**
     * Extract variable names from an expression
     */
    private extractVariablesFromExpression(expression: string): string[] {
        const vars: string[] = [];
        const pattern = /\b([a-z_][a-zA-Z0-9_]*)\b/g;
        
        const skipWords = new Set([
            'if', 'else', 'for', 'while', 'do', 'return', 'require', 'assert', 'revert',
            'emit', 'new', 'delete', 'true', 'false', 'this', 'super',
            'memory', 'storage', 'calldata', 'public', 'private', 'internal', 'external',
            'pure', 'view', 'payable', 'abi', 'type', 'msg', 'block', 'tx'
        ]);

        let match;
        while ((match = pattern.exec(expression)) !== null) {
            const varName = match[1];
            if (!skipWords.has(varName) && !vars.includes(varName)) {
                vars.push(varName);
            }
        }

        return vars;
    }

    /**
     * Infer DeFi-specific tag for a variable based on name and type
     */
    private inferDefiTag(varName: string, typeName?: string): DataFlowNode['defiTag'] {
        // Check for msg.value/sender
        if (varName === 'msg.value') return 'msg-value';
        if (varName === 'msg.sender') return 'msg-sender';

        // Check for balance-related first (more specific)
        if (/balance/i.test(varName)) {
            return 'balance';
        }

        // Check for amount-like names
        if (this.AMOUNT_PATTERNS.test(varName)) {
            return 'token-amount';
        }

        // Check for address-like names that might be call targets
        if (this.ADDRESS_PATTERNS.test(varName) || typeName === 'address') {
            return 'address-target';
        }

        return undefined;
    }

    /**
     * Detect potential reentrancy patterns in a function.
     * Returns lines where external calls occur before state updates.
     */
    detectReentrancyPatterns(
        functionInfo: FunctionInfo,
        stateVariables: Set<string>
    ): { callLine: number; stateWriteLine: number; stateVar: string }[] {
        const patterns: { callLine: number; stateWriteLine: number; stateVar: string }[] = [];
        const lines = functionInfo.fullSource.split('\n');
        const startLine = functionInfo.location.start.line;

        // Track external call lines
        const externalCallLines: number[] = [];
        
        // Track state write lines with their variables
        const stateWriteLines: { line: number; varName: string }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = startLine + i;

            // Check for reentrancy-prone external calls
            for (const pattern of this.REENTRANCY_CALL_PATTERNS) {
                if (pattern.test(line)) {
                    externalCallLines.push(lineNum);
                    break;
                }
            }

            // Check for state writes
            for (const stateVar of stateVariables) {
                const directAssign = new RegExp(`\\b${stateVar}\\s*[+\\-*\\/]?=`);
                const mappingWrite = new RegExp(`\\b${stateVar}\\s*\\[[^\\]]+\\]\\s*[+\\-*\\/]?=`);
                
                if (directAssign.test(line) || mappingWrite.test(line)) {
                    stateWriteLines.push({ line: lineNum, varName: stateVar });
                }
            }
        }

        // Find patterns where external call comes before state write
        for (const callLine of externalCallLines) {
            for (const { line: writeLine, varName } of stateWriteLines) {
                if (writeLine > callLine) {
                    patterns.push({
                        callLine,
                        stateWriteLine: writeLine,
                        stateVar: varName
                    });
                }
            }
        }

        return patterns;
    }

    /**
     * Detect balance check patterns that might indicate flash loan usage
     */
    detectBalanceCheckPatterns(functionInfo: FunctionInfo): { line: number; pattern: string }[] {
        const patterns: { line: number; pattern: string }[] = [];
        const lines = functionInfo.fullSource.split('\n');
        const startLine = functionInfo.location.start.line;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = startLine + i;

            for (const pattern of this.BALANCE_CHECK_PATTERNS) {
                if (pattern.test(line)) {
                    patterns.push({
                        line: lineNum,
                        pattern: line.trim()
                    });
                    break;
                }
            }
        }

        return patterns;
    }

    /**
     * Get summary of DeFi-relevant data flows
     */
    getDefiFlowSummary(graph: DataFlowGraph): {
        tokenAmounts: DataFlowNode[];
        addresses: DataFlowNode[];
        msgValue: DataFlowNode[];
        msgSender: DataFlowNode[];
        balanceChecks: DataFlowNode[];
        externalCalls: SinkInfo[];
        stateWrites: SinkInfo[];
    } {
        const tokenAmounts: DataFlowNode[] = [];
        const addresses: DataFlowNode[] = [];
        const msgValue: DataFlowNode[] = [];
        const msgSender: DataFlowNode[] = [];
        const balanceChecks: DataFlowNode[] = [];

        for (const node of graph.nodes) {
            switch (node.defiTag) {
                case 'token-amount':
                    tokenAmounts.push(node);
                    break;
                case 'address-target':
                    addresses.push(node);
                    break;
                case 'msg-value':
                    msgValue.push(node);
                    break;
                case 'msg-sender':
                    msgSender.push(node);
                    break;
                case 'balance':
                    balanceChecks.push(node);
                    break;
            }
        }

        const externalCalls = graph.sinks.filter(s => s.kind === 'external-call');
        const stateWrites = graph.sinks.filter(s => s.kind === 'state-write');

        return {
            tokenAmounts,
            addresses,
            msgValue,
            msgSender,
            balanceChecks,
            externalCalls,
            stateWrites
        };
    }

    /**
     * Get all variables that flow to a specific sink
     */
    getVariablesFlowingToSink(graph: DataFlowGraph, sink: SinkInfo): string[] {
        const result = new Set<string>();
        
        // Start with direct inputs
        for (const varName of sink.inputVars) {
            result.add(varName);
            
            // Trace back through edges to find all sources
            this.traceBackward(graph, varName, result);
        }

        return Array.from(result);
    }

    /**
     * Trace backward through the data flow graph
     */
    private traceBackward(graph: DataFlowGraph, varName: string, visited: Set<string>): void {
        for (const edge of graph.edges) {
            if (edge.to.varName === varName && !visited.has(edge.from.varName)) {
                visited.add(edge.from.varName);
                this.traceBackward(graph, edge.from.varName, visited);
            }
        }
    }

    /**
     * Get all locations where a variable flows to (forward analysis)
     */
    getVariableFlowTargets(graph: DataFlowGraph, varName: string): DataFlowNode[] {
        const targets: DataFlowNode[] = [];
        const visited = new Set<string>();
        
        this.traceForward(graph, varName, targets, visited);
        
        return targets;
    }

    /**
     * Trace forward through the data flow graph
     */
    private traceForward(
        graph: DataFlowGraph, 
        varName: string, 
        targets: DataFlowNode[], 
        visited: Set<string>
    ): void {
        if (visited.has(varName)) return;
        visited.add(varName);

        for (const edge of graph.edges) {
            if (edge.from.varName === varName) {
                targets.push(edge.to);
                if (edge.to.varName !== varName) {
                    this.traceForward(graph, edge.to.varName, targets, visited);
                }
            }
        }
    }

    /**
     * Serialize DataFlowGraph for passing to webview (Maps can't be serialized)
     */
    serializeGraph(graph: DataFlowGraph): {
        nodes: DataFlowNode[];
        edges: DataFlowEdge[];
        sinks: SinkInfo[];
        definitions: [string, DataFlowNode[]][];
        uses: [string, DataFlowNode[]][];
    } {
        return {
            nodes: graph.nodes,
            edges: graph.edges,
            sinks: graph.sinks,
            definitions: Array.from(graph.definitions.entries()),
            uses: Array.from(graph.uses.entries())
        };
    }
}
