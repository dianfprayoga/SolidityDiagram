import {
    ParsedFile,
    ContractInfo,
    FunctionInfo,
    ImplementationInfo,
    UsingDirective
} from '../types';

/**
 * Resolves interface-to-implementation mappings across a workspace.
 * Builds inheritance graphs and finds concrete implementations of interface methods.
 * Also handles library extension methods via 'using X for Y' directives.
 */
export class InheritanceResolver {
    // Map: contract name -> ContractInfo
    private contractMap: Map<string, ContractInfo> = new Map();
    
    // Map: contract name -> set of contracts that inherit from it
    private inheritedBy: Map<string, Set<string>> = new Map();
    
    // Map: contract name -> its full inheritance chain (linearized)
    private inheritanceChains: Map<string, string[]> = new Map();
    
    // Map: type name -> libraries attached to it (from 'using X for Y')
    private typeToLibraries: Map<string, string[]> = new Map();
    
    // Map: contract name -> its using directives (for context-aware lookup)
    private contractUsingDirectives: Map<string, UsingDirective[]> = new Map();

    /**
     * Build the inheritance graph from all parsed files in the workspace
     */
    buildInheritanceGraph(workspaceFiles: Map<string, ParsedFile>): void {
        this.contractMap.clear();
        this.inheritedBy.clear();
        this.inheritanceChains.clear();
        this.typeToLibraries.clear();
        this.contractUsingDirectives.clear();

        // First pass: collect all contracts and their using directives
        for (const [filePath, parsedFile] of workspaceFiles) {
            for (const contract of parsedFile.contracts) {
                this.contractMap.set(contract.name, contract);
                
                // Store using directives for this contract
                if (contract.usingDirectives && contract.usingDirectives.length > 0) {
                    this.contractUsingDirectives.set(contract.name, contract.usingDirectives);
                    
                    // Build type -> libraries mapping
                    for (const directive of contract.usingDirectives) {
                        const forType = directive.forType;
                        if (!this.typeToLibraries.has(forType)) {
                            this.typeToLibraries.set(forType, []);
                        }
                        if (!this.typeToLibraries.get(forType)!.includes(directive.libraryName)) {
                            this.typeToLibraries.get(forType)!.push(directive.libraryName);
                        }
                    }
                }
            }
        }

        // Second pass: build inheritance relationships
        for (const [name, contract] of this.contractMap) {
            for (const baseName of contract.baseContracts) {
                if (!this.inheritedBy.has(baseName)) {
                    this.inheritedBy.set(baseName, new Set());
                }
                this.inheritedBy.get(baseName)!.add(name);
            }
        }

        // Third pass: compute linearized inheritance chains
        for (const [name, contract] of this.contractMap) {
            this.inheritanceChains.set(name, this.computeInheritanceChain(name));
        }
    }

    /**
     * Compute the full inheritance chain for a contract (C3 linearization simplified)
     */
    private computeInheritanceChain(contractName: string, visited: Set<string> = new Set()): string[] {
        if (visited.has(contractName)) {
            return []; // Avoid cycles
        }
        visited.add(contractName);

        const chain: string[] = [contractName];
        const contract = this.contractMap.get(contractName);
        
        if (contract) {
            for (const baseName of contract.baseContracts) {
                const baseChain = this.computeInheritanceChain(baseName, new Set(visited));
                for (const name of baseChain) {
                    if (!chain.includes(name)) {
                        chain.push(name);
                    }
                }
            }
        }

        return chain;
    }

    /**
     * Find all implementations of a method from an interface/contract.
     * 
     * @param interfaceName The interface or contract name (e.g., "IERC20")
     * @param methodName The method name (e.g., "transfer")
     * @returns Array of implementations found across the workspace
     */
    findImplementations(interfaceName: string, methodName: string): ImplementationInfo[] {
        const implementations: ImplementationInfo[] = [];
        
        // Get all contracts that inherit from this interface
        const implementingContracts = this.getImplementingContracts(interfaceName);

        for (const contractName of implementingContracts) {
            const contract = this.contractMap.get(contractName);
            if (!contract) continue;

            // Skip if this is also an interface (no implementation)
            if (contract.kind === 'interface') continue;

            // Find the method implementation in this contract or its inheritance chain
            const impl = this.findMethodInContract(contractName, methodName);
            if (impl) {
                implementations.push(impl);
            }
        }

        return implementations;
    }

