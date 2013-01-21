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
/*global define, brackets, $ */

define(function (require, exports, module) {
    "use strict";

    var CodeHintManager         = brackets.getModule("editor/CodeHintManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        AppInit                 = brackets.getModule("utils/AppInit"),
        HintUtils               = require("HintUtils"),
        ScopeManager            = require("ScopeManager"),
        Scope                   = require("Scope").Scope;

    var $deferredHints      = null,  // deferred hint object
        $deferredScope      = null,  // deferred scope object
        sessionEditor       = null,  // editor object for the current hinting session
        sessionHints        = null,  // sorted hints for the current hinting session
        sessionType         = null,  // describes the lookup type and the object context
        innerScope          = null,  // the inner-most scope returned by the query worker
        scopedIdentifiers   = null,  // identifiers for the current inner scope
        scopedProperties    = null,  // properties for the current inner scope
        scopedAssociations  = null;  // associations for the current inner scope

    /**
     * Calculate a query string relative to the current cursor position
     * and token.
     */
    function getQuery(cursor, token) {
        var query = "";
        if (token) {
            if (token.string !== ".") {
                query = token.string.substring(0, token.string.length - (token.end - cursor.ch));
            }
        }
        return query.trim();
    }
    
    /**
     * Creates a hint response object
     */
    function getResponse(hints, query) {
        
        /*
         * Filter a list of tokens using a given query string
         */
        function filterWithQuery(tokens, query) {
            var hints = tokens.filter(function (token) {
                    return (token.value.indexOf(query) === 0);
                });

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
        
        var filteredHints   = filterWithQuery(hints.slice(0), query).slice(0, 100),
            formattedHints  = formatHints(filteredHints, query);
            
        return {
            hints: formattedHints,
            match: null,
            selectInitial: true
        };
    }
                             
    function getSessionType(getToken, cursor, token) {
                
        /*
         * Get the token before the one at the given cursor
         */
        function getPreviousToken(cursor, token) {
            var doc     = sessionEditor.document,
                prev    = token;

            do {
                if (prev.start < cursor.ch) {
                    cursor = {ch: prev.start, line: cursor.line};
                } else if (prev.start > 0) {
                    cursor = {ch: prev.start - 1, line: cursor.line};
                } else if (cursor.line > 0) {
                    cursor = {ch: doc.getLine(cursor.line - 1).length - 1,
                              line: cursor.line - 1};
                } else {
                    break;
                }
                prev = getToken(cursor);
            } while (prev.string.trim() === "");
            
            return prev;
        }
                
        var propertyLookup  = false,
            context         = null,
            prevToken       = getPreviousToken(cursor, token);
                
        if (token) {
            if (token.className === "property") {
                propertyLookup = true;
                if (prevToken.string === ".") {
                    token = prevToken;
                    prevToken = getPreviousToken(cursor, prevToken);
                }
            }

            if (token.string === ".") {
                propertyLookup = true;
                if (prevToken && HintUtils.hintable(prevToken)) {
                    context = prevToken.string;
                }
            }
        }
                
        return {
            property: propertyLookup,
            context: context
        };
    }
                             
    function getSessionHints(path, offset, type) {

        /*
         * Comparator for sorting tokens according to minimum distance from
         * a given position
         */
        function compareByPosition(pos) {
            function mindist(pos, t) {
                var dist = t.positions.length ? Math.abs(t.positions[0] - pos) : Infinity,
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
                var adist = mindist(pos, a),
                    bdist = mindist(pos, b);
                
                if (adist === Infinity) {
                    if (bdist === Infinity) {
                        return 0;
                    } else {
                        return 1;
                    }
                } else {
                    if (bdist === Infinity) {
                        return -1;
                    } else {
                        return adist - bdist;
                    }
                }
            };
        }

        /*
         * Comparator for sorting tokens lexicographically according to scope
         * and then minimum distance from a given position
         */
        function compareByScope(scope) {
            return function (a, b) {
                var adepth = scope.contains(a.value);
                var bdepth = scope.contains(b.value);

                if (adepth >= 0) {
                    if (bdepth >= 0) {
                        return adepth - bdepth;
                    } else {
                        return -1;
                    }
                } else {
                    if (bdepth >= 0) {
                        return 1;
                    } else {
                        return 0;
                    }
                }
            };
        }
        
        /*
         * Comparator for sorting tokens by name
         */
        function compareByName(a, b) {
            if (a.value === b.value) {
                return 0;
            } else if (a.value < b.value) {
                return -1;
            } else {
                return 1;
            }
        }
        
        /*
         * Comparator for sorting tokens by path, such that
         * a <= b if a.path === path
         */
        function compareByPath(path) {
            return function (a, b) {
                if (a.path === path) {
                    if (b.path === path) {
                        return 0;
                    } else {
                        return -1;
                    }
                } else {
                    if (b.path === path) {
                        return 1;
                    } else {
                        return 0;
                    }
                }
            };
        }
        
        /*
         * Comparator for sorting properties w.r.t. an association object.
         */
        function compareByAssociation(assoc) {
            return function (a, b) {
                if (Object.prototype.hasOwnProperty.call(assoc, a.value)) {
                    if (Object.prototype.hasOwnProperty.call(assoc, b.value)) {
                        return assoc[a.value] - assoc[b.value];
                    } else {
                        return -1;
                    }
                } else {
                    if (Object.prototype.hasOwnProperty.call(assoc, b.value)) {
                        return 1;
                    } else {
                        return 0;
                    }
                }
            };
        }

        /*
         * Forms the lexicographical composition of comparators
         */
        function lexicographic(compare1, compare2) {
            return function (a, b) {
                var result = compare1(a, b);
                if (result === 0) {
                    return compare2(a, b);
                } else {
                    return result;
                }
            };
        }

        /*
         * A comparator for identifiers
         */
        function compareIdentifiers(scope, pos) {
            return lexicographic(compareByScope(scope),
                        lexicographic(compareByPosition(pos),
                            compareByName));
        }
        
        /*
         * A comparator for properties
         */
        function compareProperties(assoc, path, pos) {
            return lexicographic(compareByAssociation(assoc),
                        lexicographic(compareByPath(path),
                            lexicographic(compareByPosition(pos),
                                compareByName)));
        }

        var hints;

        if (type.property) {
            hints = scopedProperties.slice(0);
            if (type.context &&
                    Object.prototype.hasOwnProperty.call(scopedAssociations, type.context)) {
                hints.sort(compareProperties(scopedAssociations[type.context], path, offset));
            } else {
                hints.sort(compareProperties({}, path, offset));
            }
        } else {
            hints = scopedIdentifiers.slice(0);
            hints.sort(compareIdentifiers(innerScope, offset));
        }
        
        return hints;
    }
                
    /**
     * @constructor
     */
    function JSHints() {
    }

    /**
     * Determine whether hints are available for a given editor context
     */
    JSHints.prototype.hasHints = function (editor, key) {
        
        function handleScope(scopeInfo) {
            var cm      = sessionEditor._codeMirror,
                cursor  = sessionEditor.getCursorPos(),
                offset  = sessionEditor.indexFromPos(cursor),
                token   = cm.getTokenAt(cursor),
                type    = getSessionType(cm.getTokenAt, cursor, token),
                query   = getQuery(cursor, token),
                path    = sessionEditor.document.file.fullPath,
                response;
    
            innerScope = scopeInfo.scope;
            scopedIdentifiers = scopeInfo.identifiers;
            scopedProperties = scopeInfo.properties;
            scopedAssociations = scopeInfo.associations;
            sessionType = type;
            sessionHints = getSessionHints(path, offset, sessionType);
            
            if ($deferredHints && $deferredHints.state() === "pending") {
                response = getResponse(sessionHints, query);
                $deferredHints.resolveWith(null, [response]);
            }
        }
        
        if ((key === null) || HintUtils.maybeIdentifier(key)) {
            var cursor      = editor.getCursorPos(),
                cm          = editor._codeMirror,
                token       = cm.getTokenAt(cursor);

            // don't autocomplete within strings or comments, etc.
            if (token && HintUtils.hintable(token)) {
                var path        = sessionEditor.document.file.fullPath,
                    offset      = editor.indexFromPos(cursor),
                    scopeInfo;
                
                if (!innerScope || ScopeManager.isScopeDirty(path, offset, innerScope)) {
                    scopeInfo = ScopeManager.getScope(path, offset);
                    sessionHints = null;
                    if (scopeInfo.hasOwnProperty("deferred")) {
                        innerScope = null;
                        scopedIdentifiers = null;
                        scopedProperties = null;
                        scopedAssociations = null;
                        
                        $deferredScope = scopeInfo.deferred;
                        $deferredScope.done(handleScope);
                    } else {
                        innerScope = scopeInfo.scope;
                        scopedIdentifiers = scopeInfo.identifiers;
                        scopedProperties = scopeInfo.properties;
                        scopedAssociations = scopeInfo.associations;

                        if ($deferredScope && $deferredScope.state() === "pending") {
                            $deferredScope.reject();
                        }
                        $deferredScope = null;
                    }
                }

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
        
        if ((key === null) || HintUtils.maybeIdentifier(key)) {
            var cursor  = sessionEditor.getCursorPos(),
                offset  = sessionEditor.indexFromPos(cursor),
                cm      = sessionEditor._codeMirror,
                token   = cm.getTokenAt(cursor);

            if (token && HintUtils.hintable(token)) {
                
                if (innerScope) {
                    var type    = getSessionType(cm.getTokenAt, cursor, token),
                        query   = getQuery(cursor, token),
                        path    = sessionEditor.document.file.fullPath;
                    if (!sessionHints ||
                            type.property !== sessionType.property ||
                            type.context !== sessionType.context) {
                        sessionType = type;
                        sessionHints = getSessionHints(path, offset, sessionType);
                    }
                    return getResponse(sessionHints, query);
                } else if ($deferredScope && $deferredScope.state() === "pending") {
                    if (!$deferredHints || $deferredHints.isRejected()) {
                        $deferredHints = $.Deferred();
                    }
                    return $deferredHints;
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

        /*
         * Get the token after the one at the given cursor
         */
        function getNextToken(getToken, cursor) {
            var doc = sessionEditor.document,
                line = doc.getLine(cursor.line);

            if (cursor.ch < line.length) {
                return getToken({ch: cursor.ch + 1,
                                      line: cursor.line});
            } else if (doc.getLine(cursor.line + 1)) {
                return getToken({ch: 0, line: cursor.line + 1});
            } else {
                return null;
            }
        }

        var completion  = hint.data('hint'),
            cm          = sessionEditor._codeMirror,
            cursor      = sessionEditor.getCursorPos(),
            token       = cm.getTokenAt(cursor),
            nextToken   = getNextToken(cm.getTokenAt, cursor),
            start       = {line: cursor.line, ch: token.start},
            end         = {line: cursor.line, ch: token.end};

        if (token.string === "." || token.string.trim() === "") {
            if (nextToken.string.trim() === "" || !HintUtils.hintable(nextToken)) {
                start.ch = cursor.ch;
                end.ch = cursor.ch;
            } else {
                start.ch = nextToken.start;
                end.ch = nextToken.end;
            }
        }

        cm.replaceRange(completion, start, end);
        return false;
    };


    // load the extension
    AppInit.appReady(function () {
        
        /**
         * Reset and recompute the scope and hinting information for the given
         * editor
         */
        function refreshEditor(editor) {
            ScopeManager.handleEditorChange(editor.document.file.fullPath);
            sessionEditor = editor;
            scopedIdentifiers = null;
            scopedProperties = null;
            scopedAssociations = null;
            innerScope = null;
            
            if ($deferredHints && $deferredHints.state() === "pending") {
                $deferredHints.reject();
            }
            $deferredHints = null;
        }

        /*
         * Install editor change listeners to keep the outer scope fresh
         */
        function installEditorListeners(editor) {
            if (!editor) {
                return;
            }
            
            var path = editor.document.file.fullPath;

            if (editor.getModeForSelection() === HintUtils.MODE_NAME) {
                $(editor)
                    .on(HintUtils.eventName("change"), function () {
                        ScopeManager.handleFileChange(path);
                    });

                refreshEditor(editor);
            }
        }

        /*
         * Uninstall editor change listeners
         */
        function uninstallEditorListeners(editor) {
            $(editor)
                .off(HintUtils.eventName("change"));
        }

        // uninstall/install change listener as the active editor changes
        $(EditorManager)
            .on(HintUtils.eventName("activeEditorChange"),
                function (event, current, previous) {
                    uninstallEditorListeners(previous);
                    installEditorListeners(current);
                });
        
        // immediately install the current editor
        installEditorListeners(EditorManager.getActiveEditor());

        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints, [HintUtils.MODE_NAME], 0);

        // for unit testing
        exports.jsHintProvider = jsHints;
    });
});
