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
        AppInit                 = brackets.getModule("utils/AppInit"),
        Scope                   = require("scope").Scope;

    var sessionEditor       = null,
        sessionFilename     = null,
        path                = module.uri.substring(0, module.uri.lastIndexOf("/") + 1),
        outerScopeWorker    = new Worker(path + "parser-worker.js"),
        outerWorkerActive   = false, // is the outer worker active? 
        pendingInnerScopeRequest = null,
        outerScopeDirty     = true, // has the file changed since the last outer scope request? 
        innerScopeDirty     = true, // has the outer scope changed since the last inner scope request?
        outerScope          = null, // the outer-most scope returned by the parser worker
        innerScope          = null, // the inner-most scope returned by the query worker
        allIdentifiers      = null,
        allProperties       = null,
        identifiers         = null,
        properties          = null,
        deferred            = null; // the deferred response

    function _stopwatch(name, fun) {
        var startDate = new Date(),
            start = startDate.getTime(),
            result = fun(),
            stopDate = new Date(),
            diff = stopDate.getTime() - start;
        console.log("Time (" + name + "): " + diff);
        return result;
    }

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
        return hints.map(function (hintObj) {
            var hint = hintObj.value,
                index = hint.indexOf(query),
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

    function _filterWithQuery(tokens, query) {
        var i,
            hints = tokens.filter(function (token) {
                return (token.value.indexOf(query) === 0);
            });
        
        // remove current possibly incomplete token
        for (i = 0; i < hints.length; i++) {
            if (hints[i].value === query) {
                hints.splice(i, 1);
                break;
            }
        }
        
        return hints;
    }

    function _getHintObj() {
        var cursor = sessionEditor.getCursorPos(),
            cm = sessionEditor._codeMirror,
            doc = sessionEditor.document,
            token = cm.getTokenAt(cursor),
            query = (token && token.string) ?
                    (token.string === "." ? "" : token.string.trim()) : "",
            prevToken,
            hints;
        
        if (cursor.ch > 0) {
            prevToken = cm.getTokenAt({ch: cursor.ch - 1,
                                                line: cursor.line});
        } else if (cursor.ch === 0 && cursor.line > 0) {
            
            prevToken = cm.getTokenAt({ch: doc.getLine(cursor.line - 1).length,
                                                line: cursor.line - 1});
        } else {
            prevToken = null;
        }
        
        
        console.log("Query: '" + query + "'");
        
        if ((token && (token.string === "." || token.className === "property")) ||
                (prevToken && prevToken.string === ".")) {
            console.log("Property lookup");
            hints = _filterWithQuery(allProperties, query);
        } else {
            console.log("Identifier lookup");
            hints = _filterWithQuery(identifiers, query);
        }
        
        return {
            hints: _highlightQuery(hints, query),
            match: null,
            selectInitial: true
        };
    }

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

    function _requestOuterScope() {
        console.log("Requesting outer scope...");
        outerWorkerActive = true; // the outer scope worker is active
        outerScopeDirty = false; // the file is clean since the last outer scope request
        
        outerScopeWorker.postMessage({
            type        : "outerScope",
            path        : sessionFilename,
            text        : sessionEditor.document.getText()
        });
    }
    
    function _refreshOuterScope() {
        // if there is not yet an outer scope or if the file has changed then
        // we might need to update the outer scope
        if (outerScope === null || outerScopeDirty) {
            console.log("Refreshing outer scope...");
            if (!outerWorkerActive) {
                // and maybe if some time has passed without parsing... 
                _requestOuterScope();
            } else {
                console.log("Outer scope request already in progress.");
            }
        }
    }

    function _filterByScope(scope) {
        return allIdentifiers.filter(function (id) {
            return (scope.contains(id.value) >= 0);
        });
    }
    
    function _sortByScope(tokens, scope, pos) {
        
        function mindist(pos, t) {
            var dist = Math.abs(t.positions[0] - pos),
                i,
                tmp;
            
            for (i = 1; i < t.positions.length; i++) {
                tmp = Math.abs(t.positions[i] - pos);
                if (tmp < dist) {
                    dist = tmp;
                }
            }
            return dist;
        }

        function compare(a, b) {
            var adepth = scope.contains(a.value);
            var bdepth = scope.contains(b.value);
    
            if (adepth === bdepth) {
                return mindist(pos, a) - mindist(pos, b); // sort symbols at the same scope depth
            } else if (adepth !== null && bdepth !== null) {
                return adepth - bdepth;
            } else {
                if (adepth === null) {
                    return bdepth;
                } else {
                    return adepth;
                }
            }
        }
        
        tokens.sort(compare);
    }

    function _requestInnerScope(offset) {
        if (outerScope === null) {
            console.log("Inner scope request pending...");
            pendingInnerScopeRequest = offset;
            _refreshOuterScope();
        } else {
            console.log("Requesting inner scope...");
            pendingInnerScopeRequest = null;
            innerScopeDirty = false;
            innerScope = outerScope.findChild(offset);
            if (innerScope) {
                _stopwatch("filter", function () {
                    identifiers = _filterByScope(innerScope);
                    _sortByScope(identifiers, innerScope, offset);
                });
            } else {
                identifiers = null;
            }
            
            if (identifiers !== null) {
                if (deferred !== null) {
                    deferred.resolveWith(null, [_getHintObj()]);
                    deferred = null;
                    console.log("Deferred hints resolved.");
                }
            } else {
                console.log("Inner scope failure.");
                if (deferred !== null) {
                    deferred.reject();
                    deferred = null;
                    console.log("Deferred hints rejected.");
                }
            }
        }
    }
    
    function _refreshInnerScope(offset) {
        console.log("Refreshing inner scope at offset " + offset + "...");
        
        // if there is not yet an inner scope, or if the outer scope has 
        // changed, or if the inner scope is invalid w.r.t. the current cursor
        // position we might need to update the inner scope
        if (innerScope === null || innerScopeDirty ||
                !innerScope.hasPosition(offset)) {
            console.log("Inner scope requires refresh.");
            _requestInnerScope(offset);
        } else {
            console.log("Inner scope can be reused: " +
                        innerScope.range.start + " < " +
                        offset + " < " +
                        innerScope.range.end);
        }
    }

    function _handleOuterScope(response) {
        var type = response.type;
        
        if (type === "outerScope") {
            console.log("Outer scope request complete.");
            outerWorkerActive = false;
            
            if (response.success) {
                _stopwatch("rebuild", function () {
                    outerScope = new Scope(response.scope);
                });

                allIdentifiers = response.identifiers;
                allProperties = response.properties;
                innerScopeDirty = true;
                console.log("Outer scope updated.");
                
                if (outerScopeDirty) {
                    _refreshOuterScope();
                }
                
                if (pendingInnerScopeRequest !== null) {
                    _refreshInnerScope(pendingInnerScopeRequest);
                }
            } else {
                console.log("Outer scope failure.");
            }
        } else {
            console.log("Outer worker: " + (response.log || response));
        }
    }
    
    function _refreshEditor(editor) {
        var newFilename = editor.document.file.fullPath;
        sessionEditor = editor;
        if (sessionFilename !== newFilename) {
            identifiers = null;
            innerScope = null;
            outerScope = null;
            outerScopeDirty = true;
            innerScopeDirty = true;
        }
        sessionFilename = newFilename;
        if (deferred && !deferred.isRejected()) {
            deferred.reject();
        }
        deferred = null;
        _refreshOuterScope();
    }

    function _installEditorListeners(editor) {
        if (!editor) {
            return;
        }
        
        $(editor)
            .on("change.brackets-js-hints", function () {
                outerScopeDirty = true;
                _refreshOuterScope();
            });
        
        _refreshEditor(editor);
    }
    
    function _uninstallEditorListeners(editor) {
        $(editor)
            .off("change.brackets-js-hints");
    }

    /**
     * @constructor
     */
    function JSHints() {
    }

    JSHints.prototype.hasHints = function (editor, key) {
        console.log("JSHint.hasHints: " +
                    (key !== null ? ("'" + key + "'") : key));
        
        var cursor      = editor.getCursorPos(),
            token       = editor._codeMirror.getTokenAt(cursor),
            newFilename = editor.document.file.fullPath;
        
        if ((key === null) || _maybeIdentifier(key)) {
            // don't autocomplete within strings or comments, etc.
            if (_okTokenClass(token)) {
                _refreshEditor(editor);
                return true;
            }
        }
        return false;
    };

    JSHints.prototype.getHints = function (key) {
        var cursor = sessionEditor.getCursorPos(),
            hints,
            token;
        
        console.log("JSHint.getHints: " +
                    (key !== null ? ("'" + key + "'") : key));

        if (_maybeIdentifier(key)) {
            token = sessionEditor._codeMirror.getTokenAt(cursor);
            console.log("token: '" + token.string + "'");
            if (token && _okTokenClass(token)) {

                var offset = _cursorOffset(sessionEditor.document, cursor);
                _refreshInnerScope(offset);
                
                if (innerScope) {
                    console.log("Returning hints...");
                    return _getHintObj();
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
            
            outerScopeDirty = true;
            _refreshOuterScope();
        }

        return false;
    };
    
    // load the extension
    AppInit.appReady(function () {
        outerScopeWorker.addEventListener("message", function (e) {
            _handleOuterScope(e.data);
        });
                
        // uninstall/install change listner as the active editor changes
        $(EditorManager)
            .on("activeEditorChange.brackets-js-hints", function (event, current, previous) {
                _uninstallEditorListeners(previous);
                _installEditorListeners(current);
                
            });

        _installEditorListeners(EditorManager.getActiveEditor());

        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints, ["javascript"], 0);
        console.log("JSHints");
        
        // for unit testing
        exports.jsHintProvider = jsHints;
    });
});
