/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $, CodeMirror */

define(function (require, exports, module) {
    "use strict";
	
    var CodeHintManager         = brackets.getModule("editor/CodeHintManager"),
        DocumentManager         = brackets.getModule("document/DocumentManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        EditorUtils             = brackets.getModule("editor/EditorUtils"),
        AppInit                 = brackets.getModule("utils/AppInit"),
        esprima                 = require('esprima/esprima'),
        scope                   = require('scope');
	
	// var tokens = [];
	
    function _documentIsJavaScript(doc) {
        return doc && EditorUtils.getModeFromFileExtension(doc.file.fullPath) === "javascript";
    }
    
    function _findCurrentToken(editor, userCursor) {
        var cm = editor._codeMirror;
        var token = cm.getTokenAt(userCursor);
        
        if (token !== null && token.string !== null) {
            return token.string;
        } else {
            return "";
        }
    }
    
    var allTokens   = [],
        parseTree   = null,
        globalScope = null,
        path        = module.uri.substring(0, module.uri.lastIndexOf("/") + 1),
        worker      = new Worker(path + "worker.js"),
    
    function cursorOffset(document, cursor) {
        var offset = 0,
            i;
        for (i = 0; i < cursor.line; i++) {
            // +1 for the removed line break
            offset += document.getLine(i).length + 1; 
        }
        offset += cursor.ch;
        return offset;
    }

    function _updateTokenList(document) {
        var text    = document.getText(false),
            options = { range: true,
                        tokens: true,
                        tolerant    : true};

        // try to update the master token list
        try {
            parseTree = esprima.parse(text, options);
            globalScope = new scope.Scope(parseTree);
            allTokens = parseTree.tokens.filter(function (t) {
                return (t.type === "Identifier");
            });
        } catch (ex) {
            console.log("Esprima: " + ex);
        }
    }
    
    function _findTokens(editor, cursor, prefix) {
        var cursorScope,
            token,
            uniqueTokens,
            matchingTokens = [];

        if (parseTree !== null) {
            cursorScope = globalScope.findChild(cursorOffset(editor.document, cursor));
            if (cursorScope === null) {
                // just use the global scope if the cursor is not in range
                cursorScope = globalScope;
                console.log("Global scope");
            }

            // console.log("Scope: " + cursorScope.toString());
            // console.log("In scope: " + cursorScope.getAllIdentifiers().map(function (t) { return t.name; }));
            uniqueTokens = allTokens.reduce(function (prev, curr) {
                if (cursorScope.contains(curr.value) >= 0) {
                    prev[curr.value] = curr;
                }
                return prev;
            }, {});
            
            for (token in uniqueTokens) {
                if (Object.prototype.hasOwnProperty.call(uniqueTokens, token) &&
                        token.indexOf(prefix) === 0) {
                    matchingTokens.push(token);
                }
            }
        }
        
        return matchingTokens;
    }
    
    function _isDelimiter(prefix) {
        return (prefix === "(" || prefix === "[" ||
					prefix === ":" || prefix === ".");
    }
    
    function _insertCompletionAtCursor(completion, editor, cursor) {
        var token;
        var cm = editor._codeMirror;
        
        if (_documentIsJavaScript(editor.document)) { // on the off-chance we changed documents, don't change anything
            token = cm.getTokenAt(cursor);
            if (token) {
                
                // if the token is a delimiter, append the completion; 
                // otherwise replace the existing token 
                var offset = 0;
                if (_isDelimiter(token.string)) {
                    offset = token.string.length;
                }
				                
                cm.replaceRange(completion,
                                {line: cursor.line, ch: token.start + offset},
                                {line: cursor.line, ch: token.end + offset});
                console.log('token: ' + token.string);
                console.log('completion: ' + completion);
            }
        }
    }



    /**
     * Calls _updateTokenList if the document changes are significant
     */
    function _handleDocumentChange(event, document, changes) {
        console.log("Args: " + arguments);

        while (changes != null) {
            console.log(JSON.stringify(changes.from) + " - " + JSON.stringify(changes.to) + " : '" + changes.text + "'");
            if (changes.from.line !== changes.to.line) {
                _updateTokenList(document);
            } else {
                if (!(changes.text[0] === "" || (new RegExp("[a-z0-9]","i").test(changes.text[0])))) {
                    console.log("No match: " + changes.text);
                    _updateTokenList(document);
                } else {
                    console.log("Match: " + changes.text);
                }
            }
            changes = changes.next;
        }
        
    }

    function _installEditorListeners(editor) {
        if (!editor) {
            return;
        }
                
        $(editor.document)
            .on("change.JSCodeHints", _handleDocumentChange);
            //.on("cursorActivity.JSCodeHints", debounceMarkOccurrences);
        
        // immediately parse the new editor
        _updateTokenList(editor.document);
    }
    
    function _activeEditorChange(event, current, previous) {
        allTokens = [];
        parseTree = null;
        globalScope = null;
        
        _installEditorListeners(current);
    }
	
    /**
     * @constructor
     */
    function JSHints() {
	}

    /**
     * Filters the source list by query and returns the result
     * @param {Object.<queryStr: string, ...} query -- a query object with a required property queryStr 
     *     that will be used to filter out code hints
     * @return {Array.<string>}
     */
    JSHints.prototype.search = function (query) {
        return query.tokens;
    };


    /**
     * Figures out the text to use for the hint list query based on the text
     * around the cursor
     * Query is the text from the start of a tag to the current cursor position
     * @param {Editor} editor
     * @param {Cursor} current cursor location
     * @return {Object.<queryStr: string, ...} search query results will be filtered by.
     *      Return empty queryStr string to indicate code hinting should not filter and show all results.
     *      Return null in queryStr to indicate NO hints can be provided.
     */
    JSHints.prototype.getQueryInfo = function (editor, cursor) {
        var queryInfo = {queryStr: null}; // by default, don't handle

        if (_documentIsJavaScript(editor.document)) {
            queryInfo.queryStr = _findCurrentToken(editor, cursor);
            queryInfo.tokens = _findTokens(editor, cursor, queryInfo.queryStr);
        }

        return queryInfo;
    };

    /**
     * Enters the code completion text into the editor
     * @param {string} completion - text to insert into current code editor
     * @param {Editor} editor
     * @param {Cursor} current cursor location
     */
    JSHints.prototype.handleSelect = function (completion, editor, cursor) {
        _insertCompletionAtCursor(completion, editor, cursor);
        return true;
    };

    /**
     * Check whether to show hints on a specific key.
     * @param {string} key -- the character for the key user just presses.
     * @return {boolean} return true/false to indicate whether hinting should be triggered by this key.
     */
    JSHints.prototype.shouldShowHintsOnKey = function (key) {
        return true;
    };
    
    // load everything when brackets is done loading
    AppInit.appReady(function () {
        
        // uninstall/install change listner as the active editor changes
        $(EditorManager).on("activeEditorChange.JSCodeHints", _activeEditorChange);
        
        // install on the initial active editor
        _installEditorListeners(EditorManager.getActiveEditor());

        // install autocomplete handler
        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints);
        
        console.log("hi");
    });
});