    /**
     * Get all contracts that implement/inherit from a given interface/contract
     */
    getImplementingContracts(interfaceName: string): string[] {
        const result = new Set<string>();
        
        const collectInheritors = (name: string) => {
            const inheritors = this.inheritedBy.get(name);
            if (inheritors) {
                for (const inheritor of inheritors) {
                    result.add(inheritor);
                    collectInheritors(inheritor); // Recursive for deep inheritance
                }
            }
        };

        collectInheritors(interfaceName);
        return Array.from(result);
    }

    /**
     * Find a method implementation in a contract, traversing its inheritance chain
     */
    private findMethodInContract(contractName: string, methodName: string): ImplementationInfo | null {
        const chain = this.inheritanceChains.get(contractName) || [contractName];
        
        for (const name of chain) {
            const contract = this.contractMap.get(name);
            if (!contract) continue;

            // Skip interfaces - we want actual implementations
            if (contract.kind === 'interface') continue;

            // Find the method in this contract
            const func = contract.functions.find(f => f.name === methodName);
            if (func && func.body && func.body.trim() !== '') {
                // Found an implementation (has a body)
                return {
                    contractName: name,
                    contractKind: contract.kind,
                    functionInfo: func,
                    filePath: contract.filePath,
                    isInherited: name !== contractName,
                    inheritanceChain: chain
                };
            }
        }

        return null;
    }

    /**
     * Find all contracts that match a function signature (for when we don't know the interface)
     */
    findContractsWithMethod(methodName: string, paramCount?: number): ImplementationInfo[] {
        const implementations: ImplementationInfo[] = [];

        for (const [name, contract] of this.contractMap) {
            // Skip interfaces
            if (contract.kind === 'interface') continue;

            for (const func of contract.functions) {
                if (func.name === methodName) {
                    // Optionally filter by parameter count
                    if (paramCount !== undefined && func.parameters.length !== paramCount) {
                        continue;
                    }

                    // Only include if it has a body (actual implementation)
                    if (func.body && func.body.trim() !== '') {
                        implementations.push({
                            contractName: name,
                            contractKind: contract.kind,
                            functionInfo: func,
                            filePath: contract.filePath,
                            isInherited: false,
                            inheritanceChain: this.inheritanceChains.get(name) || [name]
                        });
                    }
                }
            }
        }

        return implementations;
    }

    /**
     * Get the interface definition for a given interface name
     */
    getInterfaceDefinition(interfaceName: string): ContractInfo | null {
        const contract = this.contractMap.get(interfaceName);
        if (contract && contract.kind === 'interface') {
            return contract;
        }
        return null;
    }

    /**
     * Check if a contract/interface exists in the workspace
     */
    hasContract(name: string): boolean {
        return this.contractMap.has(name);
    }

    /**
     * Get a contract by name
     */
    getContract(name: string): ContractInfo | null {
        return this.contractMap.get(name) || null;
    }

    /**
     * Get all interfaces in the workspace
     */
    getAllInterfaces(): ContractInfo[] {
        const interfaces: ContractInfo[] = [];
        for (const contract of this.contractMap.values()) {
            if (contract.kind === 'interface') {
                interfaces.push(contract);
            }
        }
        return interfaces;
    }

    /**
     * Get all concrete contracts (not interfaces) in the workspace
     */
    getAllConcreteContracts(): ContractInfo[] {
        const contracts: ContractInfo[] = [];
        for (const contract of this.contractMap.values()) {
            if (contract.kind !== 'interface') {
                contracts.push(contract);
            }
        }
        return contracts;
    }

