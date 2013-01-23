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
    
    var HintUtils       = require("HintUtils"),
        ScopeManager    = require("ScopeManager");

    function Session(editor) {
        this.editor = editor;
        this.path = editor.document.file.fullPath;
    }
    
    Session.prototype.setScopeInfo = function (scopeInfo) {
        this.scope = scopeInfo.scope;
        this.identifiers = scopeInfo.identifiers;
        this.properties = scopeInfo.properties;
        this.associations = scopeInfo.associations;
    };
    
    Session.prototype.getPath = function () {
        return this.path;
    };
    
    Session.prototype.getCursor = function () {
        return this.editor.getCursorPos();
    };
    
    Session.prototype.getOffset = function () {
        var cursor = this.getCursor();
        
        return this.editor.indexFromPos(cursor);
    };
    
    Session.prototype.getCurrentToken = function () {
        var cm      = this.editor._codeMirror,
            cursor  = this.getCursor();
            
        return cm.getTokenAt(cursor);
    };
    
    /**
     * Get the token after the one at the given cursor
     */
    Session.prototype.getNextToken = function () {
        var cm      = this.editor._codeMirror,
            cursor  = this.getCursor(),
            doc     = this.editor.document,
            line    = doc.getLine(cursor.line);

        if (cursor.ch < line.length) {
            return cm.getTokenAt({ch: cursor.ch + 1,
                                  line: cursor.line});
        } else if (doc.getLine(cursor.line + 1)) {
            return cm.getTokenAt({ch: 0, line: cursor.line + 1});
        } else {
            return null;
        }
    };
    
    /**
     * Calculate a query string relative to the current cursor position
     * and token.
     */
    Session.prototype.getQuery = function () {
        var cm      = this.editor._codeMirror,
            cursor  = this.editor.getCursorPos(),
            token   = cm.getTokenAt(cursor),
            query   = "";
        
        if (token) {
            if (token.string !== ".") {
                query = token.string.substring(0, token.string.length - (token.end - cursor.ch));
            }
        }
        return query.trim();
    };
    
    Session.prototype.getType = function () {

        var self = this;
        
        /*
         * Get the token before the one at the given cursor
         */
        function getPreviousToken(cursor, token) {
            var doc     = self.editor.document,
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
                prev = self.editor._codeMirror.getTokenAt(cursor);
            } while (prev.string.trim() === "");
            
            return prev;
        }
                
        var propertyLookup  = false,
            context         = null,
            cursor          = this.editor.getCursorPos(),
            token           = this.editor._codeMirror.getTokenAt(cursor),
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
    };
    
    Session.prototype.getHints = function () {

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
        
        var cursor = this.editor.getCursorPos(),
            offset = this.editor.indexFromPos(cursor),
            type = this.getType(),
            hints;

        if (type.property) {
            hints = this.properties.slice(0);
            if (type.context &&
                    Object.prototype.hasOwnProperty.call(this.associations, type.context)) {
                hints.sort(compareProperties(this.associations[type.context], this.path, offset));
            } else {
                hints.sort(compareProperties({}, this.path, offset));
            }
        } else {
            hints = this.identifiers.slice(0);
            hints.sort(compareIdentifiers(this.scope, offset));
        }
        
        return hints;
    };
    
    exports.Session = Session;
    
});
