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

    var sessionEditor       = null,  // editor object for the current hinting session
        $deferredHintObj    = null,  // deferred hint object
        innerScopePending   = null,  // was an inner scope request delayed waiting for an outer scope?
        innerScopeDirty     = true,  // has the outer scope changed since the last inner scope request?
        innerScope          = null,  // the inner-most scope returned by the query worker
        identifiers         = null,  // identifiers in the local scope
        properties          = null,  // properties sorted by position
        allIdentifiers      = null,  // all identifiers from the outer scope
        allProperties       = null,  // all properties from the outer scope
        outerScope          = null,  // the outer-most scope returned by the parser worker
        outerScopeDirty     = true,  // has the file changed since the last outer scope request? 
        outerWorkerActive   = false, // is the outer worker active? 
        outerScopeWorker    = (function () {
            var path = module.uri.substring(0, module.uri.lastIndexOf("/") + 1);
            return new Worker(path + "parser-worker.js");
        }());

    /**
     * Creates a hint response object
     */
    function _getHintObj() {

        /*
         * Get the token before the one at the given cursor
         */
        function getPreviousToken(cm, cursor) {
            var doc = sessionEditor.document;

            if (cursor.ch > 0) {
                return cm.getTokenAt({ch: cursor.ch - 1,
                                      line: cursor.line});
            } else if (cursor.ch === 0 && cursor.line > 0) {
                return cm.getTokenAt({ch: doc.getLine(cursor.line - 1).length,
                                      line: cursor.line - 1});
            }
            
            return null;
        }

        /*
         * Filter a list of tokens using a given query string
         */
        function filterWithQuery(tokens, query) {
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

        /*
         * Returns a formatted list of hints with the query substring highlighted
         */
        function formatHints(hints, query) {
            return hints.map(function (token) {
                var hint = token.value,
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

                switch (token.level) {
                case 0:
                    $hintObj.css('color', 'rgb(0,100,0)');
                    break;
                case 1:
                    $hintObj.css('color', 'rgb(100,100,0)');
                    break;
                case 2:
                    $hintObj.css('color', 'rgb(0,0,100)');
                    break;
                }

                return $hintObj;
            });
        }
        
        var cursor = sessionEditor.getCursorPos(),
            cm = sessionEditor._codeMirror,
            token = cm.getTokenAt(cursor),
            query = (token && token.string) ?
                    (token.string === "." ? "" : token.string.trim()) : "",
            prevToken = getPreviousToken(cm, cursor),
            hints;
        
//        console.log("Token: '" + token.string + "'");
//        console.log("Prev: '" + (prevToken ? prevToken.string : "(null)") + "'");
//        console.log("Query: '" + query + "'");
        
        if ((token && (token.string === "." || token.className === "property")) ||
                (prevToken && prevToken.string.indexOf(".") >= 0)) {
            hints = filterWithQuery(properties, query);
        } else {
            hints = filterWithQuery(identifiers, query);
        }
        
        return {
            hints: formatHints(hints, query),
            match: null,
            selectInitial: true
        };
    }

    /**
     * Request a new outer scope object from the parser worker, if necessary
     */
    function _refreshOuterScope() {
        // if there is not yet an outer scope or if the file has changed then
        // we might need to update the outer scope
        if (outerScope === null || outerScopeDirty) {
            if (!outerWorkerActive) {
                // and maybe if some time has passed without parsing... 
                outerWorkerActive = true; // the outer scope worker is active
                outerScopeDirty = false; // the file is clean since the last outer scope request
                outerScopeWorker.postMessage({
                    type        : "outerScope",
                    path        : sessionEditor.document.file.fullPath,
                    text        : sessionEditor.document.getText()
                });
            }
        }
    }

    /**
     * Recompute the inner scope for a given offset, if necessary
     */
    function _refreshInnerScope(offset) {

        /*
         * Filter a list of tokens using a given scope object
         */
        function filterByScope(tokens, scope) {
            return tokens.filter(function (id) {
                var level = scope.contains(id.value);
                if (level >= 0) {
                    id.level = level;
                    return true;
                } else {
                    return false;
                }
            });
        }

        /*
         * Comparator for sorting tokens according to minimum distance from
         * a given position
         */
        function comparePositions(pos) {
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

            return function (a, b) {
                return mindist(pos, a) - mindist(pos, b);
            };
        }

        /*
         * Comparator for sorting tokens lexicographically according to scope
         * and then minimum distance from a given position
         */
        function compareScopes(scope, pos) {
            return function (a, b) {
                var adepth = scope.contains(a.value);
                var bdepth = scope.contains(b.value);

                if (adepth === bdepth) {
                    // sort symbols at the same scope depth
                    return comparePositions(pos)(a, b);
                } else if (adepth !== null && bdepth !== null) {
                    return adepth - bdepth;
                } else {
                    if (adepth === null) {
                        return bdepth;
                    } else {
                        return adepth;
                    }
                }
            };
        }

        // if there is not yet an inner scope, or if the outer scope has 
        // changed, or if the inner scope is invalid w.r.t. the current cursor
        // position we might need to update the inner scope
        if (innerScope === null || innerScopeDirty ||
                !innerScope.containsPositionImmediate(offset)) {

            if (outerScope === null) {
                innerScopePending = offset;
                _refreshOuterScope();
            } else {
                innerScopePending = null;
                innerScopeDirty = false;
                
                innerScope = outerScope.findChild(offset);
                if (innerScope) {
                    // FIXME: This could be more efficient if instead of filtering
                    // the entire list of identifiers we just used the identifiers
                    // in the scope of innerScope, but that list doesn't have the
                    // accumulated position information.
                    identifiers = filterByScope(allIdentifiers, innerScope);
                    identifiers.sort(compareScopes(innerScope, offset));
                    properties = allProperties.slice(0).sort(comparePositions(offset));
                } else {
                    identifiers = [];
                    properties = [];
                }

                if ($deferredHintObj !== null &&
                        $deferredHintObj.state() === "pending") {
                    $deferredHintObj.resolveWith(null, [_getHintObj()]);
                }
                
                $deferredHintObj = null;
            }
        }
    }

    /**
     * Reset and recompute the scope and hinting information for the given
     * editor
     */
    function _refreshEditor(editor) {
        var newFilename = editor.document.file.fullPath;

        if (!sessionEditor ||
                sessionEditor.document.file.fullPath !== newFilename) {
            identifiers = null;
            properties = null;
            innerScope = null;
            outerScope = null;
            outerScopeDirty = true;
            innerScopeDirty = true;
        }
        sessionEditor = editor;

        if ($deferredHintObj && $deferredHintObj.state() === "pending") {
            $deferredHintObj.reject();
        }
        $deferredHintObj = null;

        _refreshOuterScope();
    }

    /**
     * Is the string key perhaps a valid JavaScript identifier?
     */
    function _maybeIdentifier(key) {
        return (/[0-9a-z_.\$]/i).test(key);
    }

    /**
     * Is the token's class hintable?
     */
    function _hintableTokenClass(token) {
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

    /**
     * @constructor
     */
    function JSHints() {
    }

    JSHints.prototype.hasHints = function (editor, key) {
        var cursor      = editor.getCursorPos(),
            token       = editor._codeMirror.getTokenAt(cursor),
            newFilename = editor.document.file.fullPath;
        
        if ((key === null) || _maybeIdentifier(key)) {
            // don't autocomplete within strings or comments, etc.
            if (_hintableTokenClass(token)) {
                _refreshEditor(editor);
                return true;
            }
        }
        return false;
    };

    /** 
      * Return a list of hints, possibly deferred, for the current editor 
      * context
      */
    JSHints.prototype.getHints = function (key) {
        var cursor = sessionEditor.getCursorPos(),
            hints,
            token;
        
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
        
        if (_maybeIdentifier(key)) {
            token = sessionEditor._codeMirror.getTokenAt(cursor);

            if (token && _hintableTokenClass(token)) {

                var offset = _cursorOffset(sessionEditor.document, cursor);
                _refreshInnerScope(offset);
                
                if (outerScope) {
                    return _getHintObj();
                } else {
                    console.log("Deferring hints...");
                    if (!$deferredHintObj || $deferredHintObj.isRejected()) {
                        $deferredHintObj = $.Deferred();
                    }
                    return $deferredHintObj;
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

        token = cm.getTokenAt(cursor);
        if (token) {

            if (token.string.lastIndexOf(".") === token.string.length - 1) {
                offset = token.string.length;
            }

            cm.replaceRange(completion,
                            {line: cursor.line, ch: token.start + offset},
                            {line: cursor.line, ch: token.end});

            outerScopeDirty = true;
            _refreshOuterScope();
        }

        return false;
    };
    
    // load the extension
    AppInit.appReady(function () {

        /*
         * Receive an outer scope object from the parser worker
         */
        function handleOuterScope(response) {
            outerWorkerActive = false;

            if (response.success) {
                outerScope = new Scope(response.scope);
                allIdentifiers = response.identifiers;
                allProperties = response.properties;
                innerScopeDirty = true;

                if (outerScopeDirty) {
                    _refreshOuterScope();
                }

                if (innerScopePending !== null) {
                    _refreshInnerScope(innerScopePending);
                }
            }
        }

        /*
         * Install editor change listeners to keep the outer scope fresh
         */
        function installEditorListeners(editor) {
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

        /*
         * Uninstall editor change listeners
         */
        function uninstallEditorListeners(editor) {
            $(editor)
                .off("change.brackets-js-hints");
        }

        outerScopeWorker.addEventListener("message", function (e) {
            var response = e.data,
                type = response.type;

            if (type === "outerScope") {
                handleOuterScope(response);
            } else {
                console.log("Worker: " + (response.log || response));
            }
        });
                
        // uninstall/install change listner as the active editor changes
        $(EditorManager)
            .on("activeEditorChange.brackets-js-hints",
                function (event, current, previous) {
                    uninstallEditorListeners(previous);
                    installEditorListeners(current);
                });

        installEditorListeners(EditorManager.getActiveEditor());

        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints, ["javascript"], 0);

        // for unit testing
        exports.jsHintProvider = jsHints;
    });
});
