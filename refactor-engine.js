/**
 * RefactorEngine
 * Core logic for parsing HTML and extracting resources.
 */
export class RefactorEngine {
    constructor(logger) {
        this.logger = logger || console.log;
    }

    /**
     * Helper to log messages through the UI callback
     */
    log(message, type = 'info') {
        if (typeof this.logger === 'function') {
            this.logger({ message, type });
        }
    }

    /**
     * Main process method
     * @param {string} htmlString - The raw HTML content
     * @param {object} options - Configuration options
     * @returns {object} { html, files: [{name, content}] }
     */
    process(htmlString, options) {
        const { mergeCss, mergeJs, extremeMode } = options;

        this.log('Initializing DOMParser...', 'info');
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        // Error Check: Does it have a body?
        if (!doc.body) {
            throw new Error("Invalid HTML: No <body> tag found.");
        }

        const files = [];
        let cssCounter = 1;
        let jsCounter = 1;

        // --- CSS EXTRACTION ---
        this.log('Scanning for <style> tags...', 'info');
        const styleTags = Array.from(doc.querySelectorAll('style'));
        let mergedCssContent = '';

        if (styleTags.length > 0) {
            this.log(`Found ${styleTags.length} style blocks.`, 'info');

            styleTags.forEach((style, index) => {
                const content = style.textContent;

                if (mergeCss) {
                    // Preserve order by concatenation
                    mergedCssContent += `/* Extracted from <style> block #${index + 1} */\n${content}\n\n`;
                    // Remove tag
                    if (index === 0) {
                        // Replace the first style tag with the link to maintain approximate position (cascade)
                        const link = doc.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = 'style.css';
                        style.parentNode.replaceChild(link, style);
                    } else {
                        style.remove();
                    }
                } else {
                    // Split Strategy
                    const filename = `style-${cssCounter}.css`;
                    files.push({ name: filename, content: content });

                    const link = doc.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = filename;
                    // Copy attributes (like media queries)
                    Array.from(style.attributes).forEach(attr => {
                        link.setAttribute(attr.name, attr.value);
                    });

                    style.parentNode.replaceChild(link, style);
                    this.log(`Extracted ${filename}`, 'success');
                    cssCounter++;
                }
            });

            if (mergeCss && mergedCssContent.trim()) {
                files.push({ name: 'style.css', content: mergedCssContent });
                this.log('Merged all CSS into style.css', 'success');
            }
        } else {
            this.log('No <style> tags found.', 'info');
        }

        // --- JS EXTRACTION ---
        this.log('Scanning for inline <script> tags...', 'info');
        // Select scripts that don't have a src attribute and are not type="application/json" etc unless explicitly js
        const scriptTags = Array.from(doc.querySelectorAll('script:not([src])'));
        // Filter out non-executable scripts (like JSON-LD or templates if they lack type or are text/javascript)
        const executableScripts = scriptTags.filter(s => !s.type || s.type === 'text/javascript' || s.type === 'module');

        let mergedJsContent = '';

        if (executableScripts.length > 0) {
            this.log(`Found ${executableScripts.length} inline script blocks.`, 'info');

            executableScripts.forEach((script, index) => {
                const content = script.textContent;
                if (!content.trim()) return;

                if (mergeJs) {
                    mergedJsContent += `// Extracted from script block #${index + 1}\n${content}\n\n`;
                    // Logic: If merging, we usually want the script to run at the end or where the first/last script was.
                    // Simple strategy: Remove all, append <script src="app.js"> at end of body.
                    script.remove();
                } else {
                    // Split Strategy
                    const filename = `script-${jsCounter}.js`;
                    files.push({ name: filename, content: content });

                    const newScript = doc.createElement('script');
                    newScript.src = filename;
                    // Copy attributes (defer, async, type="module")
                    Array.from(script.attributes).forEach(attr => {
                        newScript.setAttribute(attr.name, attr.value);
                    });

                    script.parentNode.replaceChild(newScript, script);
                    this.log(`Extracted ${filename}`, 'success');
                    jsCounter++;
                }
            });

            if (mergeJs && mergedJsContent.trim()) {
                files.push({ name: 'app.js', content: mergedJsContent });

                // Add the script tag to the end of body
                const mainScript = doc.createElement('script');
                mainScript.src = 'app.js';
                // If the original scripts were modules, we might have an issue merging. 
                // For simplicity in this tool, we assume standard JS unless user manages module deps.
                doc.body.appendChild(mainScript);
                this.log('Merged all JS into app.js', 'success');
            }
        } else {
            this.log('No inline <script> tags found.', 'info');
        }

        // --- EXTREME MODE (Dynamic HTML) ---
        if (extremeMode) {
            this.log('INITIATING EXTREME MODE...', 'warning');

            // 1. Get current Body HTML (after CSS/JS extraction modifications)
            let bodyContent = doc.body.innerHTML;

            // 2. Escape content for use in a template literal
            // We need to escape backticks ` and ${ to prevent JS interpolation errors in the generated file
            let escapedBody = bodyContent
                .replace(/\\/g, '\\\\') // Escape backslashes first
                .replace(/`/g, '\\`')   // Escape backticks
                .replace(/\$\{/g, '\\${'); // Escape template literal start

            // 3. Create the generator script
            const generatorContent = `
/** 
 * EXTREME MODE: Dynamic HTML Generator
 * This file constructs the DOM at runtime.
 */
document.addEventListener('DOMContentLoaded', () => {
    const dynamicHTML = \`${escapedBody}\`;
    document.body.innerHTML = dynamicHTML;
    console.log("Extreme Mode: DOM Regenerated");

    // Re-execute scripts that might have been inside the body string (browsers don't auto-run scripts injected via innerHTML)
    // Note: This is a basic implementation. Complex script tags inside the dynamic HTML might need manual handling.
});
            `;

            files.push({ name: 'extreme-loader.js', content: generatorContent });

            // 4. Wipe body and add loader
            doc.body.innerHTML = '';
            const loaderScript = doc.createElement('script');
            loaderScript.src = 'extreme-loader.js';
            doc.body.appendChild(loaderScript);

            // If we merged JS previously, we need to make sure that app.js is still loaded.
            // Since we wiped the body, if app.js was at the bottom, it's gone.
            // We need to re-append it AFTER the loader or strictly in head? 
            // Usually extreme mode implies the body content is dynamic, but utility scripts (app.js) usually sit outside.

            if (mergeJs && mergedJsContent.trim()) {
                const appScript = doc.createElement('script');
                appScript.src = 'app.js';
                doc.body.appendChild(appScript);
            }

            this.log('Extreme Mode: Body converted to JavaScript.', 'success');
        }

        // Serialize the final HTML
        const finalHtml = new XMLSerializer().serializeToString(doc);

        return {
            html: finalHtml,
            files: files
        };
    }
}