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

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, regexp: true */
/*global self, importScripts, esprima, setTimeout */

(function () {
    'use strict';

    var MAX_RETRIES = 100,
        SCOPE_MSG_TYPE = "outerScope";

    importScripts('esprima/esprima.js', 'scope.js', 'TokenUtils.js');

    function _log(msg) {
        self.postMessage({log: msg });
    }

    /**
     * Walk the scope to find all the objects of a given type, along with a
     * list of their positions in the file.
     */
    function siftPositions(scope, walk) {
        var occurrences,
            results = [],
            key,
            token;

        occurrences = walk.call(scope, function (acc, token) {
            if (Object.prototype.hasOwnProperty.call(acc, token.name)) {
                acc[token.name].push(token.range[0]);
            } else {
                acc[token.name] = [token.range[0]];
            }
            return acc;
        }, {});

        for (key in occurrences) {
            if (Object.prototype.hasOwnProperty.call(occurrences, key)) {
                token = self.makeToken(key, occurrences[key]);
                results.push(token);
            }
        }
        return results;
    }

    function siftAssociations(scope) {
        return scope.walkDownAssociations(function (acc, assoc) {
            var obj     = assoc.object,
                prop    = assoc.property;
            if (Object.prototype.hasOwnProperty.call(acc, obj.name)) {
                if (Object.prototype.hasOwnProperty.call(acc[obj.name], prop.name)) {
                    acc[obj.name][prop.name]++;
                } else {
                    acc[obj.name][prop.name] = 1;
                }
            } else {
                acc[obj.name] = {};
                acc[obj.name][prop.name] = 1;
            }
            return acc;
        }, {});
    }

    /**
     * Look for a JSLint globals annotation in the comments
     */
    function extractGlobals(comments) {
        var globals = [];

        if (comments) {
            comments.forEach(function (c) {
                if (c.type === "Block") {
                    if (c.value) {
                        if (c.value.indexOf("global") === 0) {
                            c.value.substring(7).split(",").forEach(function (g) {
                                var index = g.indexOf(":");

                                if (index >= 0) {
                                    g = g.substring(0, index);
                                }
                                globals.push(self.makeToken(g.trim()));
                            });
                        } else if (c.value.indexOf("jslint") === 0) {
                            c.value.substring(7).split(",").forEach(function (e) {
                                var index = e.indexOf(":"),
                                    prop = (index >= 0) ? e.substring(0, index).trim() : "",
                                    val = (index >= 0) ? e.substring(index + 1, e.length).trim() : "";

                                if (val === "true" && self.JSL_GLOBAL_DEFS.hasOwnProperty(prop)) {
                                    globals = globals.concat(self.JSL_GLOBAL_DEFS[prop]);
                                }
                            });
                        }
                    }
                    
                }
            });
        }

        globals.sort(function (a, b) { return a.value < b.value; });
        return globals;
    }

    function respond(dir, file, length, parseObj) {
        var scope = parseObj ? parseObj.scope : null,
            globals = parseObj ? parseObj.globals : null,
            identifiers = parseObj ? siftPositions(scope, scope.walkDownIdentifiers) : null,
            properties = parseObj ? siftPositions(scope, scope.walkDownProperties) : null,
            associations = parseObj ? siftAssociations(scope, scope.walkDownAssociations) : null,
            response  = {
                type            : SCOPE_MSG_TYPE,
                dir             : dir,
                file            : file,
                length          : length,
                scope           : scope,
                globals         : globals,
                identifiers     : identifiers,
                properties      : properties,
                associations    : associations,
                success         : !!parseObj
            };

        self.postMessage(response);
    }

    /**
     * Use Esprima to parse a JavaScript text
     */
    function parse(dir, file, text, retries) {
        try {
            var ast = esprima.parse(text, {
                range       : true,
                tolerant    : true,
                comment     : true
            });

            if (ast.errors.length > 0) {
                _log("Parse errors: " + JSON.stringify(ast.errors));
            }

            respond(dir, file, text.length, {
                scope : new self.Scope(ast),
                globals : extractGlobals(ast.comments)
            });
        } catch (err) {
            // _log("Parsing failed: " + err + " at " + err.index);
            if (retries > 0) {
                var lines = text.split("\n"),
                    lineno = Math.min(lines.length, err.lineNumber) - 1,
                    newline,
                    removed;

                // Remove the offending line and start over
                if (-1 < lineno < lines.length) {
                    newline = lines[lineno].replace(/./g, " ");
                    if (newline !== lines[lineno]) {
                        removed = lines.splice(lineno, 1, newline);
                        if (removed && removed.length > 0) {
                            // _log("Removed: '" + removed[0] + "'");
                            setTimeout(function () {
                                parse(dir, file, text.length, lines.join("\n"), --retries);
                            }, 0);
                            return;
                        }
                    }
                }
            }
            respond(dir, file, text.length, null);
        }
    }
    
    self.addEventListener("message", function (e) {
        var request = e.data,
            type = request.type;

        if (type === SCOPE_MSG_TYPE) {
            var dir     = request.dir,
                file    = request.file,
                text    = request.text,
                retries = request.force ? MAX_RETRIES : 0;
            setTimeout(function () { parse(dir, file, text, retries); }, 0);
        } else {
            _log("Unknown message: " + JSON.stringify(request));
        }
    });
}());

/*
 * Used by the Web Worker-specific importScripts operation
 */
function define(f) {
    'use strict';
    f(null, self, null);
}