    /**
     * Find library methods that extend a given type.
     * This handles the 'using SafeERC20 for IERC20' pattern.
     * 
     * @param typeName The type being extended (e.g., "IERC20")
     * @param methodName The method name (e.g., "safeApprove")
     * @param contextContract Optional: the contract where the call is made (for context-aware lookup)
     * @returns Array of library implementations
     */
    findLibraryMethods(typeName: string, methodName: string, contextContract?: string): ImplementationInfo[] {
        const implementations: ImplementationInfo[] = [];
        
        // Get libraries attached to this type
        let librariesToSearch: string[] = [];
        
        // First check context-specific using directives
        if (contextContract) {
            const directives = this.contractUsingDirectives.get(contextContract);
            if (directives) {
                for (const directive of directives) {
                    if (directive.forType === typeName || directive.forType === '*') {
                        librariesToSearch.push(directive.libraryName);
                    }
                }
            }
        }
        
        // Also check global type -> library mapping
        const globalLibraries = this.typeToLibraries.get(typeName) || [];
        for (const lib of globalLibraries) {
            if (!librariesToSearch.includes(lib)) {
                librariesToSearch.push(lib);
            }
        }
        
        // Also check libraries attached to '*' (all types)
        const wildcardLibraries = this.typeToLibraries.get('*') || [];
        for (const lib of wildcardLibraries) {
            if (!librariesToSearch.includes(lib)) {
                librariesToSearch.push(lib);
            }
        }
        
        // Search for the method in each library
        for (const libraryName of librariesToSearch) {
            const library = this.contractMap.get(libraryName);
            if (!library || library.kind !== 'library') continue;
            
            // Find the method in this library
            const func = library.functions.find(f => f.name === methodName);
            if (func && func.body && func.body.trim() !== '') {
                implementations.push({
                    contractName: libraryName,
                    contractKind: 'library',
                    functionInfo: func,
                    filePath: library.filePath,
                    isInherited: false,
                    inheritanceChain: [libraryName]
                });
            }
        }
        
        return implementations;
    }

    /**
     * Find implementations for an interface call, checking both:
     * 1. Contracts implementing the interface
     * 2. Library extension methods via 'using X for Y'
     * 
     * @param interfaceName The interface name (e.g., "IERC20")
     * @param methodName The method name (e.g., "safeApprove" or "approve")
     * @param contextContract Optional: the contract where the call is made
     * @returns Array of all implementations (interface implementations + library methods)
     */
    findAllImplementations(interfaceName: string, methodName: string, contextContract?: string): ImplementationInfo[] {
        const implementations: ImplementationInfo[] = [];
        
        // First, check for library extension methods (like SafeERC20.safeApprove)
        const libraryImpls = this.findLibraryMethods(interfaceName, methodName, contextContract);
        implementations.push(...libraryImpls);
        
        // Then, check for interface implementations (contracts that implement the interface)
        const interfaceImpls = this.findImplementations(interfaceName, methodName);
        implementations.push(...interfaceImpls);
        
        // If still nothing found, try a general search
        if (implementations.length === 0) {
            const generalImpls = this.findContractsWithMethod(methodName);
            implementations.push(...generalImpls);
        }
        
        return implementations;
    }

    /**
     * Get all libraries that extend a given type
     */
    getLibrariesForType(typeName: string): string[] {
        return this.typeToLibraries.get(typeName) || [];
    }

    /**
     * Get all libraries in the workspace
     */
    getAllLibraries(): ContractInfo[] {
        const libraries: ContractInfo[] = [];
        for (const contract of this.contractMap.values()) {
            if (contract.kind === 'library') {
                libraries.push(contract);
            }
        }
        return libraries;
    }

    /**
     * Debug: Print the inheritance graph
     */
    debugPrint(): void {
        console.log('=== Contract Map ===');
        for (const [name, contract] of this.contractMap) {
            console.log(`${name} (${contract.kind}): inherits [${contract.baseContracts.join(', ')}]`);
        }
        
        console.log('\n=== Inherited By ===');
        for (const [name, inheritors] of this.inheritedBy) {
            console.log(`${name}: inherited by [${Array.from(inheritors).join(', ')}]`);
        }

        console.log('\n=== Inheritance Chains ===');
        for (const [name, chain] of this.inheritanceChains) {
            console.log(`${name}: ${chain.join(' -> ')}`);
        }
        
        console.log('\n=== Type to Libraries ===');
        for (const [type, libraries] of this.typeToLibraries) {
            console.log(`${type}: [${libraries.join(', ')}]`);
        }
    }
}
