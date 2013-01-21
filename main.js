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
/*global define, brackets, $, Worker */

define(function (require, exports, module) {
    "use strict";

    var CodeHintManager         = brackets.getModule("editor/CodeHintManager"),
        DocumentManager         = brackets.getModule("document/DocumentManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        EditorUtils             = brackets.getModule("editor/EditorUtils"),
        FileUtils               = brackets.getModule("file/FileUtils"),
        NativeFileSystem        = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        ProjectManager          = brackets.getModule("project/ProjectManager"),
        AppInit                 = brackets.getModule("utils/AppInit"),
        TokenUtils              = require("TokenUtils"),
        ScopeManager              = require("ScopeManager"),
        Scope                   = require("scope").Scope;

    var MODE_NAME = "javascript",
        EVENT_TAG = "brackets-js-hints",
        SCOPE_MSG_TYPE = "outerScope";

    var $deferredHintObj    = null,  // deferred hint object
        sessionEditor       = null,  // editor object for the current hinting session
        sessionHints        = null,  // sorted hints for the current hinting session
        sessionType         = false, // true = property, false = identifier
        sessionContext      = null,  // the object context for the property lookup
        innerScope          = null,  // the inner-most scope returned by the query worker
        scopedIdentifiers   = null,  // identifiers for the current inner scope
        scopedProperties    = null,  // properties for the current inner scope
        scopedAssociations  = null;  // associations for the current inner scope
    
    /**
     * Creates a hint response object
     */
    function getHintResponse(hints, cursor, token) {

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
        
        var query           = getQuery(cursor, token),
            filteredHints   = filterWithQuery(hints.slice(0), query).slice(0, 100),
            formattedHints  = formatHints(filteredHints, query);
            
        return {
            hints: formattedHints,
            match: null,
            selectInitial: true
        };
    }
                             
    function getSessionInfo(getToken, cursor, token) {
                
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
                if (prevToken && TokenUtils.hintable(prevToken)) {
                    context = prevToken.string;
                }
            }
        }
                
        return {
            type: propertyLookup,
            context: context
        };
    }
                             
    function getSessionHints(path, cursor) {

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

        var offset = sessionEditor.indexFromPos(cursor),
            hints;

        if (sessionType) {
            hints = scopedProperties.slice(0);
            if (sessionContext &&
                    Object.prototype.hasOwnProperty.call(scopedAssociations, sessionContext)) {
                hints.sort(compareProperties(scopedAssociations[sessionContext], path, offset));
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
     * Divide a path into directory and filename parts
     */
    function splitPath(path) {
        var index   = path.lastIndexOf("/"),
            dir     = path.substring(0, index),
            file    = path.substring(index, path.length);
        
        return {dir: dir, file: file };
    }


            
    /**
     * Reset and recompute the scope and hinting information for the given
     * editor
     */
    function refreshEditor(editor) {
        var path    = editor.document.file.fullPath,
            split   = splitPath(path),
            dir     = split.dir,
            file    = split.file;

        if (!sessionEditor ||
                sessionEditor.document.file.fullPath !== path) {
            scopedIdentifiers = null;
            scopedProperties = null;
            scopedAssociations = null;
            innerScope = null;
            
            ScopeManager.markFileDirty(dir, file);
        }
        sessionEditor = editor;

        if ($deferredHintObj && $deferredHintObj.state() === "pending") {
            $deferredHintObj.reject();
        }
        $deferredHintObj = null;

        ScopeManager.refreshFile(dir, file);
    }
            
    function setScopeInfo(scopeInfo) {
        innerScope = scopeInfo.scope;
        scopedIdentifiers = scopeInfo.identifiers;
        scopedProperties = scopeInfo.properties;
        scopedAssociations = scopeInfo.associations;
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
        
        /*
         * Resolve the deferred hint object with actual hints
         */
        function handleScopeInfo(scopeInfo) {
            if ($deferredHintObj !== null &&
                    $deferredHintObj.state() === "pending") {
                var cursor = sessionEditor.getCursorPos(),
                    token = sessionEditor._codeMirror.getTokenAt(cursor),
                    path = sessionEditor.document.file.fullPath,
                    hintResponse;
                
                setScopeInfo(scopeInfo);
                sessionHints = getSessionHints(path, cursor);
                hintResponse = getHintResponse(sessionHints, cursor, token);
                $deferredHintObj.resolveWith(null, [hintResponse]);
            }
                    
            $deferredHintObj = null;
        }

        if ((key === null) || TokenUtils.maybeIdentifier(key)) {
            var cursor      = editor.getCursorPos(),
                offset      = editor.indexFromPos(cursor),
                cm          = editor._codeMirror,
                token       = cm.getTokenAt(cursor);

            // don't autocomplete within strings or comments, etc.
            if (token && TokenUtils.hintable(token)) {
                var path    = sessionEditor.document.file.fullPath,
                    split   = splitPath(path),
                    dir     = split.dir,
                    file    = split.file,
                    scopeInfo = ScopeManager.getInnerScope(dir, file, offset, handleScopeInfo),
                    sessionInfo;
                
                if (scopeInfo) {
                    
                    if (scopeInfo.fresh) {
                        setScopeInfo(scopeInfo);
                    }
                    
                    sessionInfo = getSessionInfo(cm.getTokenAt, cursor, token);
                    sessionType = sessionInfo.type;
                    sessionContext = sessionInfo.context;
                    sessionHints = getSessionHints(path, cursor);
                } else {
                    sessionHints = null;
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
        
        /*
         * Prepare a deferred hint object
         */
        function getDeferredResponse() {
            if (!$deferredHintObj || $deferredHintObj.isRejected()) {
                $deferredHintObj = $.Deferred();
            }
            return $deferredHintObj;
        }
        
        if ((key === null) || TokenUtils.maybeIdentifier(key)) {
            var cursor  = sessionEditor.getCursorPos(),
                cm      = sessionEditor._codeMirror,
                token  = cm.getTokenAt(cursor);

            if (token && TokenUtils.hintable(token)) {
                var path    = sessionEditor.document.file.fullPath,
                    split   = splitPath(path),
                    dir     = split.dir,
                    file    = split.file,
                    info;
                
                if (sessionHints) {
                    info = getSessionInfo(cm.getTokenAt, cursor, token);
                    if (info.type !== sessionType || info.context !== sessionContext) {
                        sessionType = info.type;
                        sessionContext = info.context;
                        sessionHints = getSessionHints(dir, file, cursor);
                    }
                    return getHintResponse(sessionHints, cursor, token);
                } else {
                    return getDeferredResponse();
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
            end         = {line: cursor.line, ch: token.end},
            path        = sessionEditor.document.file.fullPath,
            split       = splitPath(path),
            dir         = split.dir,
            file        = split.file;

        if (token.string === "." || token.string.trim() === "") {
            if (nextToken.string.trim() === "" || !TokenUtils.hintable(nextToken)) {
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

        /*
         * Get a JS-hints-specific event name
         */
        function eventName(name) {
            return name + "." + EVENT_TAG;
        }

        /*
         * Install editor change listeners to keep the outer scope fresh
         */
        function installEditorListeners(editor) {
            if (!editor) {
                return;
            }
            
            var path    = editor.document.file.fullPath,
                split   = splitPath(path),
                dir     = split.dir,
                file    = split.file;

            if (editor.getModeForSelection() === MODE_NAME) {
                $(editor)
                    .on(eventName("change"), function () {
                        ScopeManager.handleEditorChange(dir, file);
                    });

                refreshEditor(editor);
            }
        }

        /*
         * Uninstall editor change listeners
         */
        function uninstallEditorListeners(editor) {
            $(editor)
                .off(eventName("change") + EVENT_TAG);
        }


        // uninstall/install change listener as the active editor changes
        $(EditorManager)
            .on(eventName("activeEditorChange") + EVENT_TAG,
                function (event, current, previous) {
                    uninstallEditorListeners(previous);
                    installEditorListeners(current);
                });
        
        // immediately install the current editor
        installEditorListeners(EditorManager.getActiveEditor());
        
        // reset state on project change
        $(ProjectManager)
            .on(eventName("beforeProjectClose") + EVENT_TAG,
                function (event, projectRoot) {
                    ScopeManager.reset();
                });
        
        // relocate scope information on file rename
        $(DocumentManager)
            .on(eventName("fileNameChange") + EVENT_TAG,
                function (event, oldname, newname) {
                    ScopeManager.renameFile(oldname, newname);
                });

        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints, [MODE_NAME], 0);

        // for unit testing
        exports.jsHintProvider = jsHints;
    });
});
