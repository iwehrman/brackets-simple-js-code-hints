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
        AppInit                 = brackets.getModule("utils/AppInit");
	
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
	
	function _findAllTokens(editor, userCursor, prefix) {
        var cm = editor._codeMirror;
        var cursor = {ch: 0, line: 0}, t;
        var tokenTable = {};
        var tokenList = [];
        
        while (cm.getLine(cursor.line) !== undefined) {
            t = cm.getTokenAt(cursor);
            if (t.end < cursor.ch) {
                // We already parsed this token because our cursor is past
                // the token that codemirror gave us. So, we're at end of line.
                cursor.line += 1;
                cursor.ch = 0;
            } else {
                // A new token!
                
                // console.log(t.className + ":" + t.string);
                var className = t.className;
                if (className === "variable" || className === "variable-2" ||
                        className === "def" || className === "property") {
                    
                    // ignore the token currently being typed
                    if (!(userCursor.line === cursor.line && userCursor.ch >= t.start &&
                            userCursor.ch <= t.end)) {
                        
                        // only return tokens that extend the prefix, ignoring leading delimiters
                        if ((t.string.indexOf(prefix) === 0) || _isDelimiter(prefix)) {
                            tokenTable[t.string] = true;
                        }
                    }
                }
                
                // Advance to next token (or possibly to the end of the line)
                cursor.ch = t.end + 1;
            }
        }
        
        for (t in tokenTable) {
            if (tokenTable.hasOwnProperty(t)) {
                tokenList.push(t);
            }
        }
        
        return tokenList;
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
     * @constructor
     */
    function JSHints() {
		this.tokens = {};
	}
	
	JSHints.prototype._initializeTokens = function(editor) {
        var cm = editor._codeMirror;
        var cursor = {ch: 0, line: 0}, t;
        
        while (cm.getLine(cursor.line) !== undefined) {
            t = cm.getTokenAt(cursor);
            if (t.end < cursor.ch) {
                // We already parsed this token because our cursor is past
                // the token that codemirror gave us. So, we're at end of line.
                cursor.line += 1;
                cursor.ch = 0;
            } else {
                // A new token!
                
                // console.log(t.className + ":" + t.string);
                var className = t.className;
                if (className === "variable" || className === "variable-2" ||
                        className === "def" || className === "property") {
                    
                    // ignore the token currently being typed
                    if (!(userCursor.line === cursor.line && userCursor.ch >= t.start &&
                            userCursor.ch <= t.end)) {
                        
                        // only return tokens that extend the prefix, ignoring leading delimiters
                        if ((t.string.indexOf(prefix) === 0) || _isDelimiter(prefix)) {
                            this.tokens[t.string] = true;
                        }
                    }
                }
                
                // Advance to next token (or possibly to the end of the line)
                cursor.ch = t.end + 1;
            }
        }
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
            queryInfo.tokens = _findAllTokens(editor, cursor, queryInfo.queryStr);
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
        // install autocomplete handler
        var jsHints = new JSHints();		
        CodeHintManager.registerHintProvider(jsHints);
        
        console.log("hi");
    });
});
