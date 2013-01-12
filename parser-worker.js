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
/*global self, importScripts, esprima, setTimeout */

(function () {
    'use strict';

    var SCOPE_MSG_TYPE = "outerScope";

    importScripts('esprima/esprima.js', 'scope.js');

    function _log(msg) {
        self.postMessage({log: msg });
    }

    function makeToken(value, positions) {
        if (positions === undefined) {
            positions = [];
        }

        return {
            value: value,
            positions: positions
        };
    }

    var JSL_GLOBALS = [
        "clearInterval", "clearTimeout", "document", "event", "frames",
        "history", "Image", "location", "name", "navigator", "Option",
        "parent", "screen", "setInterval", "setTimeout", "window",
        "XMLHttpRequest", "alert", "confirm", "console", "Debug", "opera",
        "prompt", "WSH", "Buffer", "exports", "global", "module", "process",
        "querystring", "require", "__filename", "__dirname", "defineClass",
        "deserialize", "gc", "help", "load", "loadClass", "print", "quit",
        "readFile", "readUrl", "runCommand", "seal", "serialize", "spawn",
        "sync", "toint32", "version", "ActiveXObject", "CScript", "Enumerator",
        "System", "VBArray", "WScript"
    ].reduce(function (prev, curr) {
        prev[curr] = makeToken(curr);
        return prev;
    }, {});

    var JSL_GLOBALS_BROWSER = [
            JSL_GLOBALS.clearInteval,
            JSL_GLOBALS.clearTimeout,
            JSL_GLOBALS.document,
            JSL_GLOBALS.event,
            JSL_GLOBALS.frames,
            JSL_GLOBALS.history,
            JSL_GLOBALS.Image,
            JSL_GLOBALS.location,
            JSL_GLOBALS.name,
            JSL_GLOBALS.navigator,
            JSL_GLOBALS.Option,
            JSL_GLOBALS.parent,
            JSL_GLOBALS.screen,
            JSL_GLOBALS.setInterval,
            JSL_GLOBALS.setTimeout,
            JSL_GLOBALS.window,
            JSL_GLOBALS.XMLHttpRequest
        ],
        JSL_GLOBALS_DEVEL = [
            JSL_GLOBALS.alert,
            JSL_GLOBALS.confirm,
            JSL_GLOBALS.console,
            JSL_GLOBALS.Debug,
            JSL_GLOBALS.opera,
            JSL_GLOBALS.prompt,
            JSL_GLOBALS.WSH
        ],
        JSL_GLOBALS_NODE = [
            JSL_GLOBALS.Buffer,
            JSL_GLOBALS.clearInterval,
            JSL_GLOBALS.clearTimeout,
            JSL_GLOBALS.console,
            JSL_GLOBALS.exports,
            JSL_GLOBALS.global,
            JSL_GLOBALS.module,
            JSL_GLOBALS.process,
            JSL_GLOBALS.querystring,
            JSL_GLOBALS.require,
            JSL_GLOBALS.setInterval,
            JSL_GLOBALS.setTimeout,
            JSL_GLOBALS.__filename,
            JSL_GLOBALS.__dirname
        ],
        JSL_GLOBALS_RHINO = [
            JSL_GLOBALS.defineClass,
            JSL_GLOBALS.deserialize,
            JSL_GLOBALS.gc,
            JSL_GLOBALS.help,
            JSL_GLOBALS.load,
            JSL_GLOBALS.loadClass,
            JSL_GLOBALS.print,
            JSL_GLOBALS.quit,
            JSL_GLOBALS.readFile,
            JSL_GLOBALS.readUrl,
            JSL_GLOBALS.runCommand,
            JSL_GLOBALS.seal,
            JSL_GLOBALS.serialize,
            JSL_GLOBALS.spawn,
            JSL_GLOBALS.sync,
            JSL_GLOBALS.toint32,
            JSL_GLOBALS.version
        ],
        JSL_GLOBALS_WINDOWS = [
            JSL_GLOBALS.ActiveXObject,
            JSL_GLOBALS.CScript,
            JSL_GLOBALS.Debug,
            JSL_GLOBALS.Enumerator,
            JSL_GLOBALS.System,
            JSL_GLOBALS.VBArray,
            JSL_GLOBALS.WScript,
            JSL_GLOBALS.WSH
        ];
    
    var JSL_GLOBAL_DEFS = {
        browser : JSL_GLOBALS_BROWSER,
        devel   : JSL_GLOBALS_DEVEL,
        node    : JSL_GLOBALS_NODE,
        rhino   : JSL_GLOBALS_RHINO,
        windows : JSL_GLOBALS_WINDOWS
    };

    /**
     * Walk the scope to find all the objects of a given type, along with a
     * list of their positions in the file.
     */
    function sift(scope, type) {
        var positions,
            results = [],
            key,
            i;

        positions = scope.walkDown(function (acc, token) {
            if (Object.prototype.hasOwnProperty.call(acc, token.name)) {
                acc[token.name].push(token.range[0]);
            } else {
                acc[token.name] = [token.range[0]];
            }
            return acc;
        }, {}, type);
        
        for (key in positions) {
            if (Object.prototype.hasOwnProperty.call(positions, key)) {
                results.push(makeToken(key, positions[key]));
            }
        }
        return results;
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
                                globals.push(makeToken(g.trim()));
                            });
                        } else if (c.value.indexOf("jslint") === 0) {
                            c.value.substring(7).split(",").forEach(function (e) {
                                var index = e.indexOf(":"),
                                    prop = (index >= 0) ? e.substring(0, index).trim() : "",
                                    val = (index >= 0) ? e.substring(index + 1, e.length).trim() : "";

                                if (val === "true" && JSL_GLOBAL_DEFS.hasOwnProperty(prop)) {
                                    globals = globals.concat(JSL_GLOBAL_DEFS[prop]);
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

    function respond(path, parseObj) {
        var scope = parseObj ? parseObj.scope : null,
            globals = parseObj ? parseObj.globals : null,
            identifiers = parseObj ? sift(scope, 'identifiers') : null,
            properties = parseObj ? sift(scope, 'properties') : null,
            response  = {
                type        : SCOPE_MSG_TYPE,
                path        : path,
                scope       : scope,
                globals     : globals,
                identifiers : identifiers,
                properties  : properties,
                success     : !!parseObj
            };

        self.postMessage(response);
    }

    /**
     * Use Esprima to parse a JavaScript text
     */
    function parse(text, path) {
        try {
            var ast = esprima.parse(text, {
                range       : true,
                tolerant    : true,
                comment     : true
            });
            if (ast.errors.length > 0) {
                _log("Parse errors: " + JSON.stringify(ast.errors));
            }

            respond(path, {
                scope : new self.Scope(ast),
                globals : extractGlobals(ast.comments)
            });
        } catch (err) {
            // _log("Parsing failed: " + err);
            respond(path, null);
        }
    }
    
    self.addEventListener("message", function (e) {
        var request = e.data,
            type = request.type;

        if (type === SCOPE_MSG_TYPE) {
            var text    = request.text,
                newpath = request.path;
            setTimeout(function () { parse(text, newpath); }, 0);
        } else {
            _log("Unknown message: " + JSON.stringify(e.data));
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
