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
/*global define, brackets, CodeMirror, $, Worker */

define(function (require, exports, module) {
    "use strict";

    var CodeHintManager         = brackets.getModule("editor/CodeHintManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        EditorUtils             = brackets.getModule("editor/EditorUtils"),
        AppInit                 = brackets.getModule("utils/AppInit");

    // hinting is provided by CodeMirror
    // require("thirdparty/CodeMirror2/lib/util/javascript-hint.js");

    var sessionEditor   = null,
        path            = module.uri.substring(0, module.uri.lastIndexOf("/") + 1),
        worker          = new Worker(path + "worker.js"),
        working         = false,
        dirty           = false,
        tokens          = null,
        deferred        = null;

    function _maybeIdentifier(key) {
        return (/[0-9a-z_.\$]/i).test(key);
    }

    function _okTokenClass(token) {
        switch (token.className) {
        case "string":
        case "comment":
        case "number":
        case "regexp":
            return false;
        default:
            return true;
        }
    }
    
    function _highlightQuery(hints, query) {
        return hints.map(function (hint) {
            var index = hint.indexOf(query),
                $hintObj = $('<span>');
            
            if (index >= 0) {
                $hintObj.append(hint.slice(0, index))
                    .append($('<span>')
                            .append(hint.slice(index, index + query.length))
                            .css('font-weight', 'bold'))
                    .append(hint.slice(index + query.length));
            } else {
                $hintObj.text(hint);
            }
            $hintObj.data('hint', hint);
            return $hintObj;
        });
    }

    function _filterQuery(hints, query) {
        // remove current possibly incomplete token
        var index = hints.indexOf(query);
        if (index >= 0) {
            hints.splice(index, 1);
        }
    }

    function _getHintObj(query) {
        
        console.log("Query: '" + query + "'");
        
        var hints = tokens.filter(function (token) {
            return (token.indexOf(query) === 0);
        });
        
        _filterQuery(hints, query);
        
        return {
            hints: _highlightQuery(hints, query),
            match: null,
            selectInitial: true
        };
    }
    
    function _parseEditor() {
        
        function _cursorOffset(document, cursor) {
            var offset = 0,
                i;
            
            for (i = 0; i < cursor.line; i++) {
                // +1 for the removed line break
                offset += document.getLine(i).length + 1;
            }
            offset += cursor.ch;
            return offset;
        }
        
        if (!working) {
            console.log("Parsing...");
            working = true;
            worker.postMessage({
                type        : "parse",
                text        : sessionEditor.document.getText(),
                path        : sessionEditor.document.file.fullPath,
                offset      : _cursorOffset(sessionEditor.document, sessionEditor.getCursorPos())
            });
        } else {
            console.log("Waiting...");
            dirty = true;
        }
    }
    
    function _startWorker() {
        worker.addEventListener("message", function (e) {
            var response = e.data,
                type = response.type;
            
            if (type === "parse") {
                console.log("Parsing complete.");
                if (response.success) {
                    tokens = e.data.tokens;
                    console.log("Updating token list.");
                    
                    if (deferred !== null) {
                        var cursor = sessionEditor.getCursorPos(),
                            token = sessionEditor._codeMirror.getTokenAt(cursor),
                            query = (token && token.string) ? token.string.trim() : "";
                        
                        deferred.resolveWith(this, [_getHintObj(query)]);
                        deferred = null;
                    }
                } else {
                    tokens = null;
                    if (deferred !== null) {
                        deferred.reject();
                        deferred = null;
                    }
                }
                
                working = false;
                if (dirty) {
                    dirty = false;
                    _parseEditor();
                }
            } else {
                console.log(e.data.log || e.data);
            }
        });
    
        // start the worker
        worker.postMessage({});
    }

    /**
     * @constructor
     */
    function JSHints() {
    }

    JSHints.prototype.hasHints = function (editor, key) {
        console.log("JSHint.hasHints: " +
                    (key !== null ? ("'" + key + "'") : key));
        
        var cursor = editor.getCursorPos(),
            token  = editor._codeMirror.getTokenAt(cursor);
        sessionEditor = editor;
        tokens = null;
        
        if ((key === null) || _maybeIdentifier(key)) {
            // don't autocomplete within strings or comments, etc.
            if (_okTokenClass(token)) {
                _parseEditor();
                return true;
            }
        }
        return false;
    };

    JSHints.prototype.getHints = function (key) {
        var cursor = sessionEditor.getCursorPos(),
            hints,
            token,
            query;
        
        console.log("JSHint.getHints: " +
                    (key !== null ? ("'" + key + "'") : key));

        if (_maybeIdentifier(key)) {
            token = sessionEditor._codeMirror.getTokenAt(cursor);
            console.log("token: '" + token.string + "'");
            if (token && _okTokenClass(token)) {
                query = token.string.trim();

                if (tokens) {
                    console.log("Returning hints...");
                    return _getHintObj(query);
                } else {
                    console.log("Deferring hints...");
                    if (!deferred || deferred.isRejected()) {
                        deferred = $.Deferred();
                    }
                    return deferred;
                }
            }
        }
        
        return null;
    };

    /**
     * Enters the code completion text into the editor
     * 
     * @param {string} hint - text to insert into current code editor
     */
    JSHints.prototype.insertHint = function (hint) {
        var completion = hint.data('hint'),
            cm = sessionEditor._codeMirror,
            cursor = sessionEditor.getCursorPos(),
            token,
            offset = 0;

        console.log("JSHint.insertHint: '" + completion + "'");

        token = cm.getTokenAt(cursor);
        if (token) {

            if (token.string.lastIndexOf(".") === token.string.length - 1) {
                offset = token.string.length;
            }

            cm.replaceRange(completion,
                            {line: cursor.line, ch: token.start + offset},
                            {line: cursor.line, ch: token.end + offset});
        }

        return false;
    };
    
    

    // load the extension
    AppInit.appReady(function () {
        
        _startWorker();
        
        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints, ["javascript"], 0);
        console.log("JSHints");

        // for unit testing
        exports.jsHintProvider = jsHints;
    });
});
