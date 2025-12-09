// ... existing code ...

    /**
     * Uses AI to determine split points based on line numbers
     * @param {string} code 
     * @param {string} type 'css' or 'js'
     * @returns {Promise<Array>} Array of {name, content}
     */
    async performAiSplit(code, type) {
        // 1. Prepare code with line numbers for the AI
        const lines = code.split('\\n');
        const numberedCode = lines.map((line, idx) => `${idx + 1}| ${line}`).join('\\n');
        
        // Truncate if too huge (safety limit for demo)
        const safeCode = numberedCode.length > 50000 ? numberedCode.substring(0, 50000) + "\\n... (truncated)" : numberedCode;

        const systemPrompt = `You are a code refactoring engine. 
        Your goal is to split a monolithic ${type.toUpperCase()} file into logical, modular component files.
        Return a JSON object containing a "files" array.
        Each item in "files" must have:
        - "name": filename (e.g., 'header.css', 'utils.js')
        - "startLine": integer (inclusive 1-based index)
        - "endLine": integer (inclusive 1-based index)
        
        CRITICAL RULES:
        1. COVERAGE: Every single line of code must be included. No gaps.
        2. SYNTAX SAFETY: Do NOT split inside a function, class, or CSS block. Only split at the top-level (between blocks).
        3. ORDER: Maintain the original execution order.
        4. Sort the output by startLine.
        `;

        try {
            const completion = await websim.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Here is the code with line numbers:\\n\\n${safeCode}` }
                ],
                json: true
            });

            const result = JSON.parse(completion.content);
            
            if (!result.files || !Array.isArray(result.files)) {
                throw new Error("Invalid AI response structure");
            }

            // 2. Validate and Repair Splits (Self-Correction Logic)
            this.log('Verifying split integrity...', 'info');
            const verifiedFiles = this.validateAndRepairSplits(lines, result.files, type);

            return verifiedFiles;

        } catch (e) {
            this.log(`AI Split Failed: ${e.message}. Falling back to single file.`, 'error');
            return [{ 
                name: type === 'css' ? 'style.css' : 'app.js', 
                content: code 
            }];
        }
    }

    /**
     * Validates coverage and syntax balance, merging chunks if necessary.
     */
    validateAndRepairSplits(allLines, fileDefs, type) {
        const outputFiles = [];
        const totalLines = allLines.length;

        // Sort by start line just in case
        fileDefs.sort((a, b) => a.startLine - b.startLine);

        // 1. Coverage Check & Gap Filling
        let currentLine = 1;
        const continuousDefs = [];

        for (const def of fileDefs) {
            // Fill gap before this file
            if (def.startLine > currentLine) {
                continuousDefs.push({
                    name: `fragment-${currentLine}.` + (type === 'css' ? 'css' : 'js'),
                    startLine: currentLine,
                    endLine: def.startLine - 1
                });
                this.log(`Warning: Gap detected. Created fragment to bridge lines ${currentLine}-${def.startLine - 1}.`, 'warning');
            }
            
            // Adjust overlap
            if (def.startLine < currentLine) {
                def.startLine = currentLine;
            }

            if (def.endLine >= def.startLine) {
                continuousDefs.push(def);
                currentLine = def.endLine + 1;
            }
        }

        // Fill gap at the end
        if (currentLine <= totalLines) {
            continuousDefs.push({
                name: `end-fragment.` + (type === 'css' ? 'css' : 'js'),
                startLine: currentLine,
                endLine: totalLines
            });
        }

        // 2. Syntax Balance Check (JS Only) & Merge
        // We merge chunks until braces match to prevent splitting inside functions
        if (type === 'js') {
            let bufferDef = null;
            let bufferContent = '';
            let openBraces = 0;

            for (const def of continuousDefs) {
                // Extract content
                const start = def.startLine - 1;
                const end = def.endLine;
                const content = allLines.slice(start, end).join('\\n');

                // Simple brace counting (ignores strings/comments for speed, but usually sufficient for major blocks)
                const opens = (content.match(/\\{/g) || []).length;
                const closes = (content.match(/\\}/g) || []).length;
                const netChange = opens - closes;

                if (bufferDef) {
                    // We are in a merge state
                    bufferContent += '\\n' + content;
                    openBraces += netChange;
                    
                    // Extend the buffer definition
                    bufferDef.endLine = def.endLine; 
                    // Update name to reflect merge if it gets too long? No, keep first name.

                    if (openBraces === 0) {
                        // Balanced! Push it.
                        outputFiles.push({
                            name: bufferDef.name,
                            content: bufferContent
                        });
                        bufferDef = null;
                        bufferContent = '';
                    }
                } else {
                    if (netChange !== 0) {
                        // Unbalanced start, begin buffering
                        bufferDef = def;
                        bufferContent = content;
                        openBraces = netChange;
                    } else {
                        // Balanced immediately
                        outputFiles.push({ name: def.name, content });
                    }
                }
            }

            // If we have leftovers in buffer (still unbalanced at EOF), push it
            if (bufferDef) {
                this.log(`Warning: EOF reached with unbalanced braces in ${bufferDef.name}. Merging remaining.`, 'warning');
                outputFiles.push({
                    name: bufferDef.name,
                    content: bufferContent
                });
            }

        } else {
            // CSS: Just map directly, CSS brace issues are less fatal usually (and harder to regex simply due to media queries nested)
            // But we can do the same logic if needed. For now, trust the coverage.
            continuousDefs.forEach(def => {
                outputFiles.push({
                    name: def.name,
                    content: allLines.slice(def.startLine - 1, def.endLine).join('\\n')
                });
            });
        }

        return outputFiles;
    }

    /**
     * Check if code looks like an ES Module
     */
    isEsModule(content) {
        return /^\\s*(import|export)\\s+/m.test(content);
    }
// ... existing code ...

                const splitFiles = await this.performAiSplit(mergedJsContent, 'js');
                
                // Remove all original scripts
                executableScripts.forEach(s => s.remove());
                
                // Add new scripts
                splitFiles.forEach(f => {
                    files.push(f);
                    const script = doc.createElement('script');
                    script.src = f.name;
                    
                    // Intelligent Module Detection
                    if (this.isEsModule(f.content)) {
                        script.type = 'module';
                    }

                    doc.body.appendChild(script);
                    this.log(`AI Created: ${f.name}`, 'success');
                });
                
            } else if (mergeJs) {
// ... existing code ...
