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
/*global define, brackets, CodeMirror, $, Worker, setTimeout */

define(function (require, exports, module) {
    "use strict";

    var CodeHintManager         = brackets.getModule("editor/CodeHintManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        EditorUtils             = brackets.getModule("editor/EditorUtils"),
        AppInit                 = brackets.getModule("utils/AppInit");

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
        tokens              = null, // the list of tokens from the inner scope
        deferred            = null; // the deferred response
    
    function findChildScope(scope, pos) {
        var i;
        if (scope.range.start <= pos && pos < scope.range.end) {
            for (i = 0; i < scope.children.length; i++) {
                if (scope.children[i].range.start <= pos &&
                        pos < scope.children[i].range.end) {
                    return findChildScope(scope.children[i], pos);
                }
            }
            // if no child has a matching range, this is the most precise scope
            return scope;
        } else {
            return null;
        }
    }
    
    function getAllIdentifiersInScope(scope) {
        var ids = [];
        do {
            ids = ids.concat(scope.identifiers);
            scope = scope.parent;
        } while (scope !== null);
        return ids;
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
                // and if some time has passed without parsing... 
                _requestOuterScope();
            } else {
                console.log("Outer scope request already in progress.");
            }
        }
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
            
            innerScope = findChildScope(outerScope, offset);
            if (innerScope) {
                tokens = getAllIdentifiersInScope(innerScope).map(function (t) { return t.name; });
            } else {
                tokens = null;
            }
            
            if (tokens !== null) {
                if (deferred !== null) {
                    var cursor = sessionEditor.getCursorPos(),
                        token = sessionEditor._codeMirror.getTokenAt(cursor),
                        query = (token && token.string) ? token.string.trim() : "";
                    
                    deferred.resolveWith(null, [_getHintObj(query)]);
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
    
    function _sameScope(scope, pos) {
        var range = scope.range,
            children = scope.children,
            i;
        // is in the parent's scope...
        if (range.start <= pos && pos < range.end) {
            for (i = 0; i < children.length; i++) {
                // but not in a child's scope
                if (_sameScope(children[i], pos)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    
    function _refreshInnerScope(offset) {
        console.log("Refreshing inner scope at offset " + offset + "...");
        
        // if there is not yet an inner scope, or if the outer scope has 
        // changed, or if the inner scope is invalid w.r.t. the current cursor
        // position we might need to update the inner scope
        if (innerScope === null || innerScopeDirty ||
                !_sameScope(innerScope, offset)) {
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
                outerScope = response.scope;
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
    
    function _startWorkers() {
        outerScopeWorker.addEventListener("message", function (e) {
            _handleOuterScope(e.data);
        });
        
        // start the worker
        outerScopeWorker.postMessage({});
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
                sessionEditor = editor;
                if (sessionFilename !== newFilename) {
                    tokens = null;
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

                var offset = _cursorOffset(sessionEditor.document, cursor);
                _refreshInnerScope(offset);
                
                if (innerScope) {
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
            
            outerScopeDirty = true;
            _refreshOuterScope();
        }

        return false;
    };
    
    function foo(bar) {
        require();
    }
    

    // load the extension
    AppInit.appReady(function () {
        
        _startWorkers();
        
        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints, ["javascript"], 0);
        console.log("JSHints");

        // for unit testing
        exports.jsHintProvider = jsHints;
    });
});
